import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import type { Lead, Task } from "../types";
import { emailInventory } from "../work-queue";
import { classifyLead, auditQueue, reasonOwner, prepareEmailInventory } from "./inventory-prep";
import { isOrdinaryColdPhoneFirst } from "./call-priority";

const ras = (leadId: string): Task => ({ id: `t_${leadId}`, leadId, type: "review_and_send", title: "Send review", dueAt: "2026-08-12T00:00:00Z", status: "open", priority: 40, snoozedUntil: null, sourcePlanId: null, sourceStepId: null, createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" } as Task);
const emailLead = (id: string, over: Partial<Lead> = {}) => makeLead({ id, publicEmail: `hi@${id}.com`, ...over }); // dental default = email-first

// ── A / G. Deep email inventory, separated from daily send capacity ──────────────────────────
describe("emailInventory — a deep reservoir, distinct from today's send capacity", () => {
  it("30 prepared email-first businesses with a send target of 10 → 10 ready today, 20 held", () => {
    const leads = Array.from({ length: 30 }, (_, i) => emailLead(`biz${i}`));
    const tasks = leads.map((l) => ras(l.id));
    const inv = emailInventory({ leads, tasks, emailsSentToday: 0, sendTarget: 10 });
    expect(inv.prepared).toBe(30);
    expect(inv.readyToday).toBe(10);   // only the safe daily subset is sendable
    expect(inv.beyondToday).toBe(20);  // reservoir preserved, returns as capacity frees
    expect(inv.sendCapacity).toBe(10);
  });

  it("counts a business once even with two email tasks (no double-count)", () => {
    const l = emailLead("dup");
    const inv = emailInventory({ leads: [l], tasks: [ras("dup"), { ...ras("dup"), id: "second" } as Task], emailsSentToday: 0, sendTarget: 10 });
    expect(inv.prepared).toBe(1);
  });

  it("send capacity already spent today → readyToday shrinks, prepared inventory untouched", () => {
    const leads = Array.from({ length: 12 }, (_, i) => emailLead(`b${i}`));
    const inv = emailInventory({ leads, tasks: leads.map((l) => ras(l.id)), emailsSentToday: 7, sendTarget: 10 });
    expect(inv.sendCapacity).toBe(3);
    expect(inv.readyToday).toBe(3);
    expect(inv.prepared).toBe(12);
    expect(inv.beyondToday).toBe(9);
  });
});

// ── B. No cold-call quota — cold phone-first is withheld, not manufactured ─────────────────────
describe("no cold-call quota", () => {
  const cold = makeLead({ id: "cold", industry: "Auto repair", normalizedCategory: "auto-repair", publicEmail: null, website: null, phone: "(213) 555-0100", leadScore: null, tier: null, lastContactAt: null, nextFollowUpAt: null, pipelineStage: "Discovered" });

  it("an ordinary cold phone-first business with nothing queued is 'withheld' (correct), never a defect to fill", () => {
    const reason = classifyLead(cold, [], false); // nothing queued — we do NOT manufacture a call
    expect(reason).toBe("cold-call-withheld");
    expect(reasonOwner(reason)).toBe("correct");
    expect(isOrdinaryColdPhoneFirst(cold)).toBe(true);
  });
});

// ── D. Stranded email is a defect the audit surfaces ─────────────────────────────────────────
describe("classifyLead / auditQueue — the nothing-queued & needs-attention breakdown", () => {
  it("email-first + valid email + no email task → stranded-email (defect)", () => {
    const l = emailLead("strand");
    expect(classifyLead(l, [], false)).toBe("stranded-email");
    expect(reasonOwner("stranded-email")).toBe("defect");
  });

  it("has an active email task → has-work (correct)", () => {
    const l = emailLead("ok");
    expect(classifyLead(l, [ras("ok")], false)).toBe("has-work");
  });

  it("outreach already sent/contacted → outreach-in-progress (correct), not stranded", () => {
    const l = emailLead("warm", { lastContactAt: "2026-08-01T00:00:00Z" });
    expect(classifyLead(l, [], false)).toBe("outreach-in-progress");
  });

  it("terminal / DNC → terminal (correct)", () => {
    expect(classifyLead(emailLead("t", { pipelineStage: "Disqualified" }), [], false)).toBe("terminal");
    expect(classifyLead(emailLead("d", { acquisitionStrategy: "Do Not Contact" }), [], false)).toBe("terminal");
  });

  // ── E. Needs attention — software-resolvable (analyze the site) ────────────────────────────
  it("no channel yet BUT has an un-analyzed website → preparing-analysis (software-research)", () => {
    const l = makeLead({ id: "prep", industry: "Bakery", normalizedCategory: "bakery", publicEmail: null, phone: null, contactFormUrl: null, socialLinks: [], website: "https://prep.com", websiteDomain: "prep.com" });
    const reason = classifyLead(l, [], false); // not analyzed
    expect(reason).toBe("preparing-analysis");
    expect(reasonOwner(reason)).toBe("software-research");
  });

  // ── F. Needs attention — genuine ambiguity ─────────────────────────────────────────────────
  it("no channel AND already analyzed → no-verified-channel (human)", () => {
    const l = makeLead({ id: "genuine", industry: "Bakery", normalizedCategory: "bakery", publicEmail: null, phone: null, contactFormUrl: null, socialLinks: [], website: null, websiteDomain: null });
    const reason = classifyLead(l, [], true); // analyzed, still nothing
    expect(reason).toBe("no-verified-channel");
    expect(reasonOwner(reason)).toBe("human");
  });

  it("auditQueue rolls the pool into an owner breakdown and lists the strands", () => {
    const leads = [emailLead("s1"), emailLead("has", {}), makeLead({ id: "g", industry: "Bakery", normalizedCategory: "bakery", publicEmail: null, phone: null, contactFormUrl: null, socialLinks: [], website: null })];
    const audit = auditQueue({ leads, tasks: [ras("has")], analyzedLeadIds: new Set(["g"]) });
    expect(audit.byReason["stranded-email"]).toBe(1);
    expect(audit.byReason["has-work"]).toBe(1);
    expect(audit.byReason["no-verified-channel"]).toBe(1);
    expect(audit.byOwner.defect).toBe(1);
    expect(audit.strandedLeadIds).toEqual(["s1"]);
  });
});

// ── H. Preparation runs ahead of consumption, bounded ────────────────────────────────────────
describe("prepareEmailInventory — bounded preparation that deepens inventory", () => {
  it("selects eligible (website, no email, unanalyzed), respects the cap, and reports adoptions", async () => {
    const leads = [
      makeLead({ id: "a", publicEmail: null, website: "https://a.com", websiteDomain: "a.com" }),
      makeLead({ id: "b", publicEmail: null, website: "https://b.com", websiteDomain: "b.com" }),
      makeLead({ id: "c", publicEmail: null, website: "https://c.com", websiteDomain: "c.com" }),
      makeLead({ id: "hasEmail", publicEmail: "x@x.com", website: "https://x.com" }), // ineligible (has email)
      makeLead({ id: "noSite", publicEmail: null, website: null }), // ineligible (no website)
    ];
    // Fake analyzer: "a" and "b" publish a same-domain email; "c" does not.
    const adopted: Record<string, string | null> = { a: "info@a.com", b: "info@b.com", c: null };
    const analyzedIds: string[] = [];
    const summary = await prepareEmailInventory({
      leads,
      analyzedLeadIds: new Set(),
      analyze: async (id) => { analyzedIds.push(id); },
      getEmailAfter: async (id) => adopted[id] ?? null,
      max: 2, // bound: only the first two eligible
    });
    expect(summary.eligible).toBe(3);   // a, b, c (not hasEmail / noSite)
    expect(summary.analyzed).toBe(2);   // capped at max
    expect(summary.adoptedEmail).toBe(2); // a + b adopted a same-domain email
    expect(summary.capped).toBe(true);
    expect(analyzedIds).toEqual(["a", "b"]);
  });
});

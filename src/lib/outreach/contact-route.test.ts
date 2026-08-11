import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, getLead, allTasks, contactsForLead, listAudit } from "../repo";
import { saveCallOutcomeAction } from "./call-outcome";
import { saveManualContactAction } from "./find-contact";
import { determineContactStrategy } from "./contact-strategy";
import { buildWorkQueue } from "../work-queue";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

async function seedCallFirst(over: Partial<Lead> = {}) {
  // A call-first business (owner-accessible auto shop, NOT a gatekeeper-heavy dental/legal
  // practice), so the "no email → call-first, then email added → email-first" flip still holds.
  // leadScore is high so it's an EXCEPTIONAL cold call that surfaces on the board (ordinary
  // low-value cold phone-first is now deprioritized off the primary queue — see call-priority).
  const base = makeLead({ businessName: "Wilshire Auto Care", industry: "Auto repair", normalizedCategory: "auto-repair", leadScore: 78, phone: "(213) 329-7576", publicEmail: null, website: "https://wilshireautocare.example", websiteDomain: "wilshireautocare.example", socialLinks: [], note: null, lastContactAt: null, ...over });
  const { id, createdAt, updatedAt, ...rest } = base;
  const lead = await insertLead(rest);
  // The outreach task that buckets by contact strategy (call while no email).
  await insertTask({ leadId: lead.id, type: "review_and_send", title: "Outreach", dueAt: new Date().toISOString(), status: "open", priority: 20, snoozedUntil: null });
  return lead;
}
async function bucketsFor(leadId: string) {
  const lead = await getLead(leadId);
  // Mirror production: the queue is built from OPEN tasks (todaysTasks filters status).
  const open = (await allTasks()).filter((t) => t.status === "open");
  const q = buildWorkQueue({ tasks: open, meetingsToday: [], leads: new Map([[leadId, lead!]]) });
  return q.filter((c) => c.leadIds.includes(leadId)).map((c) => c.kind);
}
const openTypes = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open").map((t) => t.type);

describe("email route gained → automatic reclassification & re-queue", () => {
  beforeEach(() => __resetStoreForTests());

  it("adding an email flips call-first → email-first and re-buckets the outreach task to email", async () => {
    const l = await seedCallFirst();
    expect(determineContactStrategy((await getLead(l.id))!).kind).toBe("call-first");
    expect(await bucketsFor(l.id)).toEqual(["call"]);

    const res = await saveCallOutcomeAction(l.id, { outcome: "asked-to-send", verifiedEmail: "info@wilshirelawfirm.com" });
    expect(res.readyToSend).toBe(true);
    expect((await getLead(l.id))?.publicEmail).toBe("info@wilshirelawfirm.com");
    expect(determineContactStrategy((await getLead(l.id))!).kind).toBe("email-first");
    expect(await bucketsFor(l.id)).toEqual(["email"]); // re-queued to email, no manual step
  });

  it("supersedes an obsolete call task from a prior no-answer (no duplicate call+email work)", async () => {
    const l = await seedCallFirst();
    await saveCallOutcomeAction(l.id, { outcome: "no-answer" }); // creates a call follow-up task + nextFollowUpAt
    expect(await openTypes(l.id)).toEqual(expect.arrayContaining(["review_and_send", "call"]));

    await saveCallOutcomeAction(l.id, { outcome: "asked-to-send", verifiedEmail: "info@wilshirelawfirm.com" });
    // The obsolete call task is resolved; only the email/send work remains.
    expect(await openTypes(l.id)).toEqual(["review_and_send"]);
    expect(await bucketsFor(l.id)).toEqual(["email"]); // NOT ['email','call']
    expect((await getLead(l.id))?.nextFollowUpAt).toBeNull(); // obsolete call-back cleared
    expect((await listAudit(500)).some((a) => a.targetId === l.id && a.action === "lead.route.email-gained")).toBe(true);
  });

  it("ensures a review/send task exists so the lead queues for email even if it had none", async () => {
    // A no-channel lead (no outreach task in call/email) that manually gains an email.
    const base = makeLead({ businessName: "Glendale Plaza", phone: null, publicEmail: null, website: null, socialLinks: [], note: null });
    const { id, createdAt, updatedAt, ...rest } = base;
    const l = await insertLead(rest);
    const res = await saveManualContactAction(l.id, { publicEmail: "office@glendaleplaza.com", source: "Reception", verified: true });
    expect(res.ok).toBe(true);
    expect(determineContactStrategy((await getLead(l.id))!).kind).toBe("email-first");
    expect(await openTypes(l.id)).toContain("review_and_send"); // send/review work created
    expect(await bucketsFor(l.id)).toContain("email");
  });

  it("preserves the permission model: contact-collected keeps the lead call-first (no auto-send)", async () => {
    const l = await seedCallFirst();
    await saveCallOutcomeAction(l.id, { outcome: "contact-collected", contactName: "Reception", verifiedEmail: "info@wilshirelawfirm.com" });
    // email lands on the CONTACT, not the send route → still call-first
    expect((await getLead(l.id))?.publicEmail).toBeNull();
    expect(determineContactStrategy((await getLead(l.id))!).kind).toBe("call-first");
    expect((await contactsForLead(l.id)).some((c) => c.email === "info@wilshirelawfirm.com")).toBe(true);
  });

  it("keeps every collected email in history; the lead's publicEmail is the preferred route", async () => {
    const l = await seedCallFirst();
    await saveCallOutcomeAction(l.id, { outcome: "contact-collected", contactName: "Front desk", verifiedEmail: "info@wilshirelawfirm.com" });
    await saveCallOutcomeAction(l.id, { outcome: "asked-to-send", contactName: "Attorney", verifiedEmail: "attorney@wilshirelawfirm.com" });
    const emails = (await contactsForLead(l.id)).map((c) => c.email).filter(Boolean);
    expect(emails).toEqual(expect.arrayContaining(["info@wilshirelawfirm.com", "attorney@wilshirelawfirm.com"])); // history kept
    expect((await getLead(l.id))?.publicEmail).toBe("attorney@wilshirelawfirm.com"); // preferred route = the one to send to
  });
});

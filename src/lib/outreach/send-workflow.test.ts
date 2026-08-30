import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// Server actions call revalidatePath, which needs a request context — stub it.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
import { insertLead, upsertBusinessIntelligence, emailSendsForLead, getLead, plansForLead, allTasks } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
// Give a seeded BI two evidence-backed (Observed) findings so its Quick Review is SENDABLE — these
// tests exercise the SEND PIPELINE, not the evidence gate (which correctly blocks a weak review).
function sendable<T extends { businessProfile: { opportunities: any[] } }>(bi: T): T {
  // Distinct whyItMatters per opportunity — real BI never gives two findings the same consequence,
  // and the editorial-quality gate (correctly) blocks a review that repeats itself.
  const ev = (category: string, observation: string, why: string) => ({
    id: category, category, observation, whyItMatters: why,
    estimatedImpact: { level: "High", rationale: "A concrete fix." }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"],
  });
  bi.businessProfile.opportunities = [
    ev("Scheduling", "The site has no online booking — reservations require a phone call during business hours.", "New customers who won't call during business hours quietly drop off before they ever reach the desk."),
    ev("Brand Experience", "The homepage has no clear primary call to action for a first-time visitor.", "A first-time visitor with no obvious next move is the one most likely to leave without acting."),
    ...bi.businessProfile.opportunities,
  ];
  return bi;
}

import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "../comms/resend-test-harness";
import { __resetStoreForTests } from "../store";
import { sendIntroductionAction } from "./send-actions";
import { deriveOutreachState } from "./state";
import { computeNextAction } from "./next-action";
import type { Lead } from "../types";

// The operator send path (resolveLeadBrand / renderQuickReviewPdf) resolves brand assets over the SAME
// mocked fetch BEFORE the Resend send — so rf.calls.send is not a clean send count for this path
// (dispatch.test.ts documents the same caveat). The real outbound sends are Resend /emails bodies:
// valid email JSON carrying a `to` + `from` + `subject`. Identify them by parsing, and count/inspect
// only those.
function resendEmailBodies(calls: ReturnType<typeof resendFetch>["calls"]): any[] {
  return calls.bodies
    .map((b) => { try { return JSON.parse(b); } catch { return null; } })
    .filter((j) => j && j.to && j.from && j.subject);
}

async function seedQualifiedLead(): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Workflow Dental", normalizedName: "workflow dental", industry: "Dental practice",
    normalizedCategory: "dentist", categoryGroup: "Health and Wellness", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://w.example", websiteDomain: "w.example",
    publicEmail: "office@w.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 200,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "A", leadScore: 82,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000,
    recommendedService: "Business Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}

const realFetch = global.fetch;
let rf: ReturnType<typeof resendFetch>;

// The parsed Resend email body of the n-th (1-based) ACTUAL send — filtering out brand/PDF asset fetches.
const sentEmail = (n = 1) => resendEmailBodies(rf.calls)[n - 1] ?? {};
// The number of real Resend /emails submissions (excludes brand/PDF asset fetches on the same mock).
const emailSendCount = () => resendEmailBodies(rf.calls).length;

beforeEach(() => {
  __resetStoreForTests();
  configureResendTestEnv(); // cold outreach delivers via the compliant Resend transport
  process.env.OUTREACH_SENDING_ENABLED = "1"; // the operator send path still requires the deliberate gate
  rf = resendFetch(); // 200 = accepted; providerMessageId = the Resend id
  global.fetch = rf.fn;
});
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); delete process.env.OUTREACH_SENDING_ENABLED; vi.restoreAllMocks(); });

describe("v2 introduction — real send through the pipeline, then Waiting, no duplicate", () => {
  it("sends once, records the provider id, and blocks a second introduction", async () => {
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });

    const r1 = await sendIntroductionAction(lead.id);
    expect(r1.outcome).toBe("sent");
    expect(r1.providerMessageId).toBeTruthy(); // Resend returns the real provider message id
    expect(emailSendCount()).toBe(1);
    // the real HTML template was delivered
    const html = sentEmail().html;
    expect(html).toContain("Artifex Labs");
    expect(html).not.toContain("{{unsubscribe}}");

    // The ledger now shows an accepted send → the lead is in Waiting.
    const ledger = await emailSendsForLead(lead.id);
    expect(ledger.some((s) => !!s.sentAt)).toBe(true);
    const state = deriveOutreachState({
      now: "2026-07-22T12:00:00.000Z", lead, deliverables: [{ content: {} }], videos: [], emailSends: ledger,
      meetings: [], inbound: [], videoRecommended: true, confidenceHigh: true,
    });
    expect(computeNextAction(state).kind).toBe("wait");

    // A second introduction is refused — no second email.
    const r2 = await sendIntroductionAction(lead.id);
    expect(r2.outcome).toBe("blocked");
    expect(r2.reason).toMatch(/already sent|Waiting/i);
    expect(emailSendCount()).toBe(1);
  });

  it("the deliberate sending gate blocks dispatch and sends nothing when off", async () => {
    delete process.env.OUTREACH_SENDING_ENABLED;
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const r = await sendIntroductionAction(lead.id);
    expect(r.outcome).toBe("blocked");
    expect(r.reason).toMatch(/off by policy|OUTREACH_SENDING_ENABLED/i);
    expect(rf.calls.all).toBe(0);
  });
});

// WYSIWYS: what the operator edits in the Approve & Send screen is exactly what the
// provider receives — no hidden regeneration after approval.
describe("operator edits are the actual send payload", () => {
  it("sends the edited subject and body, and stores them as the canonical sent copy", async () => {
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });

    const override = { subject: "A subject I typed myself", body: "First edited paragraph.\n\nSecond edited paragraph." };
    const r = await sendIntroductionAction(lead.id, null, override);
    expect(r.outcome).toBe("sent");
    expect(emailSendCount()).toBe(1);
    // The transmitted message carries the operator's exact subject + body...
    const email = sentEmail();
    expect(email.subject).toBe("A subject I typed myself"); // subject rides the Resend body
    const content = `${email.html}\n${email.text}`;
    expect(content).toContain("First edited paragraph.");
    expect(content).toContain("Second edited paragraph.");
    // ...wrapped in the real branded template with compliance chrome intact.
    expect(content).toContain("Artifex Labs");
    expect(content).not.toContain("{{unsubscribe}}");
  });

  it("From and Reply-To both resolve to the monitored hello@ mailbox (replies land in Outlook)", async () => {
    // RESEND_FROM in this suite is "Artifex Labs <hello@artifexlabs.tech>" (the verified mailbox).
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const r = await sendIntroductionAction(lead.id);
    expect(r.outcome).toBe("sent");
    const email = sentEmail();
    expect(email.from).toContain("hello@artifexlabs.tech");
    // Reply-To is the bare sending address, so a recipient's reply returns to that
    // exact mailbox (its Microsoft 365 inbox), not a divergent contact address.
    expect(email.reply_to).toContain("hello@artifexlabs.tech");
  });

  it("an untouched send is unchanged (blank override falls back to the generated draft)", async () => {
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const r = await sendIntroductionAction(lead.id, null, { subject: "", body: "" });
    expect(r.outcome).toBe("sent");
    // The generated (non-empty) subject rides the Resend body — not a blank line.
    expect(sentEmail().subject).toMatch(/.+/); // a generated subject, not empty
  });
});

// The call → email path can produce a ready-to-send lead that was never scored into an
// acquisitionStrategy. The send must still work — it should NOT fail with "Could not prepare
// an outreach plan" for an already-prepared operator email.
describe("call-derived send without a scored acquisition strategy", () => {
  async function seedStrategylessLead(over: Partial<Lead> = {}) {
    const base = await seedQualifiedLead();
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base as any;
    return insertLead({ ...rest, website: null, websiteDomain: null, acquisitionStrategy: null, ...over } as any);
  }
  async function withBI(lead: Lead) {
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
  }

  it("prepares a plan and SENDS the prepared operator email even when acquisitionStrategy is null", async () => {
    const lead = await seedStrategylessLead({ businessName: "Villa Brasil Motel", publicEmail: "villabrasilmotel@gmail.test" });
    await withBI(lead);
    expect(lead.acquisitionStrategy).toBeNull(); // the exact Villa Brasil precondition

    const r = await sendIntroductionAction(lead.id);
    expect(r.outcome).toBe("sent"); // was: "Could not prepare an outreach plan."
    expect(emailSendCount()).toBe(1); // provider called exactly once
    expect(sentEmail().attachments?.[0]?.content_type).toBe("application/pdf"); // Quick Review still attached
    expect((await getLead(lead.id))?.acquisitionStrategy).toBe("Assisted"); // default filled in
    expect(await plansForLead(lead.id)).toHaveLength(1); // exactly one plan
  }, 20000);

  it("does not duplicate the plan on retry and blocks a second intro (idempotent)", async () => {
    const lead = await seedStrategylessLead({ publicEmail: "b@x.test" });
    await withBI(lead);
    await sendIntroductionAction(lead.id);
    const second = await sendIntroductionAction(lead.id);
    expect(second.outcome).toBe("blocked"); // already sent → no double send
    expect(await plansForLead(lead.id)).toHaveLength(1); // no duplicate plan
    expect(emailSendCount()).toBe(1);
  }, 20000);
});

// Gatekeeper-heavy practices (the seed lead is "Workflow Dental") get a CONTEXTUAL follow-up
// call AFTER the review is emailed — never a cold call before it.
describe("email → follow-up call for gatekeeper practices", () => {
  it("schedules one contextual follow-up call, a business day out, once the review is emailed", async () => {
    const lead = await seedQualifiedLead(); // dental (gatekeeper) + phone + email
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });

    const r = await sendIntroductionAction(lead.id);
    expect(r.outcome).toBe("sent");
    const calls = (await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open" && t.type === "call");
    expect(calls).toHaveLength(1); // the follow-up call
    expect(calls[0].title).toMatch(/Follow up on the review/);
    const due = new Date(calls[0].dueAt);
    expect(+due).toBeGreaterThan(Date.now()); // in the future — email lands before the call
    expect([0, 6]).not.toContain(due.getDay()); // and on a business day (not Sat/Sun)
    // Context the Call Assistant surfaces so the operator opens with "I sent over a quick review…".
    expect((await getLead(lead.id))?.note).toMatch(/Emailed the Quick Review/);
  }, 20000);

  it("does not stack follow-up calls if one is already open (idempotent)", async () => {
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    await sendIntroductionAction(lead.id);
    await sendIntroductionAction(lead.id); // blocked (already sent) — must not add a 2nd call
    expect((await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open" && t.type === "call")).toHaveLength(1);
  }, 20000);
});

// The initial email carries the one-page Artifex Quick Review as a real PDF attachment.
describe("initial email attaches the Quick Review PDF", () => {
  it("sends an application/pdf attachment with a professional filename and non-empty bytes", async () => {
    // A no-website lead reliably yields a real finding, so the review is send-ready.
    const base = await seedQualifiedLead();
    const lead = await insertLead({ ...(({ id, createdAt, updatedAt, ...rest }) => rest)(base as any), businessName: "Villa Brasil Motel", website: null, websiteDomain: null, publicEmail: "reviews@villabrasil.test" } as any);
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });

    const r = await sendIntroductionAction(lead.id);
    expect(r.outcome).toBe("sent");
    const email = sentEmail();
    // The Quick Review PDF rides as a Resend attachment: professional filename + application/pdf.
    const att = email.attachments?.[0];
    expect(att?.filename).toBe("Villa Brasil Motel — Artifex Quick Review.pdf");
    expect(att?.content_type).toBe("application/pdf");
    // The base64 attachment payload is a real (non-trivial) PDF.
    expect((att?.content ?? "").length).toBeGreaterThan(1000); // base64 of a real PDF
    // The email still carries From unchanged.
    expect(email.from).toContain("hello@artifexlabs.tech");
  }, 20000);
});

// Operator Approve & Send is a HUMAN-gated action: it must obey provider/compliance
// rules but NOT the Mon–Fri automation window (that only governs the unattended cron).
describe("operator sends are independent of the automation send window", () => {
  it("sends on a Sunday (the automation window is Mon–Fri; the operator path never consults it)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T18:00:00Z")); // a Sunday
    try {
      const lead = await seedQualifiedLead();
      const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
      await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
      const r = await sendIntroductionAction(lead.id);
      expect(r.outcome).toBe("sent"); // Sunday does not block a human-approved send
      expect(emailSendCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// A failed provider response must never masquerade as success or advance the workflow.
describe("failure semantics — a bad send is never recorded as sent", () => {
  it("a provider rejection returns failed, sends no success, and leaves the lead re-sendable", async () => {
    global.fetch = resendFetch({ send: () => 422 }).fn; // permanent validation failure
    const lead = await seedQualifiedLead();
    const bi = sendable(await analyzeBusiness({ lead, findings: [], contacts: [] }));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const r = await sendIntroductionAction(lead.id);
    expect(r.outcome).not.toBe("sent");
    const ledger = await emailSendsForLead(lead.id);
    expect(ledger.every((s) => !s.sentAt)).toBe(true); // nothing marked sent
  });
});

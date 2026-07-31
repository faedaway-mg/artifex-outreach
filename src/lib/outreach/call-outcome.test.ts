import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { revalidatePath } from "next/cache";
import { __resetStoreForTests } from "../store";
import { insertLead, getLead, contactsForLead, allTasks } from "../repo";
import { saveCallOutcomeAction, correctToAskedToSendAction } from "./call-outcome";
import { deriveCallLeadState } from "./call-state";
import { determineContactStrategy } from "./contact-strategy";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

// A call-first shaped lead: live phone, no verified email — the exact case the
// workspace exists for (The Secret House of Ivy).
async function seedCallFirstLead(over: Partial<Lead> = {}) {
  const base = makeLead({
    businessName: "The Secret House of Ivy",
    publicEmail: null,
    website: null,
    phone: "(562) 966-0379",
    pipelineStage: "Qualified",
    note: null,
    nextFollowUpAt: null,
    ...over,
  });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
  return insertLead(rest);
}

const tasksForLead = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId);

describe("saveCallOutcomeAction — the outcome IS the state change", () => {
  beforeEach(() => __resetStoreForTests());

  it("contact collected WITHOUT permission: preserves the email on the contact but does NOT auto-send", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, {
      outcome: "contact-collected",
      contactName: "Maria Ivy",
      verifiedEmail: "maria@secrethouseofivy.com",
    });

    expect(res.ok).toBe(true);
    expect(res.savedEmail).toBe(true);
    expect(res.readyToSend).toBe(false); // an address is not permission → no auto-send
    expect(res.stage).toBe("Contacted");

    const after = await getLead(lead.id);
    // The email is preserved on the CONTACT, not promoted to the lead's send route.
    expect(after?.publicEmail).toBeNull();
    expect(after?.pipelineStage).toBe("Contacted");
    expect(after?.nextFollowUpAt).toBeTruthy(); // next action is a follow-up, not a send
    expect(after?.lastContactAt).toBeTruthy();

    const contacts = await contactsForLead(lead.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Maria Ivy");
    expect(contacts[0].email).toBe("maria@secrethouseofivy.com");
    expect(contacts[0].verified).toBe(true);
    expect(contacts[0].source).toBe("conversation");
  });

  it("reached decision-maker without permission: opens the relationship, schedules a follow-up, no send", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, {
      outcome: "reached-dm",
      reachedRole: "owner",
      contactName: "Owner",
    });

    expect(res.ok).toBe(true);
    expect(res.readyToSend).toBe(false);
    expect(res.stage).toBe("Contacted");
    const after = await getLead(lead.id);
    expect(after?.publicEmail).toBeNull();
    expect(after?.nextFollowUpAt).toBeTruthy();
    const contacts = await contactsForLead(lead.id);
    expect(contacts[0].title).toBe("Owner");
  });

  it("asked to send + email: PERMISSION — sets the send route and is the only path that unblocks sending", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, {
      outcome: "asked-to-send",
      contactName: "Owner",
      verifiedEmail: "owner@secrethouseofivy.com",
    });
    expect(res.readyToSend).toBe(true);
    expect((await getLead(lead.id))?.publicEmail).toBe("owner@secrethouseofivy.com");
  });

  it("asked to send WITHOUT an email yet: keeps the lead in the call flow and schedules getting the email", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "asked-to-send", contactName: "Owner" });
    expect(res.readyToSend).toBe(false); // permission but no address — can't send yet
    const after = await getLead(lead.id);
    expect(after?.publicEmail).toBeNull();
    expect(after?.nextFollowUpAt).toBeTruthy();
  });

  it("follow up later: sets nextFollowUpAt, schedules a call task, moves to Follow-Up", async () => {
    const lead = await seedCallFirstLead();
    const when = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "follow-up", followUpAt: when });

    expect(res.stage).toBe("Follow-Up");
    expect(res.scheduledFor).toBe(when);
    const after = await getLead(lead.id);
    expect(after?.nextFollowUpAt).toBe(when);
    expect(after?.pipelineStage).toBe("Follow-Up");

    const tasks = await tasksForLead(lead.id);
    expect(tasks.some((t) => t.type === "call" && t.dueAt === when && t.status === "open")).toBe(true);
  });

  it("voicemail: schedules a retry call and does not fabricate an email", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "voicemail" });
    expect(res.ok).toBe(true);
    expect(res.readyToSend).toBe(false);
    expect(res.scheduledFor).toBeTruthy();
    const tasks = await tasksForLead(lead.id);
    expect(tasks.some((t) => t.type === "call")).toBe(true);
    expect((await getLead(lead.id))?.nextFollowUpAt).toBeTruthy();
  });

  it("no answer: schedules a retry, no contact created", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "no-answer" });
    expect(await contactsForLead(lead.id)).toHaveLength(0);
    expect((await tasksForLead(lead.id)).some((t) => t.type === "call")).toBe(true);
  });

  // The reported production case: no answer + a business with no voicemail. Voicemail
  // is independent of the outcome — every voicemail state must save successfully.
  it("no answer + each voicemail status saves, and records it for analytics", async () => {
    for (const vm of ["left", "none-available", "mailbox-full", "not-left"] as const) {
      __resetStoreForTests();
      const lead = await seedCallFirstLead();
      const res = await saveCallOutcomeAction(lead.id, { outcome: "no-answer", voicemail: vm, notes: "No voicemail" });
      expect(res.ok).toBe(true);
      expect(res.scheduledFor).toBeTruthy();
      const note = (await getLead(lead.id))?.note ?? "";
      if (vm === "none-available") expect(note).toContain("no voicemail available");
      if (vm === "mailbox-full") expect(note).toContain("mailbox full");
    }
  });

  it("no answer with NO voicemail info still saves (voicemail is never required)", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "no-answer", voicemail: null, notes: "No voicemail" });
    expect(res.ok).toBe(true);
    expect((await getLead(lead.id))?.note).toContain("no answer");
  });

  it("voicemail outcome records the voicemail state when given", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "voicemail", voicemail: "left" });
    expect(res.ok).toBe(true);
    expect((await getLead(lead.id))?.note).toContain("left a voicemail");
  });

  it("a revalidation failure never turns a committed save into a user-facing error", async () => {
    const lead = await seedCallFirstLead();
    // Simulate the post-commit revalidate throwing (the latent production defect).
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error("Invariant: static generation store missing"); });
    const res = await saveCallOutcomeAction(lead.id, { outcome: "no-answer", voicemail: "none-available" });
    expect(res.ok).toBe(true); // save succeeds despite revalidate throwing
    // and the write actually persisted (not lost)
    expect((await getLead(lead.id))?.note).toContain("no answer");
    expect((await tasksForLead(lead.id)).some((t) => t.type === "call")).toBe(true);
  });

  it("not interested: moves the lead to Lost", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "not-interested" });
    expect(res.stage).toBe("Lost");
    expect((await getLead(lead.id))?.pipelineStage).toBe("Lost");
  });

  it("business closed: marks status closed and disqualifies", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "business-closed" });
    expect(res.stage).toBe("Disqualified");
    const after = await getLead(lead.id);
    expect(after?.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(after?.pipelineStage).toBe("Disqualified");
  });

  it("wrong number: clears the follow-up without touching the email", async () => {
    const lead = await seedCallFirstLead({ nextFollowUpAt: new Date().toISOString() });
    const res = await saveCallOutcomeAction(lead.id, { outcome: "wrong-number" });
    expect(res.ok).toBe(true);
    const after = await getLead(lead.id);
    expect(after?.nextFollowUpAt).toBeNull();
    expect(after?.publicEmail).toBeNull();
  });

  it("rejects an invalid email and changes nothing", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", verifiedEmail: "not-an-email" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/valid email/i);
    const after = await getLead(lead.id);
    expect(after?.publicEmail).toBeNull();
    expect(await contactsForLead(lead.id)).toHaveLength(0);
  });

  it("appends a dated note without destroying earlier history", async () => {
    const lead = await seedCallFirstLead({ note: "Original research note." });
    await saveCallOutcomeAction(lead.id, { outcome: "no-answer", notes: "Rang out twice." });
    const after = await getLead(lead.id);
    expect(after?.note).toContain("Original research note.");
    expect(after?.note).toContain("Rang out twice.");
    expect(after?.note).toMatch(/^\[\d{4}-\d{2}-\d{2}\]/); // newest entry is dated + first
  });
});

// The whole point of the redesign: the outcome determines the ONE next state the
// operator sees. These lock each outcome to the state the workspace then renders.
describe("outcome → next single action (state machine end to end)", () => {
  beforeEach(() => __resetStoreForTests());
  const stateAfter = async (leadId: string) => deriveCallLeadState((await getLead(leadId))!);

  it("no answer → attempt-scheduled (call again), still call-first", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "no-answer" });
    expect((await stateAfter(lead.id)).kind).toBe("attempt-scheduled");
    // no email → the lead is still a call-first lead, not routed to email
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("call-first");
  });

  it("voicemail → attempt-scheduled", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "voicemail" });
    expect((await stateAfter(lead.id)).kind).toBe("attempt-scheduled");
  });

  it("follow-up requested → attempt-scheduled", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "follow-up" });
    expect((await stateAfter(lead.id)).kind).toBe("attempt-scheduled");
  });

  it("not interested → closed", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "not-interested" });
    expect((await stateAfter(lead.id))).toMatchObject({ kind: "closed", reason: "not-interested" });
  });

  it("business closed → closed/invalid", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "business-closed" });
    expect((await stateAfter(lead.id))).toMatchObject({ kind: "closed", reason: "invalid" });
  });

  it("generic email collected WITHOUT permission → stays call-first (address ≠ send route)", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", contactName: "Dana", verifiedEmail: "dana@ivy.com" });
    // The address is on the contact, not the lead's send route → the lead is still call-first.
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("call-first");
    // and its state is a scheduled follow-up, not a send.
    expect((await stateAfter(lead.id)).kind).toBe("attempt-scheduled");
  });

  it("PERMISSION to send + email → email-first (send the review) — the only auto-send path", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "asked-to-send", verifiedEmail: "owner@ivy.com" });
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("email-first");
  });

  it("receptionist provides an inbox but NOT permission → still call-first, not a send", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", reachedRole: "assistant", contactName: "Front desk", verifiedEmail: "info@ivy.com" });
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("call-first");
    expect((await getLead(lead.id))?.publicEmail).toBeNull();
  });

  it("receptionist reached without an email → still call-first (needs the email next)", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "reached-dm", reachedRole: "assistant", contactName: "Front desk" });
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("call-first");
  });
});

describe("correctToAskedToSendAction — the Wilshire correction (collected → permission)", () => {
  beforeEach(() => __resetStoreForTests());

  it("upgrades collected→asked-to-send: route set, review queued, call-back superseded", async () => {
    const lead = await seedCallFirstLead({ businessName: "Wilshire Law Firm" });
    // The real production sequence: reception gave the address, operator logged collected.
    await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", verifiedEmail: "info@wilshirelawfirm.com" });
    const before = await getLead(lead.id);
    expect(before?.publicEmail).toBeNull();
    expect((await tasksForLead(lead.id)).filter((t) => t.status === "open" && t.type === "call")).toHaveLength(1);

    const res = await correctToAskedToSendAction(lead.id);
    expect(res.ok).toBe(true);
    expect(res.readyToSend).toBe(true);

    const after = (await getLead(lead.id))!;
    // Email-first now — the collected address became the permitted send route.
    expect(after.publicEmail).toBe("info@wilshirelawfirm.com");
    expect(determineContactStrategy(after).kind).toBe("email-first");
    // The stale call-back is gone; the review work is queued; no duplicates.
    expect(after.nextFollowUpAt).toBeNull();
    const open = (await tasksForLead(lead.id)).filter((t) => t.status === "open");
    expect(open.filter((t) => t.type === "call")).toHaveLength(0);
    expect(open.filter((t) => t.type === "review_and_send")).toHaveLength(1);
    // History preserved: original outcome line still present, correction APPENDED.
    expect(after.note).toMatch(/collected contact <info@wilshirelawfirm\.com>/);
    expect(after.note).toMatch(/Correction: they asked us to send the review/);
  });

  it("is idempotent: a second correction adds no duplicate tasks, notes, or contacts", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", contactName: "Front desk", verifiedEmail: "info@ivy.com" });
    await correctToAskedToSendAction(lead.id);
    const contactsBefore = (await contactsForLead(lead.id)).length;
    const noteBefore = (await getLead(lead.id))!.note;

    const res2 = await correctToAskedToSendAction(lead.id);
    expect(res2.ok).toBe(true);
    const open = (await tasksForLead(lead.id)).filter((t) => t.status === "open");
    expect(open.filter((t) => t.type === "review_and_send")).toHaveLength(1); // still one
    expect((await contactsForLead(lead.id)).length).toBe(contactsBefore); // no new contact
    expect((await getLead(lead.id))!.note).toBe(noteBefore); // no re-appended correction
  });

  it("refuses cleanly when no collected email exists to convert", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "no-answer" });
    const res = await correctToAskedToSendAction(lead.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no collected email/i);
  });
});

describe("call-task dedupe — a lead has exactly ONE next call", () => {
  beforeEach(() => __resetStoreForTests());

  it("repeated no-answer outcomes never accumulate duplicate open call tasks", async () => {
    const lead = await seedCallFirstLead({ businessName: "L.A Center Jewelry Inc" });
    await saveCallOutcomeAction(lead.id, { outcome: "no-answer" });
    await saveCallOutcomeAction(lead.id, { outcome: "no-answer" });
    await saveCallOutcomeAction(lead.id, { outcome: "voicemail" });
    const open = (await tasksForLead(lead.id)).filter((t) => t.status === "open" && t.type === "call");
    expect(open).toHaveLength(1); // the production duplicate can never re-form
  });

  it("collected-then-follow-up keeps a single scheduled call", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", verifiedEmail: "a@b.com" });
    await saveCallOutcomeAction(lead.id, { outcome: "follow-up", followUpAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const open = (await tasksForLead(lead.id)).filter((t) => t.status === "open" && t.type === "call");
    expect(open).toHaveLength(1);
  });
});

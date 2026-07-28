import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "../store";
import { insertLead, getLead, contactsForLead, allTasks } from "../repo";
import { saveCallOutcomeAction } from "./call-outcome";
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

  it("contact collected: saves the verified email, creates a verified contact, unblocks send", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, {
      outcome: "contact-collected",
      contactName: "Maria Ivy",
      verifiedEmail: "maria@secrethouseofivy.com",
    });

    expect(res.ok).toBe(true);
    expect(res.savedEmail).toBe(true);
    expect(res.readyToSend).toBe(true); // an email route now exists → review can send
    expect(res.stage).toBe("Contacted");

    const after = await getLead(lead.id);
    expect(after?.publicEmail).toBe("maria@secrethouseofivy.com");
    expect(after?.pipelineStage).toBe("Contacted");
    expect(after?.lastContactAt).toBeTruthy();

    const contacts = await contactsForLead(lead.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Maria Ivy");
    expect(contacts[0].email).toBe("maria@secrethouseofivy.com");
    expect(contacts[0].verified).toBe(true);
    expect(contacts[0].source).toBe("conversation");
  });

  it("reached decision-maker without an email: opens the relationship but does not claim send-ready", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, {
      outcome: "reached-dm",
      reachedRole: "owner",
      contactName: "Owner",
    });

    expect(res.ok).toBe(true);
    expect(res.readyToSend).toBe(false); // no email captured yet
    expect(res.stage).toBe("Contacted");
    const after = await getLead(lead.id);
    expect(after?.publicEmail).toBeNull();
    const contacts = await contactsForLead(lead.id);
    expect(contacts[0].title).toBe("Owner");
  });

  it("asked to send + email: is the transition into the review/email send flow", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, {
      outcome: "asked-to-send",
      contactName: "Owner",
      verifiedEmail: "owner@secrethouseofivy.com",
    });
    expect(res.readyToSend).toBe(true);
    expect((await getLead(lead.id))?.publicEmail).toBe("owner@secrethouseofivy.com");
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

  it("email collected → the lead leaves call-first for the email/send workspace", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "contact-collected", contactName: "Dana", verifiedEmail: "dana@ivy.com" });
    // A verified email route now exists → strategy flips; the page renders the send flow.
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("email-first");
  });

  it("permission to send + email → email-first (send the review)", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "asked-to-send", verifiedEmail: "owner@ivy.com" });
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("email-first");
  });

  it("receptionist reached without an email → still call-first (needs the email next)", async () => {
    const lead = await seedCallFirstLead();
    await saveCallOutcomeAction(lead.id, { outcome: "reached-dm", reachedRole: "assistant", contactName: "Front desk" });
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("call-first");
  });
});

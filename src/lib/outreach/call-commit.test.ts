import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { __resetStoreForTests } from "../store";
import { insertLead, getLead, contactsForLead, allTasks, auditForTarget } from "../repo";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { saveCallOutcomeAction } from "./call-outcome";
import {
  outcomeInputFromSession,
  callSessionAuditMeta,
  findCommittedSession,
  CALL_SESSION_AUDIT_ACTION,
} from "./call-commit";
import { newSession, appendEvent, capture, type CallEvent, type CallSession } from "./call-conversation";

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

const sessionFor = (leadId: string, id: string, ...events: CallEvent[]): CallSession =>
  events.reduce((s, e) => appendEvent(s, e), newSession(leadId, id));

// ─────────────────────────────────────────────────────────────────────────────
// THE COMMIT (tests 13-15)
//
// One deliberate act, one write. Everything before it was a draft.
// ─────────────────────────────────────────────────────────────────────────────
describe("committing a tapped-through call", () => {
  beforeEach(() => __resetStoreForTests());

  it("13. a saved session produces exactly the state change the outcome always produced", async () => {
    const lead = await seedCallFirstLead();
    const s = capture(
      sessionFor(lead.id, "sess_a", "reception-answered", "transferred", "dm-answered", "direct-email", "permission-granted", "end-call"),
      { directEmail: "maria@secrethouseofivy.com", contactName: "Maria Ivy", contactRole: "owner" },
    );

    const input = outcomeInputFromSession(s);
    expect(input.outcome).toBe("asked-to-send");
    expect(input.verifiedEmail).toBe("maria@secrethouseofivy.com");
    expect(input.contactName).toBe("Maria Ivy");
    expect(input.reachedRole).toBe("owner");

    const res = await saveCallOutcomeAction(lead.id, input, s);
    expect(res.ok).toBe(true);
    expect(res.readyToSend).toBe(true);

    const after = await getLead(lead.id);
    // Permission + an address = a send route. Exactly as before the assistant existed.
    expect(after?.publicEmail).toBe("maria@secrethouseofivy.com");
    expect(after?.pipelineStage).toBe("Contacted");
    // The note reads like the call actually went.
    expect(after?.note).toContain("Reception answered → Transferred");
    expect((await contactsForLead(lead.id))).toHaveLength(1);
  });

  it("14. saving the same call twice records it once — a double tap is not two calls", async () => {
    const lead = await seedCallFirstLead();
    const s = capture(sessionFor(lead.id, "sess_b", "reception-answered", "general-email", "permission-granted", "end-call"), {
      generalEmail: "info@secrethouseofivy.com",
    });
    const input = outcomeInputFromSession(s);

    const first = await saveCallOutcomeAction(lead.id, input, s);
    const second = await saveCallOutcomeAction(lead.id, input, s);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.reason).toBe("This call was already saved.");

    // One contact, one call task set, one structured record — not two of anything.
    expect(await contactsForLead(lead.id)).toHaveLength(1);
    const records = (await auditForTarget("lead", lead.id)).filter((a) => a.action === CALL_SESSION_AUDIT_ACTION);
    expect(records).toHaveLength(1);
    // And the note was appended once, not twice.
    const after = await getLead(lead.id);
    expect((after?.note?.match(/Reception answered/g) ?? []).length).toBe(1);
  });

  it("14b. a different call on the same lead is a second record, not a duplicate", async () => {
    const lead = await seedCallFirstLead();
    const a = sessionFor(lead.id, "sess_1", "no-answer", "no-voicemail", "end-call");
    const b = sessionFor(lead.id, "sess_2", "reception-answered", "busy-callback", "end-call");

    await saveCallOutcomeAction(lead.id, outcomeInputFromSession(a), a);
    await saveCallOutcomeAction(lead.id, outcomeInputFromSession(b), b);

    const records = (await auditForTarget("lead", lead.id)).filter((r) => r.action === CALL_SESSION_AUDIT_ACTION);
    expect(records).toHaveLength(2);
    // A lead has exactly one next call, however many attempts precede it.
    const open = (await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open" && t.type === "call");
    expect(open).toHaveLength(1);
  });

  it("15. a session recorded for another business is refused, and writes nothing", async () => {
    const ivy = await seedCallFirstLead();
    const other = await seedCallFirstLead({ businessName: "Villa Brasil Motel" });
    const s = capture(sessionFor(other.id, "sess_c", "dm-answered", "direct-email", "permission-granted"), {
      directEmail: "front@villabrasil.test",
    });

    const res = await saveCallOutcomeAction(ivy.id, outcomeInputFromSession(s), s);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("different business");

    const after = await getLead(ivy.id);
    expect(after?.publicEmail).toBeNull();
    expect(after?.note).toBeNull();
    expect(after?.lastContactAt).toBe(ivy.lastContactAt);
    expect(await contactsForLead(ivy.id)).toHaveLength(0);
    expect(await auditForTarget("lead", ivy.id)).toHaveLength(0);
  });

  it("15b. saving without a session behaves exactly as it always did", async () => {
    const lead = await seedCallFirstLead();
    const res = await saveCallOutcomeAction(lead.id, { outcome: "no-answer", voicemail: "none-available" });
    expect(res.ok).toBe(true);
    // No session → no structured record. The old path is untouched.
    expect((await auditForTarget("lead", lead.id)).filter((r) => r.action === CALL_SESSION_AUDIT_ACTION)).toHaveLength(0);
    expect((await getLead(lead.id))?.nextFollowUpAt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHAT GETS WRITTEN (tests 26-35)
// ─────────────────────────────────────────────────────────────────────────────
describe("the structured record a call leaves behind", () => {
  beforeEach(() => __resetStoreForTests());

  it("26. an address given without permission is stored, but never becomes a send route", async () => {
    const lead = await seedCallFirstLead();
    const s = capture(sessionFor(lead.id, "sess_d", "reception-answered", "general-email", "email-no-permission", "end-call"), {
      generalEmail: "info@secrethouseofivy.com",
    });
    const res = await saveCallOutcomeAction(lead.id, outcomeInputFromSession(s), s);

    expect(res.ok).toBe(true);
    expect(res.readyToSend).toBe(false);
    expect((await getLead(lead.id))?.publicEmail).toBeNull();
    // The address survives on the contact, where knowing it is not permission to use it.
    expect((await contactsForLead(lead.id))[0].email).toBe("info@secrethouseofivy.com");

    const meta = (await auditForTarget("lead", lead.id)).find((r) => r.action === CALL_SESSION_AUDIT_ACTION)!.meta as Record<string, unknown>;
    expect(meta.permission).toBe(false);
    expect(meta.emailKind).toBe("general");
    expect((meta.facts as { key: string }[]).map((f) => f.key)).toContain("permission.withheld");
  });

  it("27. the record carries the path, in words, so history reads like the call", () => {
    const s = sessionFor("lead_x", "sess_e", "reception-answered", "transferred", "dm-answered");
    const meta = callSessionAuditMeta(s);
    expect(meta.sessionId).toBe("sess_e");
    expect(meta.pathLabel).toBe("Reception answered → Transferred → Decision-maker answered");
    expect(meta.path).toEqual(["reception-answered", "transferred", "dm-answered"]);
    expect(String(meta.because).length).toBeGreaterThan(10);
  });

  it("28. a language barrier is recorded as a fact, not as a rejection", async () => {
    const lead = await seedCallFirstLead();
    const s = sessionFor(lead.id, "sess_f", "spanish", "no-english-contact", "end-call");
    await saveCallOutcomeAction(lead.id, outcomeInputFromSession(s), s);

    const after = await getLead(lead.id);
    expect(after?.pipelineStage).not.toBe("Lost"); // never a loss
    expect(after?.nextFollowUpAt).toBeTruthy();    // it earns another attempt

    const meta = (await auditForTarget("lead", lead.id)).find((r) => r.action === CALL_SESSION_AUDIT_ACTION)!.meta as Record<string, unknown>;
    expect(meta.language).toMatchObject({ code: "spanish", resolved: false, needsSupport: true });
  });

  it("29. a callback window in their words is carried onto the outcome and the record", async () => {
    const lead = await seedCallFirstLead();
    const s = capture(sessionFor(lead.id, "sess_g", "reception-answered", "busy-callback", "end-call"), {
      callbackWindow: "after 3pm on weekdays",
    });
    const input = outcomeInputFromSession(s);
    expect(input.bestTime).toBe("after 3pm on weekdays");

    await saveCallOutcomeAction(lead.id, input, s);
    const meta = (await auditForTarget("lead", lead.id)).find((r) => r.action === CALL_SESSION_AUDIT_ACTION)!.meta as Record<string, unknown>;
    expect(meta.callbackWindow).toBe("after 3pm on weekdays");
  });

  it("30. a transfer between people at the business is recorded as such", () => {
    const s = capture(sessionFor("lead_x", "sess_h", "reception-answered", "transferred"), { transferTo: "owner", transferName: "Maria" });
    expect(callSessionAuditMeta(s).transfer).toEqual({ occurred: true, to: "owner", name: "Maria", succeeded: true });
  });

  it("31. what they said they care about is preserved in their words", () => {
    const s = capture(sessionFor("lead_x", "sess_i", "dm-answered", "interested-specific"), { interest: "we rebook everything by hand" });
    expect(callSessionAuditMeta(s).interests).toEqual(["we rebook everything by hand"]);
  });

  it("32. voicemail state rides along with the outcome", () => {
    expect(outcomeInputFromSession(sessionFor("l", "s", "no-answer", "voicemail-available")).voicemail).toBe("left");
    expect(outcomeInputFromSession(sessionFor("l", "s", "no-answer", "mailbox-full")).voicemail).toBe("mailbox-full");
    expect(outcomeInputFromSession(sessionFor("l", "s", "reception-answered")).voicemail).toBeNull();
  });

  it("33. the operator's own words are kept alongside the path, never instead of it", () => {
    const s = capture(sessionFor("l", "s", "dm-answered", "not-interested"), { notes: "said they just rebuilt the site" });
    expect(outcomeInputFromSession(s).notes).toBe("Decision-maker answered → Not interested · said they just rebuilt the site");
  });

  it("34. a decline is committed as a decline, whatever was learned first", async () => {
    const lead = await seedCallFirstLead();
    const s = capture(sessionFor(lead.id, "sess_j", "dm-answered", "direct-email", "not-interested", "end-call"), {
      directEmail: "maria@secrethouseofivy.com",
    });
    await saveCallOutcomeAction(lead.id, outcomeInputFromSession(s), s);

    const after = await getLead(lead.id);
    expect(after?.pipelineStage).toBe("Lost");
    // An address heard on a call that ended in "no" is NEVER a send route.
    expect(after?.publicEmail).toBeNull();
  });

  it("35. the idempotency predicate reads only what it needs, and is honest about misses", () => {
    const rows = [
      { action: "lead.updated", meta: { sessionId: "sess_x" } },
      { action: CALL_SESSION_AUDIT_ACTION, meta: { sessionId: "sess_x" } },
      { action: CALL_SESSION_AUDIT_ACTION, meta: null },
    ];
    expect(findCommittedSession(rows, "sess_x")).toBe(rows[1]);
    expect(findCommittedSession(rows, "sess_y")).toBeNull();
    expect(findCommittedSession(rows, "")).toBeNull();
    expect(findCommittedSession([], "sess_x")).toBeNull();
  });
});

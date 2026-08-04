import { describe, it, expect } from "vitest";
import {
  newSession,
  appendEvent,
  undoLast,
  truncateTo,
  replaceAt,
  capture,
  isTerminal,
  isDisposition,
  guidanceFor,
  deriveOutcome,
  deriveIntelligence,
  describePath,
  toneOf,
  EVENT_LABEL,
  type CallEvent,
  type CallSession,
} from "./call-conversation";

const CTX = { businessName: "Villa Brasil Motel", observation: "The booking page asks for a phone call before it will quote a rate" };
const NO_OBS = { businessName: "Villa Brasil Motel", observation: null };

const path = (...events: CallEvent[]): CallSession =>
  events.reduce((s, e) => appendEvent(s, e), newSession("lead_x", "sess_1"));

const say = (...events: CallEvent[]) => guidanceFor(events, CTX).say;

// ─────────────────────────────────────────────────────────────────────────────
// THE TEMPORARY SESSION (tests 9-12)
//
// The whole feature rests on one property: tapping through a call is a draft. If
// any of these fail, an operator mid-call is writing to the database by guessing.
// ─────────────────────────────────────────────────────────────────────────────
describe("the temporary session is a draft, not a write", () => {
  it("9. selecting an event mutates no lead data — it only extends a value", () => {
    const s0 = newSession("lead_x", "sess_1");
    const s1 = appendEvent(s0, "reception-answered");

    // The original is untouched: nothing anywhere else can have observed a change.
    expect(s0.path).toEqual([]);
    expect(s1).not.toBe(s0);
    expect(s1.path).toEqual(["reception-answered"]);
    // The only identity carried is the lead it was recorded for, and the commit key.
    expect(s1.leadId).toBe("lead_x");
    expect(s1.sessionId).toBe("sess_1");
    // A session holds no rows, ids, or timestamps — there is nothing here to persist
    // accidentally.
    expect(Object.keys(s1).sort()).toEqual(["captured", "leadId", "path", "sessionId"]);
  });

  it("9b. capture is likewise pure and merges rather than replaces", () => {
    const s1 = capture(path("reception-answered"), { generalEmail: "info@villa.test" });
    const s2 = capture(s1, { contactName: "Ana" });
    expect(s1.captured).toEqual({ generalEmail: "info@villa.test" });
    expect(s2.captured).toEqual({ generalEmail: "info@villa.test", contactName: "Ana" });
  });

  it("10. Back restores the previous state exactly", () => {
    const before = path("reception-answered", "transferred");
    const after = appendEvent(before, "dm-answered");
    const back = truncateTo(after, before.path.length);

    expect(back.path).toEqual(before.path);
    // Restoring the state restores the words on screen — that is what the operator
    // is actually going back to.
    expect(guidanceFor(back.path, CTX).say).toBe(guidanceFor(before.path, CTX).say);
    // truncateTo(0) returns to the opening.
    expect(truncateTo(after, 0).path).toEqual([]);
  });

  it("11. Undo removes only the last temporary event", () => {
    const s = path("reception-answered", "transferred", "dm-answered");
    const u = undoLast(s);
    expect(u.path).toEqual(["reception-answered", "transferred"]);
    // ...and nothing else about the session moves.
    expect(u.leadId).toBe(s.leadId);
    expect(u.sessionId).toBe(s.sessionId);
    expect(u.captured).toEqual(s.captured);
    // Undo at the opening is a no-op, not an error.
    expect(undoLast(newSession("lead_x", "sess_1")).path).toEqual([]);
  });

  it("11b. captured fields survive an undo — retyping an email mid-call is unacceptable", () => {
    const s = capture(path("reception-answered", "general-email"), { generalEmail: "info@villa.test" });
    expect(undoLast(s).captured.generalEmail).toBe("info@villa.test");
  });

  it("12. editing the path changes no committed data — only the derived reading", () => {
    const s = capture(path("reception-answered", "dm-unavailable"), { generalEmail: "info@villa.test" });
    const edited = replaceAt(s, 1, "dm-answered");

    expect(s.path).toEqual(["reception-answered", "dm-unavailable"]); // original untouched
    expect(edited.path).toEqual(["reception-answered", "dm-answered"]);
    // Editing rewrites the future, not the past: everything after the edit is dropped.
    const longer = path("reception-answered", "transferred", "dm-answered", "direct-email");
    expect(replaceAt(longer, 1, "dm-unavailable").path).toEqual(["reception-answered", "dm-unavailable"]);
    // Out-of-range edits are ignored rather than corrupting the path.
    expect(replaceAt(s, 9, "dm-answered")).toBe(s);
    expect(replaceAt(s, -1, "dm-answered")).toBe(s);
  });

  it("12b. a double tap of the same button is not a second event", () => {
    const s = path("reception-answered");
    expect(appendEvent(s, "reception-answered")).toBe(s);
  });

  it("12c. correcting one ending for another replaces it — both cannot be true", () => {
    const s = path("reception-answered", "not-interested", "wrong-number");
    expect(s.path).toEqual(["reception-answered", "wrong-number"]);
    expect(isDisposition("wrong-number")).toBe(true);
    expect(isDisposition("end-call")).toBe(false);
    expect(isTerminal("end-call")).toBe(true);
    expect(isTerminal("reception-answered")).toBe(false);
  });

  it("12d. hanging up never erases how the call resolved", () => {
    // REGRESSION: "end call" used to be treated as an ending like any other, so
    // tapping it after "not interested" replaced the decline — and the call
    // committed as a routine follow-up against a business that had said no.
    const s = path("dm-answered", "direct-email", "not-interested", "end-call");
    expect(s.path).toEqual(["dm-answered", "direct-email", "not-interested", "end-call"]);
    expect(deriveOutcome(s).outcome).toBe("not-interested");

    for (const d of ["wrong-number", "closed-invalid"] as const) {
      const ended = path("reception-answered", d, "end-call");
      expect(ended.path[ended.path.length - 2]).toBe(d);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DYNAMIC SCRIPT (tests 16-25)
//
// Each state must give the operator words they can say out loud, right now, that
// fit what just happened on the call.
// ─────────────────────────────────────────────────────────────────────────────
describe("the script responds to the conversation", () => {
  it("16. first contact leads with the value, not with a gatekeeper question", () => {
    const g = guidanceFor([], CTX);
    expect(g.say).toContain("review");
    expect(g.say).toContain("Villa Brasil Motel");
    expect(g.say.toLowerCase()).toContain("best email");
    // The forbidden opening: qualifying the person before offering anything.
    expect(g.say.toLowerCase()).not.toContain("who handles");
    expect(g.say.toLowerCase()).not.toContain("in charge of");
    expect(g.say.toLowerCase()).not.toContain("decision maker");
    // The opening offers a choice of what happened next — never all 27 events.
    expect(g.next.length).toBeGreaterThan(2);
    expect(g.next.length).toBeLessThan(10);
    expect(g.next).toContain("reception-answered");
    expect(g.next).toContain("no-answer");
  });

  it("17. reception state asks for the address, not for the owner", () => {
    const g = guidanceFor(["reception-answered"], CTX);
    expect(g.say.toLowerCase()).toContain("email");
    expect(g.say).toContain("review");
    expect(g.next).toContain("general-email");
    expect(g.next).toContain("transferred");
    // Reception is a route to success, not an obstacle to get past.
    expect(g.note?.toLowerCase()).toContain("don't need the owner");
  });

  it("18. the transferred state acknowledges the transfer instead of restarting", () => {
    const g = guidanceFor(["reception-answered", "transferred"], CTX);
    expect(g.say.toLowerCase()).toContain("transferred me");
    expect(g.note?.toLowerCase()).toContain("never run the cold opening twice");
    // It must not be the identical opening line read a second time.
    expect(g.say).not.toBe(guidanceFor([], CTX).say);
  });

  it("19. \"what is this about?\" gets a concise, honest value explanation", () => {
    const g = guidanceFor(["reception-answered", "asked-what-this-is"], CTX);
    expect(g.say).toContain("review");
    expect(g.say.toLowerCase()).toContain("no cost");
    expect(g.say.toLowerCase()).toContain("nothing to sign");
    expect(g.note?.toLowerCase()).toContain("stop talking");
    // Two sentences of value, not a paragraph of pitch.
    expect(g.say.length).toBeLessThan(320);
  });

  it("20. hold preserves context — the place in the conversation is kept", () => {
    const before = path("reception-answered");
    const held = appendEvent(before, "on-hold");
    const g = guidanceFor(held.path, CTX);
    expect(g.note?.toLowerCase()).toContain("nothing is lost");
    // Coming back from hold continues the same conversation.
    expect(held.path).toEqual(["reception-answered", "on-hold"]);
    expect(g.next).toContain("transferred");
    expect(g.next).toContain("dm-answered");
    // And the earlier state is still exactly recoverable.
    expect(truncateTo(held, 1).path).toEqual(before.path);
  });

  it("21. an email given moves the call toward permission, never past it", () => {
    const g = guidanceFor(["reception-answered", "general-email"], CTX);
    expect(g.say.toLowerCase()).toContain("is it alright if i send");
    expect(g.note?.toLowerCase()).toContain("an address is not a yes");
    expect(g.next).toContain("permission-granted");
    expect(g.next).toContain("email-no-permission");
  });

  it("22. permission granted shows the clean close and stops selling", () => {
    const g = guidanceFor(["reception-answered", "general-email", "permission-granted"], CTX);
    expect(g.say.toLowerCase()).toContain("send it over today");
    expect(g.say.toLowerCase()).toContain("no hard feelings");
    expect(g.note?.toLowerCase()).toContain("don't keep selling");
    expect(g.likelyOutcomes).toEqual(["asked-to-send"]);
  });

  it("23. not interested exits gracefully and never handles the objection", () => {
    const g = guidanceFor(["dm-answered", "not-interested"], CTX);
    expect(g.say.toLowerCase()).toContain("completely fair");
    expect(g.note?.toLowerCase()).toContain("no second ask");
    expect(g.next).toEqual(["end-call"]);
    // There is no "one more try" branch offered anywhere in this state.
    expect(g.next).not.toContain("permission-granted");
  });

  it("24. voicemail guidance is a short, specific, leave-able message", () => {
    const g = guidanceFor(["no-answer", "voicemail-available"], CTX);
    expect(g.say).toContain("Villa Brasil Motel");
    expect(g.say.toLowerCase()).toContain("review");
    expect(g.say.toLowerCase()).toContain("email address");
    expect(g.note?.toLowerCase()).toContain("twenty seconds");
    // The state before it asks the only question that matters: is there a mailbox?
    const prior = guidanceFor(["no-answer"], CTX);
    expect(prior.next).toContain("voicemail-available");
    expect(prior.next).toContain("no-voicemail");
    expect(prior.next).toContain("mailbox-full");
  });

  it("25. a Spanish speaker gets respectful language guidance, not improvisation", () => {
    const g = guidanceFor(["spanish"], CTX);
    expect(g.say).toContain("correo electrónico");
    expect(g.note?.toLowerCase()).toContain("don't improvise spanish");
    expect(g.next).toContain("transferred-to-english");
    expect(g.next).toContain("no-english-contact");
    expect(g.next).toContain("callback-with-language-support");
    // Clearing the barrier re-opens warmly in English, from the top.
    const cleared = guidanceFor(["spanish", "transferred-to-english"], CTX);
    expect(cleared.say).toContain("Villa Brasil Motel");
    expect(cleared.say.toLowerCase()).toContain("best email");
  });

  it("every state gives words to say, an objective, and a way forward", () => {
    const states: CallEvent[][] = [[], ...Object.keys(EVENT_LABEL).map((e) => [e as CallEvent])];
    for (const p of states) {
      const g = guidanceFor(p, CTX);
      expect(g.say.trim().length, `say for ${describePath(p) || "(opening)"}`).toBeGreaterThan(10);
      expect(g.objective.trim().length).toBeGreaterThan(5);
      // Terminal states legitimately have no next event; everything else must.
      const last = p[p.length - 1];
      if (last !== "end-call") expect(g.next.length, `next for ${last}`).toBeGreaterThan(0);
      expect(g.likelyOutcomes.length).toBeGreaterThan(0);
    }
  });

  it("the observation makes the value concrete, and its absence never breaks the line", () => {
    expect(guidanceFor(["dm-answered"], CTX).say).toContain("the booking page asks for a phone call");
    const without = guidanceFor(["dm-answered"], NO_OBS).say;
    expect(without).not.toContain("undefined");
    expect(without).not.toContain("null");
    expect(without).not.toContain(" — .");
  });

  it("no state pressures, exaggerates, or shouts", () => {
    for (const e of Object.keys(EVENT_LABEL) as CallEvent[]) {
      const g = guidanceFor([e], CTX);
      const lower = g.say.toLowerCase();
      for (const banned of ["act now", "limited time", "guarantee", "you need", "free trial", "!"]) {
        expect(lower, `${e} says "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("tone marks the good news, the bad news, and the rest", () => {
    expect(toneOf("permission-granted")).toBe("good");
    expect(toneOf("not-interested")).toBe("bad");
    expect(toneOf("on-hold")).toBe("neutral");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DERIVED OUTCOME
//
// The nine outcomes are unchanged; the assistant guides toward them. The commit
// must never surprise the operator, so every derivation carries its reason.
// ─────────────────────────────────────────────────────────────────────────────
describe("the outcome derived from the path", () => {
  const outcomeOf = (s: CallSession) => deriveOutcome(s).outcome;

  it("permission granted commits as asked-to-send, with permission true", () => {
    const s = capture(path("dm-answered", "direct-email", "permission-granted", "end-call"), { directEmail: "ana@villa.test" });
    const d = deriveOutcome(s);
    expect(d.outcome).toBe("asked-to-send");
    expect(d.permission).toBe(true);
    expect(d.email).toBe("ana@villa.test");
    expect(d.because.length).toBeGreaterThan(10);
  });

  it("\"just email me\" is permission — it is the thing we called for", () => {
    const d = deriveOutcome(path("reception-answered", "asked-to-email-info"));
    expect(d.outcome).toBe("asked-to-send");
    expect(d.permission).toBe(true);
  });

  it("an address WITHOUT permission is contact intelligence, never a licence to send", () => {
    const s = capture(path("reception-answered", "general-email", "email-no-permission"), { generalEmail: "info@villa.test" });
    const d = deriveOutcome(s);
    expect(d.outcome).toBe("contact-collected");
    expect(d.permission).toBe(false);
    expect(d.email).toBe("info@villa.test");
    expect(d.because.toLowerCase()).toContain("not permission");
  });

  it("a decline overrides everything that came before it", () => {
    const s = capture(path("dm-answered", "direct-email", "not-interested"), { directEmail: "ana@villa.test" });
    const d = deriveOutcome(s);
    expect(d.outcome).toBe("not-interested");
    expect(d.permission).toBe(false);
  });

  it("closed and wrong-number outrank a decline", () => {
    expect(outcomeOf(path("reception-answered", "closed-invalid"))).toBe("business-closed");
    expect(outcomeOf(path("no-answer", "wrong-number"))).toBe("wrong-number");
  });

  it("reaching the decision-maker without an address is reached-dm", () => {
    expect(outcomeOf(path("reception-answered", "transferred", "dm-answered"))).toBe("reached-dm");
    expect(outcomeOf(path("dm-answered", "interested-broader"))).toBe("reached-dm");
  });

  it("voicemail states carry the voicemail status, and no mailbox is not a voicemail", () => {
    const left = deriveOutcome(path("no-answer", "voicemail-available"));
    expect(left.outcome).toBe("voicemail");
    expect(left.voicemail).toBe("left");

    const none = deriveOutcome(path("no-answer", "no-voicemail"));
    expect(none.outcome).toBe("no-answer");
    expect(none.voicemail).toBe("none-available");

    const full = deriveOutcome(path("no-answer", "mailbox-full"));
    expect(full.outcome).toBe("no-answer");
    expect(full.voicemail).toBe("mailbox-full");
  });

  it("an unresolved conversation schedules a follow-up rather than reading as a loss", () => {
    expect(outcomeOf(path("reception-answered", "dm-unavailable"))).toBe("follow-up");
    expect(outcomeOf(path("spanish", "no-english-contact"))).toBe("follow-up");
    expect(outcomeOf(path("reception-answered", "busy-callback"))).toBe("follow-up");
  });

  it("an empty path never invents a conversation", () => {
    const d = deriveOutcome(newSession("lead_x", "sess_1"));
    expect(d.outcome).toBe("no-answer");
    expect(d.permission).toBe(false);
    expect(d.email).toBeNull();
  });

  it("the end-call state previews the outcome it is about to commit", () => {
    const p: CallEvent[] = ["dm-answered", "direct-email", "permission-granted", "end-call"];
    expect(guidanceFor(p, CTX).likelyOutcomes).toEqual(["asked-to-send"]);
    expect(guidanceFor(["no-answer", "no-voicemail", "end-call"], CTX).likelyOutcomes).toEqual(["no-answer"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED INTELLIGENCE
//
// The taps are the only structured record we will ever get of a phone call. Prose
// cannot be queried; these facts can.
// ─────────────────────────────────────────────────────────────────────────────
describe("structured intelligence captured from the taps", () => {
  const keys = (s: CallSession) => deriveIntelligence(s).facts.map((f) => f.key);

  it("records who answers the phone and how the business routes a call", () => {
    const k = keys(path("reception-answered", "transferred", "dm-answered"));
    expect(k).toContain("reception.answers-phone");
    expect(k).toContain("reception.routes-inquiries");
    expect(k).toContain("decision-maker.reachable-by-phone");
  });

  it("distinguishes a verified general address from a verified direct one", () => {
    const g = deriveIntelligence(capture(path("reception-answered", "general-email"), { generalEmail: "info@villa.test" }));
    expect(g.emailKind).toBe("general");
    expect(g.facts).toContainEqual({ key: "email.general-verified", value: "info@villa.test" });

    const d = deriveIntelligence(capture(path("dm-answered", "direct-email"), { directEmail: "ana@villa.test" }));
    expect(d.emailKind).toBe("direct");
    expect(d.facts).toContainEqual({ key: "email.direct-verified", value: "ana@villa.test" });
  });

  it("records permission and its withholding as separate, explicit facts", () => {
    const yes = deriveIntelligence(path("general-email", "permission-granted"));
    expect(yes.permission).toBe(true);
    expect(yes.facts.map((f) => f.key)).toContain("permission.may-send-review");

    const no = deriveIntelligence(path("general-email", "email-no-permission"));
    expect(no.permission).toBe(false);
    expect(no.facts.map((f) => f.key)).toContain("permission.withheld");
    expect(no.facts.map((f) => f.key)).not.toContain("permission.may-send-review");
  });

  it("records the language met, whether it was resolved, and whether support is needed", () => {
    const unresolved = deriveIntelligence(path("spanish", "no-english-contact"));
    expect(unresolved.language).toEqual({ code: "spanish", detail: undefined, resolved: false, needsSupport: true });
    expect(unresolved.facts).toContainEqual({ key: "language.encountered", value: "spanish" });
    expect(unresolved.facts.map((f) => f.key)).toContain("language.support-needed");

    const resolved = deriveIntelligence(path("spanish", "transferred-to-english", "general-email"));
    expect(resolved.language?.resolved).toBe(true);
    expect(resolved.language?.needsSupport).toBe(false);

    const other = deriveIntelligence(capture(path("other-language"), { languageOther: "Korean" }));
    expect(other.language?.code).toBe("other");
    expect(other.facts).toContainEqual({ key: "language.encountered", value: "Korean" });
  });

  it("records a transfer between people at the business, and whether it survived", () => {
    const ok = deriveIntelligence(capture(path("reception-answered", "transferred"), { transferTo: "owner", transferName: "Ana" }));
    expect(ok.transfer).toEqual({ occurred: true, to: "owner", name: "Ana", succeeded: true });

    const dropped = deriveIntelligence(path("reception-answered", "transferred", "transfer-failed"));
    expect(dropped.transfer?.occurred).toBe(true);
    expect(dropped.transfer?.succeeded).toBe(false);
    expect(dropped.transfer?.to).toBe("unknown");

    expect(deriveIntelligence(path("dm-answered")).transfer).toBeNull();
  });

  it("records the callback window in their words", () => {
    const i = deriveIntelligence(capture(path("reception-answered", "busy-callback"), { callbackWindow: "after 3pm on weekdays" }));
    expect(i.callbackWindow).toBe("after 3pm on weekdays");
    expect(i.facts).toContainEqual({ key: "callback.preferred-window", value: "after 3pm on weekdays" });
  });

  it("records what they said they care about, in their words", () => {
    const i = deriveIntelligence(capture(path("dm-answered", "interested-specific"), { interest: "we rebook everything by hand" }));
    expect(i.interests).toEqual(["we rebook everything by hand"]);
    expect(i.facts).toContainEqual({ key: "interest.specific-issue", value: "we rebook everything by hand" });
  });

  it("records that a business has no usable voicemail — that is information, not failure", () => {
    expect(keys(path("no-answer", "no-voicemail"))).toContain("voicemail.none-available");
    expect(keys(path("no-answer", "mailbox-full"))).toContain("voicemail.mailbox-full");
  });

  it("invents nothing when nothing was learned", () => {
    const i = deriveIntelligence(newSession("lead_x", "sess_1"));
    expect(i.facts).toEqual([]);
    expect(i.language).toBeNull();
    expect(i.transfer).toBeNull();
    expect(i.callbackWindow).toBeNull();
    expect(i.emailKind).toBeNull();
    expect(i.permission).toBe(false);
    expect(i.interests).toEqual([]);
  });

  it("the path reads back as what actually happened, not as a code", () => {
    expect(describePath(["reception-answered", "transferred", "dm-answered", "permission-granted"]))
      .toBe("Reception answered → Transferred → Decision-maker answered → Said yes — send the review");
    expect(describePath([])).toBe("");
  });
});

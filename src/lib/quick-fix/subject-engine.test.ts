// ─────────────────────────────────────────────────────────────────────────────
// CURIOSITY-FIRST SUBJECT ENGINE + OUTREACH LIFECYCLE — behavioral tests.
//
// Nothing here sends email. The store runs on the in-memory backing (no DATABASE_URL),
// so lifecycle transitions are exercised end-to-end against the real store helpers.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import * as store from "./store";
import { generateOffer } from "./offer-engine";
import type { OfferFinding, QuickFixOffer } from "./types";
import {
  generateSubjectCandidates,
  classifyDefectFamily,
  isPolicyCompliantSubject,
  subjectCandidateList,
  SUBJECT_POLICY_VERSION,
} from "./subject-engine";
import { composeOfferOutreach, offerSubject } from "./offer-outreach";
import { outreachLifecycleView } from "./outreach-lifecycle-view";
import { subjectOutcomeEvent, summarizeSubjectCohorts, evaluatePromotion, MIN_PROMOTION_SAMPLE } from "./subject-tracking";

const NOW = "2026-09-09T00:00:00Z";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});

const FORM = F({ id: "form", observation: "the contact form submission appears broken and inquiries never arrive", category: "Communication" });
const BOOKING = F({ id: "book", observation: "there is no online booking so visitors cannot schedule an appointment", category: "Customer Acquisition" });
const MOBILE_BOOKING = F({ id: "mb", observation: "the appointment booking flow is broken on mobile phones", category: "Customer Acquisition" });
const READ = F({ id: "read", observation: "the body text has poor contrast and low readability, failing accessibility", category: "Brand Experience" });
const SEARCH = F({ id: "seo", observation: "the page meta description and title tag are missing so the google search listing is wrong", category: "Customer Acquisition" });
const ANALYTICS = F({ id: "an", observation: "there is no analytics or tracking installed to measure conversions", category: "Customer Acquisition" });
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile", category: "Customer Acquisition" });

async function seedOffer(findings: OfferFinding[]): Promise<store.StoredOffer> {
  const raw = generateOffer({ leadId: "lead_1", companyName: "Acme Dental", findings, generatedAt: null });
  return store.upsertOffer(raw as unknown as QuickFixOffer, { recipientEmail: "c@x.com", now: NOW });
}

beforeEach(() => { __resetStoreForTests(); });

// ── SUBJECT ENGINE ───────────────────────────────────────────────────────────────
describe("subject engine — evidence-derived, curiosity from brevity", () => {
  it("1. contact-form defect → business-language 'contact question' (§16-18)", () => {
    const c = generateSubjectCandidates({ observation: FORM.observation });
    expect(c.family).toBe("contact");
    expect(c.primary).toBe("contact question");
    expect(c.primary).not.toMatch(/website (inquiry|note|review)/); // retired web-sales framing
  });

  it("2. booking defect → 'booking question'", () => {
    const c = generateSubjectCandidates({ observation: BOOKING.observation });
    expect(c.family).toBe("booking");
    expect(c.primary).toBe("booking question");
  });

  it("3. NO contact-form evidence does NOT become 'contact question'", () => {
    const c = generateSubjectCandidates({ observation: READ.observation });
    expect(c.family).not.toBe("contact");
    expect([c.primary, ...c.alternates]).not.toContain("contact question");
  });

  it("4. NO booking evidence does NOT become 'booking question'", () => {
    const c = generateSubjectCandidates({ observation: SEARCH.observation });
    expect(c.family).toBe("search");
    expect(c.primary).not.toBe("booking question");
  });

  it("5. singular is preserved — no 'inquiries'/'bookings'", () => {
    const c = generateSubjectCandidates({ observation: FORM.observation });
    expect(c.primary).toBe("contact question");
    expect(c.primary).not.toMatch(/inquiries|bookings/);
  });

  it("6. no company name in a default first-touch subject", () => {
    const c = generateSubjectCandidates({ observation: FORM.observation, companyName: "Acme Dental" });
    for (const s of subjectCandidateList(c)) expect(s.toLowerCase()).not.toContain("acme");
  });

  it("7. every candidate is 1–3 words (4 max)", () => {
    for (const f of [FORM, BOOKING, MOBILE_BOOKING, READ, SEARCH, ANALYTICS]) {
      const c = generateSubjectCandidates({ observation: f.observation });
      for (const s of subjectCandidateList(c)) expect(s.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  it("8. every candidate is lowercase / inbox-native", () => {
    for (const f of [FORM, BOOKING, READ, SEARCH, ANALYTICS]) {
      const c = generateSubjectCandidates({ observation: f.observation });
      for (const s of subjectCandidateList(c)) {
        expect(s).toBe(s.toLowerCase());
        expect(s).not.toMatch(/[!$%•★→*]|[A-Z]{2,}/);
      }
    }
  });

  it("9. no CTA/acronym leaks into the subject (CTA translated to a topic)", () => {
    const c = generateSubjectCandidates({ observation: CTA.observation });
    for (const s of subjectCandidateList(c)) {
      expect(s).not.toMatch(/\bcta\b|\bseo\b|\bgbp\b/i);
    }
  });

  it("10. never a Quick-Fix/Artifex/price/promo prefix", () => {
    for (const f of [FORM, BOOKING, SEARCH]) {
      const c = generateSubjectCandidates({ observation: f.observation });
      for (const s of subjectCandidateList(c)) {
        expect(s).not.toMatch(/artifex|quick[-\s]?fix|repair|audit|diagnostic|free|discount|offer|quote|\$/i);
      }
    }
  });

  it("11. no fake urgency", () => {
    for (const f of [FORM, BOOKING]) {
      const c = generateSubjectCandidates({ observation: f.observation });
      for (const s of subjectCandidateList(c)) expect(s).not.toMatch(/urgent|immediately|act now|last chance/i);
    }
  });

  it("12. no fake RE:/FWD:", () => {
    for (const f of [FORM, BOOKING, SEARCH]) {
      const c = generateSubjectCandidates({ observation: f.observation });
      for (const s of subjectCandidateList(c)) expect(s).not.toMatch(/^\s*(re:|fwd:)/i);
    }
  });

  it("13. no false 'new customer inquiry'/'booking request'/'missed appointment' premise", () => {
    for (const f of [FORM, BOOKING, MOBILE_BOOKING]) {
      const c = generateSubjectCandidates({ observation: f.observation });
      for (const s of subjectCandidateList(c)) {
        expect(s).not.toMatch(/new customer inquiry|booking request|missed appointment|payment issue|customer complaint/i);
      }
    }
  });

  it("14. all THREE candidates map to the issue (topic/action/surface) and are distinct", () => {
    const c = generateSubjectCandidates({ observation: FORM.observation });
    expect(c.primary).toBe("contact question");
    expect(c.alternates).toEqual(["your contact form", "getting in touch"]);
    expect(new Set([c.primary, ...c.alternates]).size).toBe(3);
  });

  it("15. mobile+booking → 'booking on mobile' (mobile-qualified family)", () => {
    const c = generateSubjectCandidates({ observation: MOBILE_BOOKING.observation });
    expect(c.family).toBe("mobile_booking");
    expect(c.primary).toBe("booking on mobile");
  });

  it("16. readability/search/analytics map to business-language topics (no 'website X')", () => {
    expect(generateSubjectCandidates({ observation: READ.observation }).primary).toBe("reading your site");
    expect(generateSubjectCandidates({ observation: SEARCH.observation }).primary).toBe("finding you on google");
    expect(generateSubjectCandidates({ observation: ANALYTICS.observation }).primary).toBe("tracking your leads");
  });

  it("17. an unmapped/vague observation → neutral 'quick question' (§16), never invents a defect", () => {
    const c = generateSubjectCandidates({ observation: "something about the overall brand feel" });
    expect(c.family).toBe("generic");
    expect(isPolicyCompliantSubject(c.primary)).toBe(true);
    expect(c.primary).toBe("quick question");
    expect(c.primary).not.toMatch(/website (note|inquiry|review)/); // retired framing
  });

  it("18. classifier requires the evidence to actually describe the family", () => {
    expect(classifyDefectFamily({ observation: BOOKING.observation })).toBe("booking");
    expect(classifyDefectFamily({ observation: FORM.observation })).toBe("contact");
    // A booking family is NOT reached without booking/appointment evidence.
    expect(classifyDefectFamily({ observation: "the logo is blurry" })).toBe("generic");
  });

  it("19. policy stamp + defectType are attached", () => {
    const c = generateSubjectCandidates({ observation: FORM.observation });
    expect(c.policyVersion).toBe(SUBJECT_POLICY_VERSION);
    expect(c.defectType).toBe(c.family);
  });

  it("20. isPolicyCompliantSubject rejects caps, promo, price, false premise, too-long", () => {
    expect(isPolicyCompliantSubject("website inquiry")).toBe(true);
    expect(isPolicyCompliantSubject("Website Inquiry")).toBe(false);
    expect(isPolicyCompliantSubject("free audit")).toBe(false);
    expect(isPolicyCompliantSubject("save $99 today")).toBe(false);
    expect(isPolicyCompliantSubject("re: your account")).toBe(false);
    expect(isPolicyCompliantSubject("missed appointment")).toBe(false);
    expect(isPolicyCompliantSubject("a rather long subject line indeed here")).toBe(false);
  });
});

// ── offer-outreach uses the engine (old branches removed) ─────────────────────────
describe("offer-outreach subject now comes from the engine", () => {
  it("21. eligible offer subject is engine-derived, not 'name — $price'", async () => {
    const offer = await seedOffer([FORM]);
    const copy = composeOfferOutreach(offer as unknown as QuickFixOffer, { buyUrl: "x", bookingUrl: "y" });
    expect(copy.subject).toBe(offerSubject(offer as unknown as QuickFixOffer));
    expect(copy.subject).not.toMatch(/\$|—/);
    expect(isPolicyCompliantSubject(copy.subject)).toBe(true);
  });

  it("22. non-eligible offer subject is engine-derived, not 'A quick note on <company>'", async () => {
    // A vague/broad finding tends to be non-eligible; regardless, the subject must be
    // evidence-derived and never contain the company name.
    const offer = await seedOffer([CTA]);
    const copy = composeOfferOutreach({ ...(offer as unknown as QuickFixOffer), quickFixEligible: false, notEligibleReason: "broader than a fixed fix" }, { buyUrl: "x", bookingUrl: "y" });
    expect(copy.primaryCta).toBe("BOOK_A_CONVERSATION");
    expect(copy.subject.toLowerCase()).not.toContain("acme");
    expect(copy.subject).not.toMatch(/a quick note on/i);
    expect(isPolicyCompliantSubject(copy.subject)).toBe(true);
  });
});

// ── LIFECYCLE: select / approve-freeze / invalidate / send-gate / schedule ─────────
describe("outreach lifecycle backend", () => {
  it("23. operator can select an alternate candidate", async () => {
    const offer = await seedOffer([FORM]);
    const res = await store.selectOutreachSubject(offer.offerId, "contact form", { family: "contact", alternatives: ["website inquiry", "website contact"], policyVersion: SUBJECT_POLICY_VERSION, actor: "op", now: NOW });
    expect(res.ok).toBe(true);
    const view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.subject.selected).toBe("contact form");
    expect(view.outreachState).toBe("NEEDS_REVIEW");
  });

  it("24. subject freezes on approval; state → APPROVED_NOT_SENT (never sends)", async () => {
    const offer = await seedOffer([FORM]);
    await store.selectOutreachSubject(offer.offerId, "website inquiry", { actor: "op", now: NOW });
    const res = await store.approveOutreach(offer.offerId, { actor: "op", now: NOW });
    expect(res.ok).toBe(true);
    const view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.subject.frozen).toBe(true);
    expect(view.outreachState).toBe("APPROVED_NOT_SENT");
    expect(view.sentAt).toBeNull(); // approval NEVER sends
  });

  it("25. approve requires a selected subject", async () => {
    const offer = await seedOffer([FORM]);
    const res = await store.approveOutreach(offer.offerId, { actor: "op", now: NOW });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_subject");
  });

  it("26. editing the subject after approval INVALIDATES approval → NEEDS_REVIEW, unfrozen", async () => {
    const offer = await seedOffer([FORM]);
    await store.selectOutreachSubject(offer.offerId, "website inquiry", { actor: "op", now: NOW });
    await store.approveOutreach(offer.offerId, { actor: "op", now: NOW });
    // Frozen ⇒ a plain select is refused (the route would 409).
    const blocked = await store.selectOutreachSubject(offer.offerId, "contact form", { actor: "op", now: NOW });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("frozen");
    const view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.subject.frozen).toBe(true); // unchanged — still approved
  });

  it("27. subject select/approve NEVER alters scope/price/evidence/SKU/share token", async () => {
    const offer = await seedOffer([FORM]);
    const before = (await store.getOffer(offer.offerId))!;
    await store.selectOutreachSubject(offer.offerId, "website inquiry", { actor: "op", now: NOW });
    await store.approveOutreach(offer.offerId, { actor: "op", now: NOW });
    const after = (await store.getOffer(offer.offerId))!;
    expect(after.priceCents).toBe(before.priceCents);
    expect(after.scope).toEqual(before.scope);
    expect(after.findingIds).toEqual(before.findingIds);
    expect(after.capabilityKeys).toEqual(before.capabilityKeys);
    expect(after.shareToken).toBe(before.shareToken);
    expect(after.offerVersion).toBe(before.offerVersion);
  });

  it("28. markOutreachSent moves APPROVED_NOT_SENT → SENT and records dispatch facts", async () => {
    const offer = await seedOffer([FORM]);
    await store.selectOutreachSubject(offer.offerId, "website inquiry", { actor: "op", now: NOW });
    await store.approveOutreach(offer.offerId, { actor: "op", now: NOW });
    const res = await store.markOutreachSent(offer.offerId, { actor: "op", now: NOW, mailbox: "primary", recipient: "c@x.com" });
    expect(res.ok).toBe(true);
    const view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.outreachState).toBe("SENT");
    expect(view.sentRecipient).toBe("c@x.com");
    expect(view.canSend).toBe(false); // never re-send
  });

  it("29. cannot send an un-approved artifact", async () => {
    const offer = await seedOffer([FORM]);
    const res = await store.markOutreachSent(offer.offerId, { actor: "op", now: NOW, mailbox: null, recipient: null });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_sendable");
  });

  it("30. schedule requires approval; reschedule + cancel work", async () => {
    const offer = await seedOffer([FORM]);
    // Not approved yet → refused.
    expect((await store.scheduleOutreach(offer.offerId, { scheduledAt: "2026-09-10T15:00:00Z", tz: "America/Los_Angeles", actor: "op", now: NOW })).reason).toBe("not_approved");
    await store.selectOutreachSubject(offer.offerId, "website inquiry", { actor: "op", now: NOW });
    await store.approveOutreach(offer.offerId, { actor: "op", now: NOW });
    // Schedule.
    await store.scheduleOutreach(offer.offerId, { scheduledAt: "2026-09-10T15:00:00Z", tz: "America/Los_Angeles", actor: "op", now: NOW });
    let view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.outreachState).toBe("SCHEDULED");
    expect(view.scheduledTz).toBe("America/Los_Angeles");
    // Reschedule.
    await store.scheduleOutreach(offer.offerId, { scheduledAt: "2026-09-11T15:00:00Z", tz: "America/New_York", actor: "op", now: NOW });
    view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.scheduledAt).toBe("2026-09-11T15:00:00Z");
    // Cancel → back to approved-not-sent.
    await store.scheduleOutreach(offer.offerId, { scheduledAt: null, tz: null, actor: "op", now: NOW });
    view = (await outreachLifecycleView(offer.offerId))!;
    expect(view.outreachState).toBe("APPROVED_NOT_SENT");
    expect(view.scheduledAt).toBeNull();
  });

  it("31. lifecycle view exposes the exact shape + can* gates", async () => {
    const offer = await seedOffer([FORM]);
    const v0 = (await outreachLifecycleView(offer.offerId))!;
    expect(v0).toMatchObject({
      offerId: offer.offerId,
      outreachState: "NEEDS_REVIEW",
      subject: { selected: null, alternatives: [], family: null, frozen: false },
      scheduledAt: null, scheduledTz: null, sentAt: null, sentMailbox: null, sentRecipient: null,
      canApprove: false, canSend: false, canSchedule: false,
    });
    await store.selectOutreachSubject(offer.offerId, "website inquiry", { actor: "op", now: NOW });
    const v1 = (await outreachLifecycleView(offer.offerId))!;
    expect(v1.canApprove).toBe(true); // has subject
    expect(v1.canSend).toBe(false); // not approved
  });
});

// ── TRACKING (L) ─────────────────────────────────────────────────────────────────
describe("subject tracking — purchase-per-delivered, no auto-promotion under sample", () => {
  it("32. downstream outcomes are attributable to the subject version/family/defectType", () => {
    const ev = subjectOutcomeEvent("qfo_1", { subjectText: "website inquiry", subjectFamily: "contact", policyVersion: SUBJECT_POLICY_VERSION, defectType: "contact", vertical: "dental", marketTier: "mid" }, "purchase");
    expect(ev.action).toBe("quickfix.subject_outcome");
    expect(ev.targetId).toBe("qfo_1");
    expect(ev.meta).toMatchObject({ subjectText: "website inquiry", subjectFamily: "contact", policyVersion: SUBJECT_POLICY_VERSION, defectType: "contact", vertical: "dental", marketTier: "mid", outcome: "purchase" });
  });

  it("33. cohorts optimize PURCHASE PER DELIVERED (not opens)", () => {
    const mk = (outcome: any) => ({ subjectText: "website inquiry", subjectFamily: "contact", policyVersion: "subject.v1", defectType: "contact", vertical: null, marketTier: null, outcome });
    const events = [
      ...Array.from({ length: 4 }, () => mk("delivered")),
      mk("offer_viewed"), mk("offer_viewed"), // opens/views do NOT count toward the objective
      mk("purchase"),
    ];
    const [cohort] = summarizeSubjectCohorts(events);
    expect(cohort.delivered).toBe(4);
    expect(cohort.purchases).toBe(1);
    expect(cohort.purchasePerDelivered).toBeCloseTo(0.25, 5);
  });

  it("34. NO auto-promotion below the minimum sample; explicit versioned promotion only", () => {
    const smallV1 = Array.from({ length: 5 }, () => ({ subjectText: "a", subjectFamily: "contact", policyVersion: "subject.v1", defectType: "contact", vertical: null, marketTier: null, outcome: "delivered" as const }));
    const smallV2 = Array.from({ length: 5 }, () => ({ subjectText: "b", subjectFamily: "contact", policyVersion: "subject.v2", defectType: "contact", vertical: null, marketTier: null, outcome: "delivered" as const }));
    const decision = evaluatePromotion([...smallV1, ...smallV2], { subjectFamily: "contact", baselineVersion: "subject.v1", candidateVersion: "subject.v2" });
    expect(decision.shouldPromote).toBe(false); // insufficient sample → never a winner
    expect(MIN_PROMOTION_SAMPLE).toBeGreaterThan(5);
  });

  it("35. a sufficiently-sampled, strictly-better candidate CAN be promoted (advisory only)", () => {
    const gen = (version: string, delivered: number, purchases: number) => [
      ...Array.from({ length: delivered }, () => ({ subjectText: "s", subjectFamily: "contact", policyVersion: version, defectType: "contact", vertical: null, marketTier: null, outcome: "delivered" as const })),
      ...Array.from({ length: purchases }, () => ({ subjectText: "s", subjectFamily: "contact", policyVersion: version, defectType: "contact", vertical: null, marketTier: null, outcome: "purchase" as const })),
    ];
    const events = [...gen("subject.v1", 40, 2), ...gen("subject.v2", 40, 8)]; // v2 clearly better
    const decision = evaluatePromotion(events, { subjectFamily: "contact", baselineVersion: "subject.v1", candidateVersion: "subject.v2" });
    expect(decision.shouldPromote).toBe(true);
    expect(decision.winner?.policyVersion).toBe("subject.v2");
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { defaultSettings } from "../store";
import { BANNED_PHRASES } from "../communication-guide";
import type { BusinessProfile } from "../business-intelligence/types";
import type { Contact, Lead } from "../types";
import { buildOutreachKit } from "./kit";
import { buildSubjectLines, buildOutreachEmail, buildFollowUpEmail } from "./content";
import { inferDecisionMakers } from "./decision-maker";
import { computeNextAction, freshState } from "./next-action";
import type { OutreachKit, OutreachState } from "./types";

const settings = defaultSettings();

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    leadId: "lead_test",
    name: "Jane Taylor",
    title: "Owner",
    email: "jane@taylordental.com",
    phone: "2135550111",
    linkedinUrl: "https://linkedin.com/in/janetaylor",
    source: "Public listing",
    confidence: "Verified",
    verified: true,
    optedOut: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function profileFor(lead: Lead): Promise<BusinessProfile> {
  const bi = await analyzeBusiness({ lead, findings: [], contacts: [] });
  return bi.businessProfile;
}

function containsBanned(text: string): string[] {
  const t = text.toLowerCase();
  return BANNED_PHRASES.filter((p) => t.includes(p.toLowerCase()));
}

describe("outreach v2 — kit", () => {
  let lead: Lead;
  let profile: BusinessProfile;
  let kit: OutreachKit;

  beforeAll(async () => {
    lead = makeLead();
    profile = await profileFor(lead);
    kit = buildOutreachKit({ lead, profile, settings, contacts: [contact()] });
  });

  it("is deterministic — same inputs produce identical kits", () => {
    const a = buildOutreachKit({ lead, profile, settings, contacts: [contact()] });
    const b = buildOutreachKit({ lead, profile, settings, contacts: [contact()] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("email is human, curious, and free of banned/agency language", () => {
    expect(containsBanned(kit.email.body)).toEqual([]);
    expect(kit.email.body).not.toContain("!");
    // founder voice — a real person, not "I'm Jordan with Artifex Labs"
    expect(kit.email.body).toContain("I run Artifex Labs");
    expect(kit.email.body).not.toContain("I'm Jordan with Artifex Labs");
    // curiosity + humility, not selling
    expect(kit.email.body.toLowerCase()).toMatch(/could be wrong|wanted to check/);
    // no statistics dump (natural strength language, not "4.8★ across 921 reviews")
    expect(kit.email.body).not.toMatch(/\d★|\d+\s*reviews/);
    expect(kit.email.wordCount).toBeGreaterThan(50);
  });

  it("the generated email passes the authenticity evaluator", async () => {
    const { scoreAuthenticity } = await import("./authenticity");
    const s = scoreAuthenticity(kit.email);
    expect(s.pass).toBe(true);
  });

  it("two different businesses don't get an identical email (variation, not a template)", () => {
    const dm = inferDecisionMakers(lead, []);
    const a = buildOutreachEmail({ ...lead, id: "lead_aaa", businessName: "Studio Smiles" } as Lead, profile, dm, settings);
    const b = buildOutreachEmail({ ...lead, id: "lead_bbb", businessName: "Bright Dental Co" } as Lead, profile, dm, settings);
    expect(a.body).not.toBe(b.body);
  });

  it("subject lines are conversational, specific, and not clickbait", () => {
    const subs = buildSubjectLines(lead, profile);
    expect(subs.length).toBeGreaterThanOrEqual(3);
    expect(subs.some((s) => s.includes(lead.businessName))).toBe(true);
    for (const s of subs) expect(s).not.toContain("!");
  });

  it("phone guide branches and never leads with tech", () => {
    const audiences = kit.phone.stages.map((s) => s.audience);
    expect(audiences).toEqual(expect.arrayContaining(["receptionist", "decision-maker", "voicemail"]));
    expect(kit.phone.whatThisIsAbout.toLowerCase()).not.toMatch(/website|marketing|automation|software/);
    const dm = kit.phone.stages.find((s) => s.audience === "decision-maker")!;
    expect(dm.avoid).toContain("website");
    // there is a branch for the "what is this regarding" moment
    const recept = kit.phone.stages.find((s) => s.audience === "receptionist")!;
    const hasRegardingBranch = recept.steps.some((st) => st.branches.some((b) => /regarding/i.test(b.when)));
    expect(hasRegardingBranch).toBe(true);
  });

  it("discovery is curiosity, grounded, with intent + basis on every question", () => {
    expect(kit.discovery.opening.toLowerCase()).toContain("isn't a qualification");
    expect(kit.discovery.questions.length).toBeGreaterThanOrEqual(2);
    for (const q of kit.discovery.questions) {
      expect(q.question.length).toBeGreaterThan(10);
      expect(q.intent).toBeTruthy();
      expect(q.basis).toBeTruthy();
    }
  });

  it("recommends a video for a high-value fit, 30–60s, three observations, clean copy", () => {
    expect(kit.videoRecommended).toBe(true);
    expect(kit.video).not.toBeNull();
    expect(kit.video!.observations.length).toBe(3);
    expect(kit.video!.estimatedSeconds).toBeGreaterThanOrEqual(30);
    expect(kit.video!.estimatedSeconds).toBeLessThanOrEqual(60);
    expect(containsBanned(kit.video!.script)).toEqual([]);
  });

  it("produces seven operator-confidence scores, each explained", () => {
    expect(kit.confidence.scores.length).toBe(7);
    for (const s of kit.confidence.scores) {
      expect(s.why).toBeTruthy();
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      if (s.band === "Weak") expect(s.howToImprove).toBeTruthy();
    }
    expect(kit.confidence.overall).toBeGreaterThanOrEqual(0);
    expect(kit.confidence.overall).toBeLessThanOrEqual(100);
  });
});

describe("outreach v2 — decision maker (never fabricates)", () => {
  it("with a verified owner contact, identifies role + reachable channels", () => {
    const lead = makeLead();
    const dm = inferDecisionMakers(lead, [contact()]);
    expect(dm.identified).toBe(true);
    expect(dm.primary?.role).toBe("Owner");
    expect(dm.primary?.name).toBe("Jane Taylor");
    expect(dm.primary?.preferredContactOrder.length).toBeGreaterThan(0);
    expect(dm.confidence).toBeGreaterThan(50);
  });

  it("with no contacts, says so plainly and invents nobody", () => {
    const lead = makeLead();
    const dm = inferDecisionMakers(lead, []);
    expect(dm.identified).toBe(false);
    expect(dm.primary).toBeNull();
    expect(dm.candidates).toEqual([]);
    expect(dm.note.toLowerCase()).toContain("could not be confidently identified");
  });

  it("treats a role inbox as office email, not a personal address", () => {
    const lead = makeLead();
    const dm = inferDecisionMakers(lead, [contact({ email: "info@taylordental.com", confidence: "Likely" })]);
    expect(dm.primary?.directEmail).toBeNull();
    expect(dm.primary?.officeEmail).toBe("info@taylordental.com");
  });
});

describe("outreach v2 — next best action (progressive, one action)", () => {
  const base = (overrides: Partial<OutreachState> = {}): OutreachState => ({
    ...freshState("2026-07-22T12:00:00.000Z", true, true),
    ...overrides,
  });

  it("high-value fresh lead → record the video first", () => {
    expect(computeNextAction(base()).kind).toBe("record-video");
  });
  it("after video, before send → send the intro", () => {
    expect(computeNextAction(base({ hasVideo: true })).kind).toBe("send-intro");
  });
  it("just sent, inside the window → wait, with a status and no pressure", () => {
    const a = computeNextAction(base({ hasVideo: true, introSentAt: "2026-07-21T12:00:00.000Z" }));
    expect(a.kind).toBe("wait");
    expect(a.status).toMatch(/left/);
  });
  it("window passed, no engagement → brief follow-up", () => {
    const a = computeNextAction(base({ hasVideo: true, introSentAt: "2026-07-10T12:00:00.000Z" }));
    expect(a.kind).toBe("send-followup");
  });
  it("followed up, no reply, high confidence → a follow-up conversation, never a cold call", () => {
    const a = computeNextAction(base({ hasVideo: true, introSentAt: "2026-07-05T12:00:00.000Z", followUpSentAt: "2026-07-12T12:00:00.000Z", confidenceHigh: true }));
    expect(a.kind).toBe("call");
    expect(a.title.toLowerCase()).toContain("follow-up");
    expect(a.title.toLowerCase()).not.toContain("cold call");
  });
  it("followed up and they keep looking → invite a conversation", () => {
    const a = computeNextAction(base({ hasVideo: true, introSentAt: "2026-07-05T12:00:00.000Z", followUpSentAt: "2026-07-12T12:00:00.000Z", emailOpened: true }));
    expect(a.kind).toBe("schedule-discovery");
  });
  it("meeting booked → prepare for discovery; suppressed → leave alone", () => {
    expect(computeNextAction(base({ meetingScheduledAt: "2026-07-30T12:00:00.000Z" })).kind).toBe("prepare-discovery");
    expect(computeNextAction(base({ suppressed: true })).kind).toBe("blocked");
  });
  it("always exactly one primary action with a progress reading", () => {
    const a = computeNextAction(base());
    expect(a.title).toBeTruthy();
    expect(a.ctaLabel).toBeTruthy();
    expect(a.progress).toBeGreaterThanOrEqual(0);
    expect(a.progress).toBeLessThanOrEqual(1);
  });
});

describe("outreach v2 — follow-up is human, never a nudge cliché", () => {
  it("acknowledges reality without the banned phrases", async () => {
    const lead = makeLead();
    const bi = await analyzeBusiness({ lead, findings: [], contacts: [] });
    const dm = inferDecisionMakers(lead, []);
    const fu = buildFollowUpEmail(lead, bi.businessProfile, dm, settings);
    const body = fu.body.toLowerCase();
    expect(containsBanned(fu.body)).toEqual([]);
    expect(body).not.toContain("just checking in");
    expect(body).not.toContain("following up");
    expect(body).not.toContain("bumping");
    // References the earlier note like a human, without a nudge cliché.
    expect(body).toMatch(/short note|slipped past|thread/);
    expect(body).not.toContain("!");
  });
});

describe("outreach v2 — sparse lead degrades honestly", () => {
  it("still builds an email and flags weaker confidence for an invisible business", async () => {
    const lead = makeLead({
      businessName: "Corner Barber Co",
      industry: "Barbershop",
      website: null,
      websiteDomain: null,
      publicEmail: null,
      phone: "2135550000",
      rating: null,
      reviewCount: 0,
      estimatedValueHigh: 4000,
    });
    const profile = await profileFor(lead);
    const kit = buildOutreachKit({ lead, profile, settings, contacts: [] });
    expect(kit.email.body).toContain("Hi there,");
    expect(containsBanned(kit.email.body)).toEqual([]);
    // no invented decision maker
    expect(kit.decisionMaker.identified).toBe(false);
    // video not pushed on a low-value, thin lead
    expect(kit.videoRecommended).toBe(false);
    // guides still exist so the operator is never stuck
    expect(kit.phone.stages.length).toBeGreaterThanOrEqual(3);
    expect(kit.discovery.questions.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, it, expect } from "vitest";
import { determineContactStrategy, buildCallBrief, buildCallScript, strategyToWorkKind, isCallablePhone, isValidEmail, isUsableUrl, type StrategyLead } from "./contact-strategy";
import { computeNextAction, freshState } from "./next-action";
import { workKindForTask } from "../work-queue";
import type { Lead, Task } from "../types";

const base: StrategyLead = {
  businessName: "Test Co",
  publicEmail: null,
  phone: null,
  website: null,
  contactFormUrl: null,
  socialLinks: [],
  businessStatus: "OPERATIONAL",
  rating: 4.8,
  reviewCount: 120,
};

describe("determineContactStrategy — archetypes", () => {
  it("email-first when a public email exists (law firm / website business)", () => {
    const s = determineContactStrategy({ ...base, website: "https://firm.com", publicEmail: "hi@firm.com" });
    expect(s.kind).toBe("email-first");
    expect(s.primaryLabel).toBe("Email");
  });

  it("email-first when only a decision-maker email is known", () => {
    const s = determineContactStrategy({ ...base, phone: "(213) 555-0100" }, { decisionMakerEmail: "owner@x.com" });
    expect(s.kind).toBe("email-first");
  });

  it("call-first: no email but a live phone (The Secret House of Ivy)", () => {
    const s = determineContactStrategy({
      ...base,
      phone: "(562) 966-0379",
      contactFormUrl: "https://forms.gle/abc",
      socialLinks: ["https://instagram.com/secrethouseofivy"],
    });
    expect(s.kind).toBe("call-first");
    expect(s.reason).toMatch(/no verified public email/i);
    expect(s.reason).toMatch(/Instagram/);
    expect(s.sequence[0]).toMatch(/call/i);
    // signals recommend an action, not just report a gap
    expect(s.signals.find((x) => x.label === "Recommended first contact")?.value).toBe("Phone Call");
    expect(s.signals.find((x) => x.label === "Website")?.value).toBe("None detected");
  });

  it("contact-form-first: no email, no phone, but a form", () => {
    const s = determineContactStrategy({ ...base, contactFormUrl: "https://x.com/contact" });
    expect(s.kind).toBe("contact-form-first");
  });

  it("instagram-dm-first: only Instagram", () => {
    const s = determineContactStrategy({ ...base, socialLinks: ["https://instagram.com/x"] });
    expect(s.kind).toBe("instagram-dm-first");
  });

  it("phone outranks form and Instagram for the first touch", () => {
    const s = determineContactStrategy({
      ...base,
      phone: "(213) 555-0100",
      contactFormUrl: "https://x.com/contact",
      socialLinks: ["https://instagram.com/x"],
    });
    expect(s.kind).toBe("call-first");
  });

  it("always names exactly one recommended first contact", () => {
    for (const lead of [
      { ...base, publicEmail: "a@b.com" },
      { ...base, phone: "(213) 555-0100" },
      { ...base, contactFormUrl: "https://example.com/contact" },
      { ...base, socialLinks: ["https://instagram.com/x"] },
    ]) {
      const s = determineContactStrategy(lead);
      const rec = s.signals.filter((x) => x.label === "Recommended first contact");
      expect(rec).toHaveLength(1);
    }
  });
});

describe("no-channel — never recommend an action that can't be performed", () => {
  it("no phone, no email, no website, no form, no social → no-channel (NOT call-first)", () => {
    const s = determineContactStrategy({ ...base, phone: null, publicEmail: null, website: null, contactFormUrl: null, socialLinks: [] });
    expect(s.kind).toBe("no-channel");
    expect(s.primaryLabel).toBe("Find Contact Route");
    expect(s.reason).toMatch(/no verified/i);
  });

  it("a malformed phone number does NOT make a lead call-first", () => {
    // "555" is 3 digits — not a dialable number. It must not enable a call.
    const s = determineContactStrategy({ ...base, phone: "555", publicEmail: null, website: null, contactFormUrl: null, socialLinks: [] });
    expect(s.kind).toBe("no-channel");
  });

  it("a valid phone IS call-first", () => {
    expect(determineContactStrategy({ ...base, phone: "(213) 329-7576", publicEmail: null }).kind).toBe("call-first");
  });

  it("an empty-string email / malformed URL are not channels", () => {
    const s = determineContactStrategy({ ...base, phone: null, publicEmail: "  ", website: "notaurl", contactFormUrl: "also-bad", socialLinks: ["nope"] });
    expect(s.kind).toBe("no-channel");
  });

  it("no-channel routes to the research bucket, not an outreach batch", () => {
    expect(strategyToWorkKind("no-channel")).toBe("understand");
  });
});

describe("channel eligibility validators", () => {
  it("isCallablePhone accepts 10–15 digits, rejects short/empty/garbage", () => {
    expect(isCallablePhone("(213) 329-7576")).toBe(true);
    expect(isCallablePhone("+1 213 329 7576")).toBe(true);
    expect(isCallablePhone("555")).toBe(false);
    expect(isCallablePhone("")).toBe(false);
    expect(isCallablePhone(null)).toBe(false);
    expect(isCallablePhone("call us!")).toBe(false);
  });
  it("isValidEmail / isUsableUrl reject malformed values", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isUsableUrl("https://x.com")).toBe(true);
    expect(isUsableUrl("ftp://x")).toBe(false);
    expect(isUsableUrl("x.com")).toBe(false);
    expect(isUsableUrl("")).toBe(false);
  });
});

describe("buildCallBrief — a conversation starter, not a script", () => {
  it("uses Instagram + no-website framing when that's the reality", () => {
    const b = buildCallBrief({
      ...base,
      businessName: "The Secret House of Ivy",
      phone: "(213) 555-0100",
      contactFormUrl: "https://forms.gle/abc",
      socialLinks: ["https://instagram.com/secrethouseofivy"],
    });
    expect(b.opening).toMatch(/Instagram/);
    expect(b.opening).toMatch(/Secret House of Ivy/);
    expect(b.observation).toMatch(/website/i);
    expect(b.permissionQuestion).toMatch(/\?$/);
    expect(b.transition).toMatch(/wrong from the outside/i);
  });

  it("prefers a real strongest observation when provided", () => {
    const b = buildCallBrief({ ...base, businessName: "X", phone: "(213) 555-0100" }, { strongestObservation: "Your humidor selection is unusually deep." });
    expect(b.observation).toBe("Your humidor selection is unusually deep.");
  });
});

describe("buildCallScript — the full readable call guide", () => {
  const ivy: StrategyLead = {
    ...base,
    businessName: "The Secret House of Ivy",
    publicEmail: null,
    website: null,
    phone: "(562) 966-0379",
    socialLinks: ["https://instagram.com/secrethouseofivy"],
  };

  it("answers who/why/what-to-say: objective, opening, purpose, questions, branches", () => {
    const s = buildCallScript(ivy);
    expect(s.objective.length).toBeGreaterThan(0);
    expect(s.opening).toContain("The Secret House of Ivy");
    expect(s.opening).toMatch(/best person/i); // opens by asking for the decision-maker
    expect(s.purpose).toMatch(/decision-maker|owner/i);
    expect(s.questions.length).toBeGreaterThanOrEqual(3);
    expect(s.questions.some((q) => /email/i.test(q))).toBe(true);
    expect(s.questions.some((q) => /review/i.test(q))).toBe(true);
  });

  it("covers the common turns of a real call, each as a spoken line", () => {
    const s = buildCallScript(ivy);
    const situations = s.branches.map((b) => b.situation.toLowerCase());
    expect(situations.some((x) => x.includes("decision-maker answers"))).toBe(true);
    expect(situations.some((x) => x.includes("receptionist") || x.includes("employee"))).toBe(true);
    expect(situations.some((x) => x.includes("unavailable"))).toBe(true);
    expect(situations.some((x) => x.includes("not interested"))).toBe(true);
    expect(situations.some((x) => x.includes("voicemail"))).toBe(true);
    // every branch carries an actual line to say
    expect(s.branches.every((b) => b.line.trim().length > 0)).toBe(true);
    // the voicemail line names the business so it's usable as-is
    expect(s.branches.find((b) => /voicemail/i.test(b.situation))?.line).toContain("The Secret House of Ivy");
  });

  it("tailors the opening to Instagram when that's the live channel", () => {
    const s = buildCallScript(ivy);
    expect(s.opening).toMatch(/Instagram/);
  });
});

describe("computeNextAction — contact strategy routing", () => {
  const now = "2026-07-25T00:00:00.000Z";
  it("routes a no-email, live-phone lead to a call, not a dead-end email", () => {
    const a = computeNextAction({ ...freshState(now, false, true), hasEmailRoute: false, hasPhone: true });
    expect(a.kind).toBe("call");
    expect(a.ctaLabel).toMatch(/call brief/i);
  });
  it("keeps the normal email flow when an email route exists", () => {
    const a = computeNextAction({ ...freshState(now, false, true), hasEmailRoute: true, hasPhone: true });
    expect(a.kind).toBe("send-intro");
  });
  it("does not force a call when there is no phone either", () => {
    const a = computeNextAction({ ...freshState(now, false, true), hasEmailRoute: false, hasPhone: false });
    expect(a.kind).not.toBe("call");
  });
});

describe("workKindForTask — the queue follows contact strategy", () => {
  const lead = (over: Partial<StrategyLead>): Lead => ({ ...base, ...over } as unknown as Lead);
  const task = (type: Task["type"]): Task => ({ type, leadId: "x" } as unknown as Task);

  it("initial outreach on an email lead → email batch (backward compatible)", () => {
    expect(workKindForTask(task("review_and_send"), lead({ publicEmail: "a@b.com" }))).toBe("email");
  });
  it("initial outreach on a no-email + phone lead → call batch (not email)", () => {
    expect(workKindForTask(task("review_and_send"), lead({ publicEmail: null, phone: "(213) 555-0100" }))).toBe("call");
  });
  it("initial outreach on a form-only lead → contact-form batch", () => {
    expect(workKindForTask(task("review_and_send"), lead({ publicEmail: null, phone: null, contactFormUrl: "https://example.com/contact" }))).toBe("contact-form");
  });
  it("initial outreach on an Instagram-only lead → instagram-dm batch", () => {
    expect(workKindForTask(task("review_and_send"), lead({ publicEmail: null, phone: null, socialLinks: ["https://instagram.com/x"] }))).toBe("instagram-dm");
  });
  it("non-outreach task types keep their fixed kind", () => {
    expect(workKindForTask(task("prepare_video"), lead({ publicEmail: null, phone: "(213) 555-0100" }))).toBe("video");
    expect(workKindForTask(task("follow_up"), lead({ publicEmail: "a@b.com" }))).toBe("follow-up");
  });
});

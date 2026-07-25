import { describe, it, expect } from "vitest";
import { determineContactStrategy, buildCallBrief, type StrategyLead } from "./contact-strategy";
import { computeNextAction, freshState } from "./next-action";

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
    const s = determineContactStrategy({ ...base, phone: "555" }, { decisionMakerEmail: "owner@x.com" });
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
      phone: "555",
      contactFormUrl: "https://x.com/contact",
      socialLinks: ["https://instagram.com/x"],
    });
    expect(s.kind).toBe("call-first");
  });

  it("always names exactly one recommended first contact", () => {
    for (const lead of [
      { ...base, publicEmail: "a@b.com" },
      { ...base, phone: "555" },
      { ...base, contactFormUrl: "https://x/c" },
      { ...base, socialLinks: ["https://instagram.com/x"] },
    ]) {
      const s = determineContactStrategy(lead);
      const rec = s.signals.filter((x) => x.label === "Recommended first contact");
      expect(rec).toHaveLength(1);
    }
  });
});

describe("buildCallBrief — a conversation starter, not a script", () => {
  it("uses Instagram + no-website framing when that's the reality", () => {
    const b = buildCallBrief({
      ...base,
      businessName: "The Secret House of Ivy",
      phone: "555",
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
    const b = buildCallBrief({ ...base, businessName: "X", phone: "5" }, { strongestObservation: "Your humidor selection is unusually deep." });
    expect(b.observation).toBe("Your humidor selection is unusually deep.");
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

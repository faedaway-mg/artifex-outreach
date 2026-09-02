import { describe, it, expect } from "vitest";
import { composeClientNarration, assessScriptQuality, shortName, PROHIBITED_RX, type ComposedNarration } from "./client-narration";
import { compareClientScripts } from "./script-distinctness";
import type { ObservedFinding } from "./site-evidence";

const base = { category: "Customer Acquisition" as const, whyItMatters: "why", basis: ["url", "detail"], reproduction: ["a", "b"], sourcePageUrl: "https://x.example/", sourcePageTitle: "Homepage" };

const MOBILE: ObservedFinding = {
  ...base, key: "no-viewport-meta", topic: "mobile", impactLevel: "High",
  observation: "The homepage ships no mobile viewport tag, so phones render it at desktop width.",
  recommendation: "rebuild the homepage as a responsive layout that reflows to the phone screen instead of shrinking the desktop page to fit",
  details: { kind: "no-viewport", viewportWidth: 540 },
};
const BOOKING: ObservedFinding = {
  ...base, key: "no-online-booking", topic: "booking", impactLevel: "High", category: "Scheduling" as any,
  observation: "No online booking or appointment scheduler is present on any of the 4 pages inspected.",
  recommendation: "add a lightweight booking flow so a customer can choose a service, pick a time, and get a confirmation without calling",
  details: { inspected: 4, serviceWord: "massage" },
};
const CONTACT: ObservedFinding = {
  ...base, key: "no-contact-form", topic: "contact", impactLevel: "High", category: "Communication" as any,
  observation: "Across the 5 pages inspected — including the contact page — there is no contact or intake form.",
  recommendation: "add a short intake form — name, the matter, and how to reach them — that routes straight to the business inbox on submit",
  details: { inspected: 5, reach: "a phone number", hasMail: false },
};

describe("value-dense narration composer", () => {
  it("composes six distinct beats in the ~70–110 word band, and passes the quality gate", () => {
    for (const [f, name] of [[MOBILE, "Morris Automotive Machine"], [BOOKING, "a2z Health Massage Schools"], [CONTACT, "Robert Hall & Associates"]] as const) {
      const c = composeClientNarration(f, name);
      expect(c.lines.map((l) => l.role)).toEqual(["hook", "friction", "consequence", "solution", "value", "close"]);
      expect(c.wordCount).toBeGreaterThanOrEqual(70);
      expect(c.wordCount).toBeLessThanOrEqual(110);
      const q = assessScriptQuality(c);
      expect(q.ok, `${name}: ${q.reasons.join("; ")}`).toBe(true);
    }
  });

  it("anchors each script to an EXACT observed detail (survives no name-only reading)", () => {
    const m = composeClientNarration(MOBILE, "Morris Automotive Machine");
    expect(m.lines.find((l) => l.role === "friction")!.text.toLowerCase()).toContain("no mobile layout");
    const b = composeClientNarration(BOOKING, "a2z Health Massage Schools");
    expect(b.lines.find((l) => l.role === "hook")!.text.toLowerCase()).toContain("book a massage");
    expect(b.lines.find((l) => l.role === "friction")!.text.toLowerCase()).toContain("no scheduler");
    expect(b.lines.find((l) => l.role === "friction")!.text).toContain("4 pages");
    const c = composeClientNarration(CONTACT, "Robert Hall & Associates");
    expect(c.lines.find((l) => l.role === "friction")!.text.toLowerCase()).toContain("no form");
    expect(c.lines.find((l) => l.role === "friction")!.text).toContain("a phone number");
  });

  it("never emits a prohibited generic line", () => {
    for (const f of [MOBILE, BOOKING, CONTACT]) {
      const all = composeClientNarration(f, "Test Co").lines.map((l) => l.text).join(" ");
      for (const rx of PROHIBITED_RX) expect(rx.test(all), `matched ${rx}`).toBe(false);
    }
  });

  it("quality gate REJECTS a shallow, name-swappable script", () => {
    const shallow: ComposedNarration = {
      topic: "reviews", key: "reviews", wordCount: 40, anchors: [],
      lines: [
        { role: "hook", text: "Your reputation is stronger than your website currently shows." },
        { role: "friction", text: "Point visitors to one clear next step." },
        { role: "consequence", text: "Put your reviews to work." },
        { role: "solution", text: "Choose one primary action per page." },
        { role: "value", text: "It helps." },
        { role: "close", text: "Happy to walk you through it — no obligation." },
      ],
    };
    const q = assessScriptQuality(shallow);
    expect(q.ok).toBe(false);
    expect(q.reasons.some((r) => /prohibited/.test(r))).toBe(true);
    expect(q.reasons.some((r) => /exact observed detail/.test(r))).toBe(true);
  });

  it("quality gate REJECTS an unsupported-metric / guaranteed-outcome script", () => {
    const c = composeClientNarration(MOBILE, "Morris");
    const withMetric: ComposedNarration = { ...c, lines: c.lines.map((l) => l.role === "value" ? { ...l, text: "This will increase your bookings by 30% and double revenue." } : l) };
    const q = assessScriptQuality(withMetric);
    expect(q.ok).toBe(false);
    expect(q.reasons.some((r) => /unsupported metric/.test(r))).toBe(true);
  });

  it("BreakBot: the three composed scripts are materially distinct (not template-equivalent)", () => {
    const scripts = [
      { id: "morris", businessName: "Morris Automotive Machine", narration: composeClientNarration(MOBILE, "Morris Automotive Machine").lines.map((l) => l.text), findingTopics: ["mobile"] },
      { id: "a2z", businessName: "a2z Health Massage Schools", narration: composeClientNarration(BOOKING, "a2z Health Massage Schools").lines.map((l) => l.text), findingTopics: ["booking"] },
      { id: "rhall", businessName: "Robert Hall & Associates", narration: composeClientNarration(CONTACT, "Robert Hall & Associates").lines.map((l) => l.text), findingTopics: ["contact"] },
    ];
    const bb = compareClientScripts(scripts);
    expect(bb.ok).toBe(true);
    expect(bb.templateEquivalent).toBe(false);
    for (const p of bb.pairs) expect(p.similarity).toBeLessThan(0.5);
  });

  it("shortName drops legal suffixes and '& Associates' tails", () => {
    expect(shortName("Robert Hall & Associates")).toBe("Robert Hall");
    expect(shortName("Morris Automotive Machine, LLC")).toBe("Morris Automotive Machine");
    expect(shortName("a2z Health Massage Schools")).toBe("a2z Health Massage");
  });
});

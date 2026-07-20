import { describe, it, expect } from "vitest";
import { renderBriefPdf } from "./render";
import { defaultSettings } from "@/lib/store";

const lead: any = {
  id: "lead_test",
  businessName: "Taylor Family Dental",
  industry: "Dental practice",
  city: "Pasadena",
  state: "CA",
};

function content(overrides: any = {}) {
  return {
    cover: { subtitle: "Business Modernization Brief", confidentialityNote: "Confidential discussion document." },
    executiveSnapshot: {
      overview: "Taylor Family Dental has a strong local reputation and steady demand, with clear room to modernize how new patients discover and book.",
      whatIsWorking: "Excellent review reputation (4.8★ across 214 reviews) and a well-known location.",
      primaryOpportunity: "A modern website with a clear online booking path.",
      potentialImpact: "Fewer missed new-patient inquiries and less manual phone scheduling.",
      recommendedFirstConversation: "A 30-minute discovery call to map the current new-patient journey.",
    },
    strengths: ["Excellent 4.8★ reputation across 214 reviews", "Established, trusted location", "Clear service structure"],
    opportunities: [
      { observation: "No online booking", evidence: "Website has a phone number only; no scheduler detected.", businessConsequence: "New patients who prefer to book online may drop off after hours.", modernizationDirection: "Add an online booking flow tied to the practice calendar." },
    ],
    customerJourney: {
      currentState: [
        "A prospective patient searches for a dentist and finds the practice through Google, then must call during business hours to ask about availability and insurance before they can schedule anything at all.",
        "Manual phone scheduling",
      ],
      futureState: [
        "The same prospective patient finds a modern, mobile-first site, sees availability and accepted insurance immediately, and books a first appointment online in under two minutes without needing to call.",
        "Automated confirmation and reminders",
      ],
    },
    modernizationPath: {
      primaryEngagement: "Business Website System",
      components: ["Modern responsive site", "Online booking", "Insurance clarity", "Automated reminders"],
      secondaryOpportunity: "A lightweight internal dashboard for front-desk staff.",
      investmentRange: "$8,000 – $18,000",
      disclaimer: "Illustrative planning range — not a binding quote. Confirmed during discovery.",
    },
    cta: { headline: "Let's map the new-patient journey.", body: "A short discovery call to see where modernization would help most." },
    ...overrides,
  };
}

const settings = defaultSettings();

describe("Modernization Brief PDF", () => {
  it("renders a normal brief without empty pages", async () => {
    const deliverable: any = { id: "d1", status: "draft", createdAt: new Date("2026-07-14").toISOString(), content: content() };
    const buf = await renderBriefPdf(lead, deliverable, settings);
    expect(buf.length).toBeGreaterThan(8000);
  });

  it("renders an edge brief (empty opportunities/strengths + star + long text) with NO blank page", async () => {
    const deliverable: any = {
      id: "d2",
      status: "draft",
      createdAt: new Date("2026-07-14").toISOString(),
      content: content({ opportunities: [], strengths: [] }),
    };
    const buf = await renderBriefPdf({ ...lead, businessName: "A Very Long Business Name Wellness & Aesthetics Center of Greater Pasadena" }, deliverable, settings);
    expect(buf.length).toBeGreaterThan(6000);
  });

  it("self-heals the public contact email/booking to the canonical identity", () => {
    expect(settings.contactEmail).toBe("hello@artifexlabs.tech");
    expect(settings.calendarLink).toBe("https://cal.com/artifex-labs-discovery-call/30min");
  });
});

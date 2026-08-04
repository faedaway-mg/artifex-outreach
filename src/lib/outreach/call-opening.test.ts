import { describe, it, expect } from "vitest";
import {
  understandJourney,
  readFinding,
  deliverableFor,
  whoAnswers,
  sizeOf,
  understandLead,
  buildCallOpening,
  findForbiddenPhrases,
  spokenLines,
  FORBIDDEN_OPENING_PHRASES,
  type OpeningInput,
} from "./call-opening";

const base = (over: Partial<OpeningInput> = {}): OpeningInput => ({
  businessName: "Villa Brasil Motel",
  industry: "Motel",
  city: "Los Angeles",
  hasWebsite: true,
  rating: 4.2,
  reviewCount: 60,
  observations: ["Customer Journey (highest leverage)"],
  ...over,
});

/** A deliberately diverse corpus — the engine has to hold up across all of it. */
const CORPUS: OpeningInput[] = [
  base(),
  { businessName: "Bright Smile Dental", industry: "Dental practices", city: "Pasadena", hasWebsite: true, rating: 4.9, reviewCount: 380, observations: ["Scheduling (highest leverage)"] },
  { businessName: "Kepler & Rowe", industry: "Law firms", city: "Santa Monica", hasWebsite: true, rating: 4.6, reviewCount: 55, observations: ["Search visibility is limited"] },
  { businessName: "Summit Roofing", industry: "Roofing companies", city: "Glendale", hasWebsite: true, rating: 4.8, reviewCount: 12, observations: ["Conversion journey — the site is hard to use on mobile"] },
  { businessName: "La Cocina", industry: "Restaurant", city: "Highland Park", hasWebsite: false, rating: 4.7, reviewCount: 900, observations: [] },
  { businessName: "Iron Oak Fitness", industry: "Fitness studios", city: "Culver City", hasWebsite: true, rating: 4.4, reviewCount: 210, observations: ["Customer Communication — no follow-up after an inquiry"] },
  { businessName: "Meridian Wealth", industry: "Financial advisory firms", city: "Century City", hasWebsite: true, rating: 5, reviewCount: 8, observations: ["Internal Workflow — manual handoffs"] },
  { businessName: "Cutler Barbers", industry: "Barbershops", city: "Echo Park", hasWebsite: true, rating: 4.9, reviewCount: 140, observations: ["Booking is only available by phone"] },
  { businessName: "Vista Auto Body", industry: "Collision centers", city: "Van Nuys", hasWebsite: true, rating: 4.1, reviewCount: 75, observations: ["Reputation and reviews are inconsistent"] },
  { businessName: "Harbor Event House", industry: "Event venues", city: "San Pedro", hasWebsite: true, rating: 4.8, reviewCount: 96, observations: ["Intake — no way to check a date"] },
  { businessName: "Nine Lantern Jewelers", industry: "Jewelry stores", city: "Beverly Hills", hasWebsite: true, rating: 4.9, reviewCount: 320, observations: ["Trust signals are dated"] },
  { businessName: "Rio Pool Care", industry: "Pool service companies", city: "Encino", hasWebsite: true, rating: 4.5, reviewCount: 20, observations: ["Page speed is slow"] },
];

describe("understandJourney — reasoning about the business before any words", () => {
  it("1. resolves a taxonomy category directly", () => {
    const j = understandJourney({ industry: "Dental practices" });
    expect(j.source).toBe("category");
    expect(j.actor).toBe("a new patient");
    expect(j.audience).toBe("patients");
  });

  it("2. reads the industry words when the taxonomy has no entry", () => {
    // "Motel" is not in the portfolio. Everyone still knows what a motel does.
    const j = understandJourney({ industry: "Motel" });
    expect(j.source).toBe("industry-words");
    expect(j.actor).toBe("someone trying to book a room");
    expect(j.goal).toBe("book a room");
  });

  it("3. falls back to the portfolio group, then to a generic-but-honest journey", () => {
    const grouped = understandJourney({ industry: "Something Unheard Of", categoryGroup: "Home and Property Services" });
    expect(grouped.source).toBe("group");
    expect(grouped.actor).toContain("homeowner");

    const generic = understandJourney({ industry: "", categoryGroup: "" });
    expect(generic.source).toBe("generic");
    expect(generic.lens).toContain("try to reach you");
    // With no industry at all, the search we name stays honestly generic.
    expect(generic.searchTerm).toBe("a business like yours");
  });

  it("3b. the search we name comes from the industry, never \"a business like yours\"", () => {
    // Collision centers carry no searchTerm of their own — the industry word is
    // still truer than the generic, and the generic is what sounds like a mail merge.
    expect(understandJourney({ industry: "Auto Body Shop" }).searchTerm).toBe("an auto body shop");
    expect(understandJourney({ industry: "Roofing Contractor" }).searchTerm).not.toContain("business like yours");
  });

  it("3c. a vet is a vet — not \"someone deciding which firm to call\"", () => {
    const vet = understandJourney({ industry: "Veterinarian" });
    expect(vet.actor).toMatch(/dog or cat/i);
    expect(vet.actor).not.toMatch(/firm/i);
    expect(vet.searchTerm).toBe("a vet");
    // Physical therapy is reached from the industry word, not just the category.
    expect(understandJourney({ industry: "Physical Therapist" }).actor).toMatch(/referral/i);
  });

  it("4. a hotel and a law firm never share a lens", () => {
    const hotel = understandJourney({ industry: "Motel" });
    const firm = understandJourney({ industry: "Law firms" });
    expect(hotel.lens).not.toBe(firm.lens);
    expect(hotel.goal).not.toBe(firm.goal);
  });
});

describe("readFinding — the analysis, translated out of analyst language", () => {
  it("5. classifies a scheduling finding into the booking moment", () => {
    const j = understandJourney({ industry: "Dental practices" });
    const f = readFinding({ observations: ["Scheduling (highest leverage)"], hasWebsite: true }, j);
    expect(f.moment).toBe("booking");
    expect(f.grounded).toBe(true);
  });

  it("6. NEVER speaks the analysis back — the raw string stays private evidence", () => {
    // "Customer Journey (highest leverage)" is how the engine talks. Reading that
    // out loud is the exact thing that makes a call sound machine-written.
    const o = buildCallOpening(base({ observations: ["Customer Journey (highest leverage)"] }));
    for (const line of spokenLines(o)) {
      expect(line).not.toMatch(/highest leverage/i);
      expect(line).not.toMatch(/customer journey/i);
    }
    expect(o.evidence).toBe("Customer Journey (highest leverage)");
  });

  it("7. the same finding sounds different for a motel and a dentist", () => {
    const motel = readFinding({ observations: ["Scheduling"], hasWebsite: true }, understandJourney({ industry: "Motel" }));
    const dental = readFinding({ observations: ["Scheduling"], hasWebsite: true }, understandJourney({ industry: "Dental practices" }));
    expect(motel.moment).toBe(dental.moment);
    expect(motel.noticed).not.toBe(dental.noticed);
    // Each is named by its own conversion — a booking finished, an appointment
    // booked — never by a shared generic ("partway through").
    expect(motel.noticed).toContain("finishing a booking");
    expect(dental.noticed).toContain("booking an appointment");
  });

  it("8. no website outranks whatever the analysis ranked first", () => {
    const j = understandJourney({ industry: "Restaurant" });
    const f = readFinding({ observations: ["Scheduling (highest leverage)"], hasWebsite: false }, j);
    expect(f.moment).toBe("no-website");
    expect(f.noticed).toContain("Google listing");
    expect(f.grounded).toBe(true);
  });

  it("9. a finding a customer would never see claims NOTHING", () => {
    // Internal workflow is real, but "I noticed some things about your internal
    // workflow" is the vague opener that gets the call ended.
    const j = understandJourney({ industry: "Financial advisory firms" });
    const f = readFinding({ observations: ["Internal Workflow — manual handoffs between staff"], hasWebsite: true }, j);
    expect(f.moment).toBe("unknown");
    expect(f.grounded).toBe(false);
    expect(f.noticed).toBe("");
  });

  it("10. no analysis at all is honest, not invented", () => {
    const o = buildCallOpening(base({ observations: [] }));
    expect(o.grounded).toBe(false);
    expect(o.say).not.toMatch(/stood out/i);
    // It names the limit of what we actually saw instead of inventing a finding.
    expect(o.say).toMatch(/may be off|you'd know better|what I could see from the outside/i);
  });

  it("11. where you're findable is said with the city, because that's the search", () => {
    const o = buildCallOpening(base({ industry: "Law firms", city: "Santa Monica", observations: ["Search visibility"] }));
    expect(o.noticed).toContain("Santa Monica");
    expect(o.noticed).toContain("a lawyer");
  });

  it("12. a mobile finding is said as a phone, and the deliverable is screenshots", () => {
    const o = buildCallOpening(base({ industry: "Roofing companies", observations: ["mobile usability is poor"] }));
    expect(o.noticed).toContain("on a phone");
    expect(o.deliverable).toContain("screenshots");
  });
});

describe("the deliverable sounds like an object somebody made", () => {
  it("13. every moment names something tangible — never 'a review'", () => {
    const j = understandJourney({ industry: "Motel" });
    const moments = ["booking", "getting-in-touch", "being-found", "first-impression", "on-a-phone", "waiting-for-a-reply", "what-people-say", "no-website", "unknown"] as const;
    for (const m of moments) {
      const d = deliverableFor(m, j);
      expect(d).toMatch(/walkthrough|breakdown|side-by-side|screenshots/);
      expect(d).not.toMatch(/\breview\b/i);
    }
  });
});

describe("who is actually holding the phone", () => {
  it("14. a ten-review roofer is the owner; a hotel is a busy front desk", () => {
    expect(sizeOf({ reviewCount: 12 })).toBe("solo");
    expect(whoAnswers(understandJourney({ industry: "Roofing companies" }), "solo", "Home and Property Services")).toBe("owner-likely");
    expect(whoAnswers(understandJourney({ industry: "Motel" }), "small", "Hospitality and Experiences")).toBe("mid-shift");
    expect(whoAnswers(understandJourney({ industry: "Dental practices" }), "established", "Health and Wellness")).toBe("front-desk");
    expect(whoAnswers(understandJourney({ industry: "Law firms" }), "small", "Professional Services")).toBe("reception");
  });

  it("15. the busiest answerer gets the shortest opening", () => {
    const busy = buildCallOpening(base({ industry: "Restaurant", hasWebsite: true, observations: ["Conversion journey"] }));
    const calm = buildCallOpening(base({ businessName: "Kepler & Rowe", industry: "Law firms", observations: ["Conversion journey"] }));
    expect(busy.say.length).toBeLessThan(calm.say.length);
    expect(busy.say).toMatch(/thirty seconds/i);
  });

  it("16. multi-location is never treated as a solo owner", () => {
    expect(sizeOf({ reviewCount: 4, locationsCount: 6 })).toBe("multi-location");
  });
});

describe("THE RECEPTIONIST TEST — five questions, answered", () => {
  it("17. every opening says what was made, why it's relevant, and asks for the email", () => {
    for (const input of CORPUS) {
      const o = buildCallOpening(input);
      // What exactly did you make?
      expect(o.say).toContain(o.deliverable);
      // Why is it relevant? (the journey we looked at)
      expect(o.say.toLowerCase()).toContain(o.lookedAt.slice(0, 24).toLowerCase());
      // Why should I give you an email?
      expect(o.say).toMatch(/email|address/i);
      // Why are you calling? — stated as not a sale, in the first sentence.
      expect(o.say.split(".")[0] + o.say.split(".")[1]).toMatch(/not selling|not a sales/i);
    }
  });

  it("18. the opening is short enough to survive a busy phone — under 65 words", () => {
    for (const input of CORPUS) {
      const words = buildCallOpening(input).say.split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(65);
    }
  });

  it("18b. someone mid-shift gets a third of a minute, not a minute", () => {
    // A front desk with a guest standing there will not hear a fourth sentence.
    const busy = buildCallOpening(base({ industry: "Motel", observations: ["Scheduling"] }));
    expect(busy.say.split(/\s+/).length).toBeLessThanOrEqual(48);
  });
});

describe("the language guardrail", () => {
  it("19. no spoken line in the whole corpus contains a forbidden phrase", () => {
    const offenders: string[] = [];
    for (const input of CORPUS) {
      for (const line of spokenLines(buildCallOpening(input))) {
        const bad = findForbiddenPhrases(line);
        if (bad.length) offenders.push(`${input.businessName}: ${bad.join(", ")} — ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("20. 'review' is banned outright — to whoever answers it means Google or Yelp", () => {
    expect(FORBIDDEN_OPENING_PHRASES).toContain("a review");
    expect(FORBIDDEN_OPENING_PHRASES).toContain("the review");
    for (const input of CORPUS) {
      for (const line of spokenLines(buildCallOpening(input))) {
        expect(line).not.toMatch(/\breviews?\b/i);
      }
    }
  });

  it("21. the guard actually catches the sentence we removed", () => {
    const old = "I put together a short review for Villa Brasil Motel with a few observations that might be useful.";
    expect(findForbiddenPhrases(old).length).toBeGreaterThanOrEqual(3);
  });

  it("22. no template seams — no doubled spaces or orphaned punctuation", () => {
    for (const input of CORPUS) {
      for (const line of spokenLines(buildCallOpening(input))) {
        expect(line).not.toMatch(/ {2}/);
        expect(line).not.toMatch(/\s[.,?]/);
        expect(line).not.toMatch(/\.\s*\./);
      }
    }
  });
});

describe("THE QUALITY BAR — two businesses never get the same call", () => {
  it("23. every opening in a diverse corpus is distinct, name removed", () => {
    const stripped = CORPUS.map((i) => buildCallOpening(i).say.split(i.businessName).join("«name»"));
    expect(new Set(stripped).size).toBe(CORPUS.length);
  });

  it("24. so is every other line of the call — not just the first sentence", () => {
    for (const key of ["reception", "decisionMaker", "transferred", "whatIsThis", "voicemail"] as const) {
      const lines = CORPUS.map((i) => buildCallOpening(i).lines[key].split(i.businessName).join("«name»"));
      expect(new Set(lines).size).toBe(CORPUS.length);
    }
  });

  it("25. the difference is substance, not decoration — journeys differ too", () => {
    const lenses = new Set(CORPUS.map((i) => buildCallOpening(i).lookedAt));
    expect(lenses.size).toBeGreaterThanOrEqual(CORPUS.length - 1);
  });

  it("26. praise is only spoken when it's earned", () => {
    const earned = understandLead(base({ rating: 4.9, reviewCount: 300 }));
    const unearned = understandLead(base({ rating: 3.9, reviewCount: 300 }));
    expect(earned.wellReviewed).toBe(true);
    expect(unearned.wellReviewed).toBe(false);
    expect(buildCallOpening(base({ rating: 3.9, reviewCount: 300 })).lines.decisionMaker).not.toMatch(/clearly rate you/);
  });

  it("27. the engine can say why it chose these words", () => {
    const o = buildCallOpening(base());
    expect(o.because.length).toBeGreaterThanOrEqual(3);
    expect(o.because.join(" ")).toMatch(/someone trying to book a room/);
  });
});

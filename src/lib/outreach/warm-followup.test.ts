import { describe, it, expect } from "vitest";
import { openingForLead, spokenLines, findForbiddenPhrases } from "./call-opening";

const lead = { businessName: "Taylor Family Dental", industry: "Dental practice", normalizedCategory: "dentist", city: "Pasadena", website: "https://taylordental.com", rating: 4.8, reviewCount: 120 };

describe("warm follow-up opening — a post-email call is not a cold open", () => {
  it("with emailedReview, the opening carries warm follow-up beats (opener + two forks + voicemail)", () => {
    const o = openingForLead(lead, { observations: ["Booking takes 5 taps"], emailedReview: true });
    expect(o.followUp).toBeTruthy();
    expect(o.followUp!.opener).toMatch(/emailed|sent/i);
    expect(o.followUp!.opener).toMatch(/right person/i); // references what we already sent
    expect(o.followUp!.ifSeen).toBeTruthy();
    expect(o.followUp!.ifNotSeen).toMatch(/resend|address/i);
    expect(o.followUp!.voicemail).toBeTruthy();
  });

  it("without emailedReview, there are NO follow-up beats — it stays the cold opening", () => {
    const o = openingForLead(lead, { observations: ["Booking takes 5 taps"] });
    expect(o.followUp).toBeUndefined();
  });

  it("the warm beats never use a forbidden phrase (e.g. 'review' to whoever answers)", () => {
    const o = openingForLead(lead, { observations: ["Booking takes 5 taps"], emailedReview: true });
    for (const line of spokenLines(o)) expect(findForbiddenPhrases(line)).toEqual([]);
  });

  it("the warm opener are short beats, not a monologue", () => {
    const o = openingForLead(lead, { observations: ["Booking takes 5 taps"], emailedReview: true });
    // A beat, not a paragraph the operator reads verbatim — keep the opener tight.
    expect(o.followUp!.opener.split(/[.!?]/).filter((s) => s.trim()).length).toBeLessThanOrEqual(3);
  });
});

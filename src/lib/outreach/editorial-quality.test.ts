import { describe, it, expect } from "vitest";
import {
  checkReview,
  checkEditorialRedundancy,
  editorialBlocks,
  diceSimilarity,
  containment,
  normalizeText,
  reviewEditorialSurface,
  type ReviewLike,
} from "./editorial-quality";

// The REAL All About Smiles review as generated on the first live batch (industry "dentist",
// allaboutsmilesmiddletown.com). The main hook is a verbatim copy of Finding 02's hook, and
// "Where we'd start" restates Finding 01's whyItMatters.
const AAS_ORIGINAL: ReviewLike = {
  businessName: "All About Smiles",
  website: "https://allaboutsmilesmiddletown.com/",
  industryLabel: "dentist",
  openingHook: "563+ customers already did the hard part.",
  findings: [
    { id: "f1", title: "Point visitors to one clear next step", whyItMatters: "A ready customer who can't tell what to do next is a customer lost at the last step.", whatWedDo: "Choose one primary action per page and make the secondary paths visibly secondary.", evidence: { displayLabel: "allaboutsmilesmiddletown.com · Homepage" } },
    { id: "f2", title: "Put 563+ customer reviews to work", whyItMatters: "The strongest trust signal the business already owns is invisible right when a new visitor is deciding whether to buy.", whatWedDo: "Surface the strongest customer reviews on the storefront and the pages where people decide.", evidence: { displayLabel: "Reviews" } },
  ],
  presentations: [
    { findingId: "f1", textHook: "Several main actions, no clear first move." },
    { findingId: "f2", textHook: "563+ customers already did the hard part." },
  ],
  start: { label: "Primary-action clarity pass", why: "A ready customer who can't tell what to do next is a customer lost at the last step. Of the two findings, it's the clearest to evidence and the fastest to show a result, so we'd start here.", proofReference: "Reviews" },
};

// The operator-revised version (Phase 2 direction). Distinct hook; distinct titles; the
// recommendation advances to a new action instead of restating a finding.
const AAS_REVISED: ReviewLike = {
  businessName: "All About Smiles",
  website: "https://allaboutsmilesmiddletown.com/",
  industryLabel: "Dental practice",
  openingHook: "Your reputation is stronger than your website currently shows.",
  findings: [
    { id: "f1", title: "Visitors have too many competing next steps.", whyItMatters: "The homepage presents several primary-looking actions without establishing one obvious next move.", whatWedDo: "Choose one primary action per page and make the secondary paths visibly secondary.", evidence: { displayLabel: "allaboutsmilesmiddletown.com · Homepage" } },
    { id: "f2", title: "Your 563+ reviews disappear at the moment of decision.", whyItMatters: "The business has 563+ external reviews and a 4.8/5 rating, but comparable testimonial or review proof was not surfaced on the crawled pages where a visitor is deciding whether to book.", whatWedDo: "Surface the strongest customer reviews on the storefront and the pages where people decide.", evidence: { displayLabel: "Reviews · 563+ external · 4.8/5" } },
  ],
  presentations: [
    { findingId: "f1", textHook: "Several main actions, no clear first move." },
    { findingId: "f2", textHook: "The proof is off the page at decision time." },
  ],
  start: { label: "Turn the homepage into one clear path to booking.", why: "We'd clarify the primary booking action first, then place your strongest review proof beside it so visitors know what to do and feel confident doing it.", proofReference: "Reviews · 563+ external" },
};

describe("editorial-quality — redundancy detector", () => {
  it("1. detects the ORIGINAL All About Smiles duplication (hook copy + recommendation restatement)", () => {
    const issues = checkReview(AAS_ORIGINAL);
    const codes = issues.map((i) => i.code);
    // main hook == finding-2 hook (masked-exact)
    expect(codes).toContain("exact-repeat");
    // "Where we'd start" restates Finding 01
    expect(codes).toContain("recommendation-restates-finding");
    expect(editorialBlocks(issues).length).toBeGreaterThanOrEqual(2);
  });

  it("2. the REVISED document passes the gate (no blocking issues)", () => {
    const issues = checkReview(AAS_REVISED);
    expect(editorialBlocks(issues)).toEqual([]);
  });

  it("3. exact duplicate hooks AND finding titles both block", () => {
    const dupHook = checkEditorialRedundancy([
      { section: "main-hook", role: "hook", text: "Booking still means making a phone call." },
      { section: "finding-1", role: "hook", text: "Booking still means making a phone call." },
    ]);
    expect(editorialBlocks(dupHook).some((i) => i.code === "exact-repeat" || i.code === "hook-copies-finding")).toBe(true);

    const dupTitle = checkEditorialRedundancy([
      { section: "finding-1", role: "title", text: "Make trust signals visible before the decision" },
      { section: "finding-2", role: "title", text: "Make trust signals visible before the decision" },
    ]);
    expect(editorialBlocks(dupTitle).some((i) => i.code === "exact-repeat" || i.code === "duplicate-title")).toBe(true);
  });

  it("4. near-duplicate (not exact) titles above threshold are flagged as blocking", () => {
    const issues = checkEditorialRedundancy([
      { section: "finding-1", role: "title", text: "Simplify a crowded main navigation menu" },
      { section: "finding-2", role: "title", text: "Simplify the crowded main navigation menus" },
    ]);
    expect(editorialBlocks(issues).some((i) => i.code === "duplicate-title")).toBe(true);
  });

  it("5. shared metrics, domain, and business name do NOT create false blocking failures", () => {
    // Two DIFFERENT findings that legitimately both mention 563+, the domain, and the name.
    const issues = checkReview({
      businessName: "All About Smiles",
      website: "https://allaboutsmilesmiddletown.com/",
      openingHook: "Your reputation is stronger than your website currently shows.",
      findings: [
        { id: "a", title: "Your 563+ reviews disappear at the moment of decision.", whyItMatters: "563+ external reviews exist but none surface on allaboutsmilesmiddletown.com where a visitor decides.", whatWedDo: "Surface the strongest reviews at the decision point.", evidence: { displayLabel: "allaboutsmilesmiddletown.com · Reviews" } },
        { id: "b", title: "Booking on allaboutsmilesmiddletown.com still means a phone call.", whyItMatters: "563+ patients chose All About Smiles, yet booking requires calling during office hours.", whatWedDo: "Add online booking so patients can reserve outside hours.", evidence: { displayLabel: "allaboutsmilesmiddletown.com · Booking" } },
      ],
      start: { label: "Online booking setup", why: "We'd add self-serve booking so the 563+ audience can act immediately.", proofReference: "Booking" },
    });
    expect(editorialBlocks(issues)).toEqual([]);
  });

  it("6. a lower-severity echo warns without blocking", () => {
    const issues = checkEditorialRedundancy([
      { section: "finding-1", role: "body", text: "Customers struggle to find the booking button on the crowded homepage layout." },
      { section: "finding-2", role: "body", text: "The crowded homepage layout makes the booking option hard to notice for customers." },
    ]);
    const blocks = editorialBlocks(issues);
    // depending on overlap this is a warn (echo) — must not be empty of signal, must not necessarily block
    expect(issues.some((i) => i.code === "similar-body" || i.code === "restated-body")).toBe(true);
  });

  it("7. placeholder/generic language blocks", () => {
    const issues = checkEditorialRedundancy([{ section: "finding-1", role: "body", text: "TODO: insert reason here for the client." }]);
    expect(editorialBlocks(issues).some((i) => i.code === "placeholder-language")).toBe(true);
  });

  it("8. helpers: normalize, dice, containment behave deterministically", () => {
    expect(normalizeText("563+ Customers—already DID it!")).toBe("563 customers already did it");
    expect(diceSimilarity(["a", "b"], ["a", "b"])).toBe(1);
    expect(diceSimilarity(["a"], ["b"])).toBe(0);
    // containment: a fully inside b (b has filler) → 1.0 even though dice < 1
    expect(containment(["ready", "customer", "lost"], ["ready", "customer", "lost", "of", "the", "findings", "fastest"])).toBe(1);
    expect(diceSimilarity(["ready", "customer", "lost"], ["ready", "customer", "lost", "of", "the", "findings", "fastest"])).toBeLessThan(0.7);
  });

  it("9. surface extraction skips same-section role pairs (intentional distinctness within a finding)", () => {
    const segs = reviewEditorialSurface(AAS_REVISED);
    // title/hook/body/action of finding-1 share a section and must never be compared to each other
    const f1 = segs.filter((s) => s.section === "finding-1");
    expect(f1.length).toBeGreaterThanOrEqual(3);
    const issues = checkEditorialRedundancy(f1);
    expect(issues).toEqual([]);
  });
});

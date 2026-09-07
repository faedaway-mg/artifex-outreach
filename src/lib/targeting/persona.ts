// ─────────────────────────────────────────────────────────────────────────────
// VERSIONED TARGET PERSONA (persona/targeting validation gate). The intended buyer, expressed with OBSERVABLE
// business characteristics only — never a sensitive psychological trait. Receptiveness is modelled from
// observable business + market conditions. This is the specification the scoring engine must be proven to
// implement (via the independently-labeled gold set), not a restatement of the code.
// ─────────────────────────────────────────────────────────────────────────────

export const PERSONA_VERSION = "persona-v1-2026-09";

export const CORE_PERSONA = {
  id: "REPUTATION_RICH_DIGITALLY_UNDERREPRESENTED_OPERATOR",
  name: "Reputation-rich, digitally underrepresented, owner-operated local business",
  positiveSignals: [
    "Owner or local decision-maker is reachable",
    "Independently operated or locally controlled",
    "Typically 1–5 locations",
    "Strong customer reputation (reviews, longevity, referrals, visible community trust)",
    "Website / customer journey materially undersells the quality of the business",
    "A presentation-led website or conversion improvement would be visibly valuable",
    "Service is valuable enough to justify a professional engagement",
    "Operationally active and capable of purchasing",
    "Primarily in a secondary or tertiary market where personalized attention stands out",
    "A specific, evidence-backed improvement can be shown in an Outreach Review",
    "A verified recipient is available before narration preparation",
  ],
  disqualifyingSignals: [
    "National enterprise or public company",
    "Corporate-controlled franchise location",
    "More than 10 locations unless independently controlled",
    "Sophisticated enterprise-grade website with no material opportunity",
    "No functioning website",
    "No meaningful commercial or reputation evidence",
    "Rejected / suppressed / duplicate / synthetic / policy-exhausted",
    "Purely cosmetic website issue with no plausible business consequence",
  ],
  forbiddenAssumptions: [
    "Never infer sensitive psychological traits about an individual",
    "Never fabricate reviews, employee counts, locations, growth events, or contacts",
    "Never mark an inferred email pattern as verified",
    "Never treat a national-chain location as locally controllable merely because it is in a small city",
    "Never let a high review count alone create Priority A",
    "Never let market size alone create or destroy eligibility unless the market policy requires it",
  ],
} as const;

export interface SubPersona {
  vertical: string;
  positiveSignals: string[];
  disqualifyingSignals: string[];
  decisionMaker: string;
  likelyPain: string;
  whyReviewResonates: string;
  evidenceRequired: string[];
  outreachAsset: "presentation-video" | "evidence-email-or-pdf" | "either";
  forbiddenAssumptions: string[];
}

export const SUB_PERSONAS: SubPersona[] = [
  {
    vertical: "home-services",
    positiveSignals: ["roofing/HVAC/plumbing/electrical/remodel/restoration", "strong local reviews", "1–5 trucks/crews", "owner answers reviews"],
    disqualifyingSignals: ["national franchise dispatch brand", "private-equity roll-up", "corporate call-center intake"],
    decisionMaker: "owner / operating partner",
    likelyPain: "great crews + reviews, but the website doesn't convert searchers to booked jobs",
    whyReviewResonates: "shows how the site loses after-hours/high-intent jobs a strong reputation already earned",
    evidenceRequired: ["specific conversion/booking finding", "supported customer consequence", "verified owner recipient"],
    outreachAsset: "presentation-video",
    forbiddenAssumptions: ["never assume revenue figures", "never claim guaranteed lead volume"],
  },
  {
    vertical: "automotive-services",
    positiveSignals: ["independent repair/collision/detail", "high review volume + rating", "1–3 bays/locations"],
    disqualifyingSignals: ["dealership group", "national franchise (Jiffy Lube/Midas/Meineke corporate)"],
    decisionMaker: "owner / shop manager with local control",
    likelyPain: "trusted shop whose site looks dated vs. the quality of work",
    whyReviewResonates: "demonstrates the trust gap between the shop's reputation and its online first impression",
    evidenceRequired: ["dated/weak-trust website finding", "supported consequence", "verified recipient"],
    outreachAsset: "presentation-video",
    forbiddenAssumptions: ["never infer franchise independence without evidence"],
  },
  {
    vertical: "dental-specialty-healthcare",
    positiveSignals: ["independent dental/ortho/derm/specialty practice", "strong reputation", "established practice"],
    disqualifyingSignals: ["hospital system", "DSO corporate-owned group", "university clinic"],
    decisionMaker: "owner-dentist / practice owner / office manager with local control",
    likelyPain: "excellent care + reviews, but booking/mobile/trust presentation underperforms",
    whyReviewResonates: "shows new-patient friction the practice's reputation should not have",
    evidenceRequired: ["booking/mobile/trust finding", "supported consequence", "verified recipient"],
    outreachAsset: "either",
    forbiddenAssumptions: ["never make health claims", "never imply patient volumes"],
  },
  {
    vertical: "professional-services",
    positiveSignals: ["independent legal/accounting/insurance/financial firm", "referral-driven reputation", "1–5 partners/offices"],
    disqualifyingSignals: ["national firm/branch", "public company", "franchise tax-prep corporate office"],
    decisionMaker: "managing partner / owner / practice lead",
    likelyPain: "referral-strong firm whose site doesn't communicate differentiation or convert",
    whyReviewResonates: "shows the clarity/differentiation gap a trusted firm can't afford",
    evidenceRequired: ["clarity/differentiation/contact finding", "supported consequence", "verified recipient"],
    outreachAsset: "evidence-email-or-pdf",
    forbiddenAssumptions: ["never state case outcomes or returns"],
  },
  {
    vertical: "property-facility-services",
    positiveSignals: ["commercial cleaning/landscaping/facility/property services", "regional reputation", "locally owned"],
    disqualifyingSignals: ["national facilities corporation", "franchise corporate office", "staffing megacorp"],
    decisionMaker: "owner / regional manager with local control",
    likelyPain: "capable regional operator whose site undersells scope and trust",
    whyReviewResonates: "shows the credibility gap that costs commercial bids",
    evidenceRequired: ["scope/trust/contact finding", "supported consequence", "verified recipient"],
    outreachAsset: "evidence-email-or-pdf",
    forbiddenAssumptions: ["never invent contract sizes"],
  },
  {
    vertical: "local-specialty-retail",
    positiveSignals: ["established specialty retailer", "strong community recognition + reviews", "1–3 locations"],
    disqualifyingSignals: ["national chain", "big-box", "franchise corporate"],
    decisionMaker: "owner / store operator",
    likelyPain: "beloved local shop with a weak or dated online presence",
    whyReviewResonates: "shows how the site fails to carry the in-store reputation online",
    evidenceRequired: ["presence/mobile/clarity finding", "supported consequence", "verified recipient"],
    outreachAsset: "either",
    forbiddenAssumptions: ["never assume e-commerce revenue"],
  },
  {
    vertical: "other-high-consideration-local",
    positiveSignals: ["high-consideration local service (pools, med spa, specialty B2B)", "genuine reputation", "owner-led"],
    disqualifyingSignals: ["enterprise", "corporate franchise", "no local control"],
    decisionMaker: "owner / founder / GM with local control",
    likelyPain: "high-value service whose digital presentation underrepresents the business",
    whyReviewResonates: "shows a concrete, high-value opportunity the reputation warrants",
    evidenceRequired: ["specific website finding", "supported consequence", "verified recipient"],
    outreachAsset: "either",
    forbiddenAssumptions: ["never fabricate growth signals"],
  },
];

export function subPersonaFor(industryOrName: string): SubPersona | null {
  const s = (industryOrName || "").toLowerCase();
  if (/roof|hvac|plumb|electric|remodel|restoration|landscap|home ?service/.test(s)) return SUB_PERSONAS[0];
  if (/auto|collision|repair|detail|body shop/.test(s)) return SUB_PERSONAS[1];
  if (/dental|dentist|ortho|derm|medical|clinic|healthcare|specialty practice/.test(s)) return SUB_PERSONAS[2];
  if (/law|legal|attorney|account|cpa|insurance|financ/.test(s)) return SUB_PERSONAS[3];
  if (/clean|janitor|facilit|property|landscap|hardscap/.test(s)) return SUB_PERSONAS[4];
  if (/retail|shop|store|boutique/.test(s)) return SUB_PERSONAS[5];
  if (/pool|med spa|wellness|spa|b2b/.test(s)) return SUB_PERSONAS[6];
  return null;
}

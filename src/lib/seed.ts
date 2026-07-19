// ─────────────────────────────────────────────────────────────────────────────
// Seed dataset — realistic, non-private sample businesses spanning every industry,
// tier, and pipeline stage the acceptance test needs. All data is invented.
// ─────────────────────────────────────────────────────────────────────────────
import type { Collections } from "./store";
import type { Lead, ScoreBreakdown, DeliverableContent } from "./types";
import { defaultSettings } from "./store";
import { categoryMetaForIndustry } from "./categories";

const dayMs = 86_400_000;
function isoOffset(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
const NOW = () => new Date().toISOString();

let counter = 0;
const id = (p: string) => `${p}_seed${(++counter).toString().padStart(3, "0")}`;

function placeholder(label: string, viewport: "mobile" | "desktop") {
  const w = viewport === "mobile" ? 390 : 1280;
  const h = viewport === "mobile" ? 780 : 800;
  return `/api/placeholder?w=${w}&h=${h}&label=${encodeURIComponent(label)}`;
}

function total(b: ScoreBreakdown): number {
  return Math.round(
    b.businessFit +
      b.websiteOpportunity +
      b.automationOpportunity +
      b.abilityToPay +
      b.publicReputation +
      b.contactability +
      b.triggerUrgency,
  );
}

type LeadSeed = Partial<Lead> & Pick<Lead, "businessName" | "industry" | "city" | "state">;

function mkLead(s: LeadSeed): Lead {
  const norm = s.businessName
    .toLowerCase()
    .replace(/\b(llc|inc|co|company|corp|ltd|the|and|&)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return {
    id: s.id ?? id("lead"),
    googlePlaceId: s.googlePlaceId ?? `ChIJ${norm.slice(0, 8)}mock`,
    businessName: s.businessName,
    normalizedName: norm,
    industry: s.industry,
    normalizedCategory: categoryMetaForIndustry(s.industry).normalizedCategory,
    categoryGroup: categoryMetaForIndustry(s.industry).group,
    address: s.address ?? "1200 Market St",
    city: s.city,
    state: s.state,
    postalCode: s.postalCode ?? "90012",
    latitude: s.latitude ?? 34.05,
    longitude: s.longitude ?? -118.24,
    phone: s.phone ?? null,
    website: s.website ?? null,
    websiteDomain: s.websiteDomain ?? null,
    publicEmail: s.publicEmail ?? null,
    contactFormUrl: s.contactFormUrl ?? null,
    socialLinks: s.socialLinks ?? [],
    locationsCount: s.locationsCount ?? null,
    rating: s.rating ?? null,
    reviewCount: s.reviewCount ?? null,
    businessStatus: s.businessStatus ?? "OPERATIONAL",
    googleMapsUrl: s.googleMapsUrl ?? "https://maps.google.com/?cid=mock",
    hours: s.hours ?? "Mon–Fri 9–5",
    source: s.source ?? "Google Places",
    retrievedAt: s.retrievedAt ?? NOW(),
    tier: s.tier ?? null,
    leadScore: s.leadScore ?? null,
    scoreBreakdown: s.scoreBreakdown ?? null,
    pipelineStage: s.pipelineStage ?? "Discovered",
    estimatedValueLow: s.estimatedValueLow ?? null,
    estimatedValueHigh: s.estimatedValueHigh ?? null,
    recommendedService: s.recommendedService ?? null,
    recommendedAction: s.recommendedAction ?? null,
    recommendationReason: s.recommendationReason ?? null,
    opportunitySummary: s.opportunitySummary ?? null,
    strengths: s.strengths ?? [],
    acquisitionStrategy: s.acquisitionStrategy ?? null,
    acquisitionScore: s.acquisitionScore ?? null,
    acquisitionReason: s.acquisitionReason ?? null,
    acquisitionScoreBreakdown: s.acquisitionScoreBreakdown ?? null,
    acquisitionOverride: s.acquisitionOverride ?? false,
    assignedTo: "jordan",
    note: s.note ?? null,
    lastContactAt: s.lastContactAt ?? null,
    nextFollowUpAt: s.nextFollowUpAt ?? null,
    createdAt: s.createdAt ?? NOW(),
    updatedAt: NOW(),
  };
}

export function buildSeed(store: Collections): void {
  store.settings = defaultSettings();

  store.users.push({
    id: "jordan",
    name: "Jordan Jackson",
    email: "jordan@artifexlabs.tech",
    role: "Founder / Operator",
    createdAt: NOW(),
    updatedAt: NOW(),
  });

  // ── 1. Taylor Dental — flagship Tier A, deliverable + video + outreach in flight
  const taylorScore: ScoreBreakdown = {
    businessFit: 18,
    websiteOpportunity: 18,
    automationOpportunity: 15,
    abilityToPay: 13,
    publicReputation: 9,
    contactability: 9,
    triggerUrgency: 3,
  };
  const taylor = mkLead({
    id: "lead_taylor",
    businessName: "Taylor Family Dental",
    industry: "Dental practice",
    address: "418 Riverside Ave",
    city: "Pasadena",
    state: "CA",
    postalCode: "91101",
    phone: "(626) 555-0142",
    website: "https://taylorfamilydental.com",
    websiteDomain: "taylorfamilydental.com",
    publicEmail: "hello@taylorfamilydental.com",
    contactFormUrl: "https://taylorfamilydental.com/contact",
    socialLinks: ["https://instagram.com/taylorfamilydental"],
    locationsCount: 1,
    rating: 4.8,
    reviewCount: 214,
    tier: "A",
    leadScore: total(taylorScore),
    scoreBreakdown: taylorScore,
    pipelineStage: "Deliverable Ready",
    estimatedValueLow: 8000,
    estimatedValueHigh: 18000,
    recommendedService: "Business Website System",
    recommendedAction: "Prepare video",
    recommendationReason:
      "Strong local reputation with a dated mobile site — a personalized walkthrough will land the appointment-intake opportunity far better than text.",
    opportunitySummary:
      "Taylor Family Dental has a strong local reputation, but its mobile website makes appointment discovery and intake harder than necessary. The strongest initial opportunity is a mobile-first website and patient-intake modernization project.",
    strengths: [
      "Excellent review reputation (4.8★ across 214 reviews)",
      "Clear specialization in family and cosmetic dentistry",
      "Established, trusted local presence",
    ],
    lastContactAt: null,
  });

  // ── 2. Brightwater Law — Tier A, Contacted, follow-up DUE TODAY
  const bwScore: ScoreBreakdown = {
    businessFit: 17,
    websiteOpportunity: 14,
    automationOpportunity: 17,
    abilityToPay: 14,
    publicReputation: 8,
    contactability: 8,
    triggerUrgency: 4,
  };
  const brightwater = mkLead({
    id: "lead_brightwater",
    businessName: "Brightwater Law Group",
    industry: "Law firm",
    address: "77 Corporate Plaza",
    city: "Irvine",
    state: "CA",
    postalCode: "92612",
    phone: "(949) 555-0177",
    website: "https://brightwaterlaw.com",
    websiteDomain: "brightwaterlaw.com",
    publicEmail: "intake@brightwaterlaw.com",
    contactFormUrl: "https://brightwaterlaw.com/contact",
    rating: 4.6,
    reviewCount: 88,
    tier: "A",
    leadScore: total(bwScore),
    scoreBreakdown: bwScore,
    pipelineStage: "Follow-Up",
    estimatedValueLow: 12000,
    estimatedValueHigh: 30000,
    recommendedService: "AI Operations System",
    recommendedAction: "Send personalized email",
    recommendationReason:
      "Intake is handled manually by email — an AI operations layer would recover leads lost to slow response times.",
    opportunitySummary:
      "Brightwater Law has strong practice-area depth but a manual intake funnel. The best opening is an AI-assisted intake and follow-up system.",
    strengths: ["Deep practice-area content", "Solid 4.6★ reputation", "Clear service structure"],
    lastContactAt: isoOffset(-3),
    nextFollowUpAt: isoOffset(0, 10),
  });

  // ── 3. Summit Strength — Tier B, Qualified
  const summitScore: ScoreBreakdown = {
    businessFit: 14,
    websiteOpportunity: 15,
    automationOpportunity: 11,
    abilityToPay: 9,
    publicReputation: 8,
    contactability: 7,
    triggerUrgency: 2,
  };
  const summit = mkLead({
    id: "lead_summit",
    businessName: "Summit Strength Studio",
    industry: "Fitness studio",
    address: "512 Foothill Blvd",
    city: "Glendale",
    state: "CA",
    postalCode: "91205",
    phone: "(818) 555-0193",
    website: "https://summitstrength.fit",
    websiteDomain: "summitstrength.fit",
    socialLinks: ["https://instagram.com/summitstrength"],
    rating: 4.7,
    reviewCount: 132,
    tier: "B",
    leadScore: total(summitScore),
    scoreBreakdown: summitScore,
    pipelineStage: "Qualified",
    estimatedValueLow: 3500,
    estimatedValueHigh: 6500,
    recommendedService: "Launch Website",
    recommendedAction: "Send personalized email",
    recommendationReason:
      "Instagram-driven brand with a thin website — a quick modern site + class booking would convert existing attention.",
    opportunitySummary:
      "Summit Strength has a strong social following but leans on link-in-bio. A modern site with class booking is the clear first step.",
    strengths: ["Engaged social following", "Strong class reviews"],
  });

  // ── 4. Evergreen Plumbing — Tier A, Meeting Booked TODAY
  const evScore: ScoreBreakdown = {
    businessFit: 16,
    websiteOpportunity: 16,
    automationOpportunity: 18,
    abilityToPay: 12,
    publicReputation: 8,
    contactability: 9,
    triggerUrgency: 3,
  };
  const evergreen = mkLead({
    id: "lead_evergreen",
    businessName: "Evergreen Plumbing & Heating",
    industry: "Home-service company",
    address: "3400 Industrial Way",
    city: "Long Beach",
    state: "CA",
    postalCode: "90805",
    phone: "(562) 555-0110",
    website: "https://evergreenplumbingla.com",
    websiteDomain: "evergreenplumbingla.com",
    publicEmail: "dispatch@evergreenplumbingla.com",
    rating: 4.5,
    reviewCount: 301,
    tier: "A",
    leadScore: total(evScore),
    scoreBreakdown: evScore,
    pipelineStage: "Meeting Booked",
    estimatedValueLow: 4000,
    estimatedValueHigh: 9000,
    recommendedService: "Automation Sprint",
    recommendedAction: "Call",
    recommendationReason:
      "High call volume with manual dispatch — an automation sprint on scheduling and follow-up is an obvious win.",
    opportunitySummary:
      "Evergreen handles high job volume with manual phone dispatch. Automating scheduling, confirmations, and review requests is the strongest opening.",
    strengths: ["Very high review count (301)", "24/7 service coverage", "Established fleet"],
    lastContactAt: isoOffset(-6),
  });

  // ── 5. Nadia Cole Consulting — Tier B, Proposal Sent
  const nadiaScore: ScoreBreakdown = {
    businessFit: 13,
    websiteOpportunity: 12,
    automationOpportunity: 12,
    abilityToPay: 11,
    publicReputation: 7,
    contactability: 8,
    triggerUrgency: 3,
  };
  const nadia = mkLead({
    id: "lead_nadia",
    businessName: "Nadia Cole Consulting",
    industry: "Professional consultant",
    address: "220 Ocean Ave, Suite 4",
    city: "Santa Monica",
    state: "CA",
    postalCode: "90401",
    phone: "(310) 555-0155",
    website: "https://nadiacole.co",
    websiteDomain: "nadiacole.co",
    publicEmail: "nadia@nadiacole.co",
    rating: 5.0,
    reviewCount: 27,
    tier: "B",
    leadScore: total(nadiaScore),
    scoreBreakdown: nadiaScore,
    pipelineStage: "Proposal Sent",
    estimatedValueLow: 6000,
    estimatedValueHigh: 15000,
    recommendedService: "Product Strategy Engagement",
    recommendedAction: "Send personalized email",
    recommendationReason:
      "Boutique consultant scaling into productized services — a strategy engagement fits her growth stage.",
    opportunitySummary:
      "Nadia is productizing her consulting. A strategy engagement plus a supporting site is the natural path.",
    strengths: ["Flawless 5.0★ reputation", "Clear premium positioning"],
    lastContactAt: isoOffset(-9),
  });

  // ── 6. Copper & Oak Mercantile — Tier A, WON
  const coScore: ScoreBreakdown = {
    businessFit: 15,
    websiteOpportunity: 17,
    automationOpportunity: 14,
    abilityToPay: 12,
    publicReputation: 9,
    contactability: 8,
    triggerUrgency: 4,
  };
  const copper = mkLead({
    id: "lead_copper",
    businessName: "Copper & Oak Mercantile",
    industry: "Specialty retailer",
    address: "88 Abbot Kinney Blvd",
    city: "Venice",
    state: "CA",
    postalCode: "90291",
    phone: "(424) 555-0166",
    website: "https://copperandoak.shop",
    websiteDomain: "copperandoak.shop",
    publicEmail: "orders@copperandoak.shop",
    socialLinks: ["https://instagram.com/copperandoak"],
    rating: 4.9,
    reviewCount: 156,
    tier: "A",
    leadScore: total(coScore),
    scoreBreakdown: coScore,
    pipelineStage: "Won",
    estimatedValueLow: 8000,
    estimatedValueHigh: 18000,
    recommendedService: "Business Website System",
    recommendedAction: "Skip",
    recommendationReason: "Closed — engagement in delivery.",
    opportunitySummary:
      "Copper & Oak needed a modern storefront and inventory sync. Engagement won and in delivery.",
    strengths: ["Beautiful product photography", "Loyal local following"],
    lastContactAt: isoOffset(-21),
  });

  // ── 7. QuickCash Payday — Disqualified
  const quickcash = mkLead({
    id: "lead_quickcash",
    businessName: "QuickCash Payday Loans",
    industry: "Financial services",
    address: "9 Sunset Strip",
    city: "Los Angeles",
    state: "CA",
    postalCode: "90028",
    phone: "(213) 555-0189",
    website: "https://quickcash-payday.example",
    websiteDomain: "quickcash-payday.example",
    rating: 2.4,
    reviewCount: 12,
    tier: "C",
    leadScore: 24,
    scoreBreakdown: {
      businessFit: 3,
      websiteOpportunity: 8,
      automationOpportunity: 5,
      abilityToPay: 3,
      publicReputation: 1,
      contactability: 3,
      triggerUrgency: 1,
    },
    pipelineStage: "Disqualified",
    recommendedService: null,
    recommendedAction: "Skip",
    recommendationReason:
      "Poor reputation and misaligned industry — not a fit for Artifex Labs positioning.",
    note: "Manually disqualified — brand misalignment.",
  });

  // ── 8. Harbor Point Yoga — Tier C, Nurture
  const harborScore: ScoreBreakdown = {
    businessFit: 11,
    websiteOpportunity: 9,
    automationOpportunity: 7,
    abilityToPay: 6,
    publicReputation: 7,
    contactability: 4,
    triggerUrgency: 1,
  };
  const harbor = mkLead({
    id: "lead_harbor",
    businessName: "Harbor Point Yoga",
    industry: "Fitness studio",
    address: "14 Harbor Point",
    city: "Redondo Beach",
    state: "CA",
    postalCode: "90277",
    website: "https://harborpointyoga.com",
    websiteDomain: "harborpointyoga.com",
    rating: 4.9,
    reviewCount: 41,
    tier: "C",
    leadScore: total(harborScore),
    scoreBreakdown: harborScore,
    pipelineStage: "Nurture",
    recommendedService: "Launch Website",
    recommendedAction: "Nurture",
    recommendationReason:
      "Lovely small studio but limited budget signals and no direct contact — monitor for now.",
    strengths: ["Warm brand", "Loyal community"],
  });

  // ── 9. Meridian Family Dentistry — freshly Discovered
  const meridian = mkLead({
    id: "lead_meridian",
    businessName: "Meridian Family Dentistry",
    industry: "Dental practice",
    address: "500 Colorado Blvd",
    city: "Pasadena",
    state: "CA",
    postalCode: "91105",
    phone: "(626) 555-0121",
    website: "https://meridiandentalpasadena.com",
    websiteDomain: "meridiandentalpasadena.com",
    rating: 4.4,
    reviewCount: 63,
    pipelineStage: "Discovered",
  });

  store.leads.push(
    taylor,
    brightwater,
    summit,
    evergreen,
    nadia,
    copper,
    quickcash,
    harbor,
    meridian,
  );

  // ── Contacts ─────────────────────────────────────────────────────────────
  store.contacts.push(
    {
      id: id("contact"),
      leadId: taylor.id,
      name: "Dr. Sarah Taylor",
      title: "Owner / Lead Dentist",
      email: "hello@taylorfamilydental.com",
      phone: taylor.phone,
      linkedinUrl: null,
      source: "Website about page",
      confidence: "Likely",
      verified: false,
      optedOut: false,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("contact"),
      leadId: brightwater.id,
      name: "Marcus Reyes",
      title: "Managing Partner",
      email: "intake@brightwaterlaw.com",
      phone: brightwater.phone,
      linkedinUrl: "https://linkedin.com/in/marcusreyes",
      source: "Website + LinkedIn",
      confidence: "Verified",
      verified: true,
      optedOut: false,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("contact"),
      leadId: evergreen.id,
      name: "Dana Whitfield",
      title: "Operations Manager",
      email: "dispatch@evergreenplumbingla.com",
      phone: evergreen.phone,
      linkedinUrl: null,
      source: "Phone intake",
      confidence: "Likely",
      verified: false,
      optedOut: false,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("contact"),
      leadId: nadia.id,
      name: "Nadia Cole",
      title: "Founder",
      email: "nadia@nadiacole.co",
      phone: nadia.phone,
      linkedinUrl: "https://linkedin.com/in/nadiacole",
      source: "Website",
      confidence: "Verified",
      verified: true,
      optedOut: false,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
  );

  // ── Findings for Taylor (analysis complete) ──────────────────────────────
  store.findings.push(
    {
      id: id("finding"),
      leadId: taylor.id,
      category: "Mobile usability",
      title: "Appointment booking is hard to find on mobile",
      observation:
        "On mobile the primary 'Book appointment' action sits below three folds and uses a small text link rather than a button.",
      evidence: "Mobile screenshot — homepage; tap target measured at 28px, below the 44px guideline.",
      businessImpact:
        "Prospective patients on phones may abandon before booking, sending them to competitors.",
      modernizationDirection: "Persistent mobile 'Book now' button and streamlined intake form.",
      findingType: "Automated technical finding",
      confidence: "Verified",
      sourceUrl: "https://taylorfamilydental.com",
      analyzedAt: NOW(),
      deterministic: true,
      approved: true,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("finding"),
      leadId: taylor.id,
      category: "Conversion journey",
      title: "New-patient intake requires a phone call",
      observation:
        "There is no online intake form; the site directs all new patients to call during business hours.",
      evidence: "Contact page review — only phone and address listed, no form.",
      businessImpact: "After-hours interest is lost; staff spend time on repetitive intake calls.",
      modernizationDirection: "Online intake + scheduling with automated confirmations.",
      findingType: "AI inference",
      confidence: "Likely",
      sourceUrl: "https://taylorfamilydental.com/contact",
      analyzedAt: NOW(),
      deterministic: false,
      approved: true,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("finding"),
      leadId: taylor.id,
      category: "Page speed",
      title: "Homepage loads slowly on mobile",
      observation: "Largest Contentful Paint measured at ~4.6s on a simulated mobile connection.",
      evidence: "PageSpeed-style check — LCP 4.6s, unoptimized hero image ~2.1MB.",
      businessImpact: "Slow first impression increases bounce rate on paid and organic traffic.",
      modernizationDirection: "Image optimization and modern framework rebuild.",
      findingType: "Automated technical finding",
      confidence: "Verified",
      sourceUrl: "https://taylorfamilydental.com",
      analyzedAt: NOW(),
      deterministic: true,
      approved: false,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
  );

  // ── Screenshots for Taylor ───────────────────────────────────────────────
  store.screenshots.push(
    {
      id: id("shot"),
      leadId: taylor.id,
      pageUrl: "https://taylorfamilydental.com",
      viewport: "desktop",
      storageUrl: placeholder("Taylor Dental — Homepage (desktop)", "desktop"),
      caption: "Homepage — desktop",
      storageKey: null,
      approved: true,
      createdAt: NOW(),
    },
    {
      id: id("shot"),
      leadId: taylor.id,
      pageUrl: "https://taylorfamilydental.com",
      viewport: "mobile",
      storageUrl: placeholder("Taylor Dental — Homepage (mobile)", "mobile"),
      caption: "Homepage — mobile (booking below the fold)",
      storageKey: null,
      approved: true,
      createdAt: NOW(),
    },
    {
      id: id("shot"),
      leadId: taylor.id,
      pageUrl: "https://taylorfamilydental.com/contact",
      viewport: "mobile",
      storageUrl: placeholder("Taylor Dental — Contact (mobile)", "mobile"),
      caption: "Contact page — phone only, no intake form",
      storageKey: null,
      approved: true,
      createdAt: NOW(),
    },
  );

  // ── Deliverable draft for Taylor ─────────────────────────────────────────
  const taylorBrief: DeliverableContent = {
    cover: {
      subtitle: "Business Modernization Brief",
      confidentialityNote: "Confidential discussion document",
    },
    executiveSnapshot: {
      overview:
        "Taylor Family Dental is a well-reviewed Pasadena practice whose website has not kept pace with how patients now discover and book care.",
      whatIsWorking:
        "An excellent reputation (4.8★, 214 reviews), clear specialization, and a trusted local presence.",
      primaryOpportunity:
        "Modernize the mobile experience and patient intake so booking is effortless from a phone.",
      potentialImpact:
        "Reducing friction in mobile booking typically recovers appointment requests that are otherwise lost after hours.",
      recommendedFirstConversation:
        "A short call to review the mobile booking flow and intake automation options.",
    },
    strengths: [
      "Excellent review reputation (4.8★ across 214 reviews)",
      "Clear specialization in family and cosmetic dentistry",
      "Established, trusted local presence",
    ],
    opportunities: [
      {
        observation: "Appointment booking is hard to find on mobile.",
        evidence: "The primary booking action sits well below the fold as a small text link.",
        businessConsequence: "Phone visitors may leave before booking.",
        modernizationDirection: "Persistent mobile booking button and simplified intake.",
      },
      {
        observation: "New-patient intake requires a phone call.",
        evidence: "No online intake form; the site directs new patients to call.",
        businessConsequence: "After-hours interest is lost and staff field repetitive calls.",
        modernizationDirection: "Online intake and scheduling with automated confirmations.",
      },
    ],
    customerJourney: {
      currentState: [
        "Patient finds the practice on their phone",
        "Scrolls to find a booking option",
        "Must call during business hours",
        "May give up if it is after hours",
      ],
      futureState: [
        "Patient finds the practice on their phone",
        "Taps a persistent 'Book now' button",
        "Completes a short intake form anytime",
        "Receives an automated confirmation",
      ],
    },
    modernizationPath: {
      primaryEngagement: "Business Website System",
      components: [
        "Mobile-first website rebuild",
        "Online patient intake + scheduling",
        "Automated appointment confirmations",
      ],
      secondaryOpportunity: "Automated review requests after visits.",
      investmentRange: null,
      disclaimer: "Scope and pricing require a short discovery conversation.",
    },
    cta: {
      headline: "Let's explore what this could look like.",
      body: "A brief, no-obligation conversation to review the observations and see if a modernization project makes sense for Taylor Family Dental.",
    },
  };

  store.deliverables.push({
    id: "deliv_taylor",
    leadId: taylor.id,
    type: "Modernization Brief",
    status: "draft",
    content: taylorBrief,
    pdfUrl: null,
    pdfKey: null,
    approvedAt: null,
    sentAt: null,
    aiMeta: {
      provider: "mock",
      model: "artifex-mock-analyst-v1",
      promptVersion: "brief-1.0.0",
      timestamp: NOW(),
      inputSourceRefs: ["findings", "website-analysis", "google-places"],
    },
    createdAt: NOW(),
    updatedAt: NOW(),
  });

  // ── Video (script ready) for Taylor ──────────────────────────────────────
  store.videos.push({
    id: "video_taylor",
    leadId: taylor.id,
    title: "A quick look at Taylor Family Dental's mobile booking",
    recommendedLength: "60–90 seconds",
    positiveOpening:
      "The reputation your team has built — 4.8 stars across 200+ reviews — really stands out.",
    findings: [
      "Booking is hard to find on mobile",
      "New-patient intake still requires a phone call",
    ],
    screenshotIds: store.screenshots.filter((s) => s.leadId === taylor.id).map((s) => s.id),
    script:
      "Hi Dr. Taylor, I'm Jordan from Artifex Labs. I was researching well-regarded Pasadena dental practices and yours stood out — 4.8 stars across more than 200 reviews is genuinely impressive.\n\nI took a quick look at the site on my phone, and I noticed a couple of small things that might be making it harder than necessary for new patients to book. Let me show you...\n\n[Show mobile homepage] Booking sits pretty far down the page, and [show contact page] new patients are asked to call rather than book online.\n\nThe good news is these are very fixable. I put together a short complimentary Business Modernization Brief with the specifics — no obligation. Would you be open to a brief conversation after you've had a look?",
    cta: "Would you be open to a brief conversation after reviewing the brief?",
    accompanyingEmail:
      "Hi Dr. Taylor — I recorded a short walkthrough of your site's mobile booking flow and prepared a complimentary Modernization Brief. No obligation; I thought the observations might be useful.",
    followUpDate: isoOffset(3),
    videoUrl: null,
    status: "script_ready",
    sentAt: null,
    aiMeta: {
      provider: "mock",
      model: "artifex-mock-analyst-v1",
      promptVersion: "video-1.0.0",
      timestamp: NOW(),
      inputSourceRefs: ["findings", "opportunity-summary"],
    },
    createdAt: NOW(),
    updatedAt: NOW(),
  });

  // ── Outreach draft awaiting approval (Taylor) ────────────────────────────
  store.outreach.push({
    id: "out_taylor",
    leadId: taylor.id,
    contactId: store.contacts.find((c) => c.leadId === taylor.id)?.id ?? null,
    channel: "email",
    subject: "A quick observation about Taylor Family Dental's site",
    body:
      "Hi Dr. Taylor,\n\nI'm Jordan, founder of Artifex Labs.\n\nI came across Taylor Family Dental while researching established local practices and was impressed by the reputation your team has built.\n\nWhile reviewing the mobile experience, I noticed a few opportunities to make appointment discovery and intake easier for prospective patients.\n\nI recorded a short walkthrough and prepared a complimentary Business Modernization Brief for your team. There is no obligation attached — I thought the observations might be useful.\n\nWould you be open to a brief conversation after reviewing it?\n\nJordan Jackson\nFounder, Artifex Labs\nartifexlabs.tech",
    status: "draft",
    sentAt: null,
    responseStatus: "none",
    aiMeta: {
      provider: "mock",
      model: "artifex-mock-analyst-v1",
      promptVersion: "outreach-1.0.0",
      timestamp: NOW(),
      inputSourceRefs: ["opportunity-summary", "findings"],
    },
    createdAt: NOW(),
    updatedAt: NOW(),
  });

  // Brightwater already-sent outreach (for follow-up context)
  store.outreach.push({
    id: id("out"),
    leadId: brightwater.id,
    contactId: store.contacts.find((c) => c.leadId === brightwater.id)?.id ?? null,
    channel: "email",
    subject: "Making Brightwater's intake faster",
    body: "Hi Marcus, I noticed intake at Brightwater runs through email...",
    status: "sent",
    sentAt: isoOffset(-3),
    responseStatus: "none",
    aiMeta: null,
    createdAt: isoOffset(-3),
    updatedAt: isoOffset(-3),
  });

  // ── Meeting for Evergreen (TODAY) ────────────────────────────────────────
  store.meetings.push({
    id: "meet_evergreen",
    leadId: evergreen.id,
    contactId: store.contacts.find((c) => c.leadId === evergreen.id)?.id ?? null,
    scheduledAt: isoOffset(0, 14),
    meetingUrl: "https://meet.google.com/mock-evergreen",
    discoveryQuestions: [
      "How are new service calls currently handled from first ring to scheduled job?",
      "What happens after a customer requests service online?",
      "Which parts of dispatch require the most manual work today?",
      "Can you currently see which channels produce the most booked jobs?",
      "Is modernizing scheduling already part of your plans this year?",
    ],
    likelyObjections: [
      "We're busy enough already",
      "Our team is used to the current phone system",
      "Concerned about cost during slow season",
    ],
    notes: "",
    nextStep: "",
    outcome: "pending",
    createdAt: isoOffset(-6),
    updatedAt: isoOffset(-6),
  });

  // ── Proposal for Nadia ───────────────────────────────────────────────────
  store.proposals.push({
    id: "prop_nadia",
    leadId: nadia.id,
    number: "AL-P-2026-001",
    version: 1,
    status: "sent",
    amount: 11000,
    proposalUrl: "https://artifexlabs.tech/proposals/nadia-cole",
    sentAt: isoOffset(-4),
    acceptedAt: null,
    createdAt: isoOffset(-4),
    updatedAt: isoOffset(-4),
  });

  // ── Won proposal for Copper & Oak (revenue) ──────────────────────────────
  store.proposals.push({
    id: id("prop"),
    leadId: copper.id,
    number: "AL-P-2026-002",
    version: 1,
    status: "accepted",
    amount: 14500,
    proposalUrl: "https://artifexlabs.tech/proposals/copper-oak",
    sentAt: isoOffset(-24),
    acceptedAt: isoOffset(-18),
    createdAt: isoOffset(-24),
    updatedAt: isoOffset(-18),
  });

  // ── Suppression list example ─────────────────────────────────────────────
  store.suppressions.push({
    id: id("supp"),
    email: "no-thanks@example.com",
    domain: null,
    phone: null,
    reason: "Opted out via reply",
    createdAt: isoOffset(-30),
  });

  // ── Tasks — the Today queue ──────────────────────────────────────────────
  store.tasks.push(
    {
      id: id("task"),
      leadId: taylor.id,
      type: "prepare_video",
      title: "Record personalized walkthrough for Taylor Family Dental",
      dueAt: isoOffset(0, 9),
      status: "open",
      priority: 90,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("task"),
      leadId: taylor.id,
      type: "review_and_send",
      title: "Review & approve outreach to Dr. Taylor",
      dueAt: isoOffset(0, 9),
      status: "open",
      priority: 80,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("task"),
      leadId: brightwater.id,
      type: "follow_up",
      title: "Day-3 follow-up with Brightwater Law Group",
      dueAt: isoOffset(0, 10),
      status: "open",
      priority: 70,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("task"),
      leadId: evergreen.id,
      type: "prepare_meeting",
      title: "Prepare discovery meeting — Evergreen Plumbing (2pm)",
      dueAt: isoOffset(0, 12),
      status: "open",
      priority: 85,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("task"),
      leadId: nadia.id,
      type: "prepare_proposal",
      title: "Check on proposal sent to Nadia Cole",
      dueAt: isoOffset(0, 11),
      status: "open",
      priority: 60,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("task"),
      leadId: summit.id,
      type: "review",
      title: "Review Summit Strength Studio and choose next action",
      dueAt: isoOffset(0, 9),
      status: "open",
      priority: 40,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: id("task"),
      leadId: meridian.id,
      type: "review",
      title: "Qualify Meridian Family Dentistry",
      dueAt: isoOffset(1, 9),
      status: "open",
      priority: 30,
      snoozedUntil: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
  );
}

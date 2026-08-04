// ─────────────────────────────────────────────────────────────────────────────
// The Opening — reasoned, not filled in.
//
// The old opening was a template with the business name substituted in: "I put
// together a short review for {name} with a few observations that might be
// useful." Every business on earth got the same sentence. Worse, "review" means
// Google review, Yelp, or reputation management to whoever picks up the phone —
// so the first thing they hear is the wrong thing entirely.
//
// This module does not write a sentence and then fill in blanks. It reasons, in
// order, about the things a person would reason about before speaking:
//
//   1. understandJourney — what does this business actually do, and what is the
//      moment where a customer decides? (a motel is booked; a roofer is quoted;
//      a restaurant is chosen in thirty seconds)
//   2. readFinding       — what did our analysis actually find, translated out of
//      analyst language into what a normal person would say
//   3. deliverableFor    — what tangible thing exists to send, named concretely
//   4. whoAnswers        — who is realistically holding the phone, and what they want
//   5. composeOpening    — only now, the words
//
// THE RECEPTIONIST TEST governs every line: the person answering is not the
// owner, wants to help, and wants to get off the phone. Five questions must be
// answered before they can act — why are you calling, what exactly did you make,
// why is it relevant, why should I care, why should I give you an email. A
// sentence that answers none of those is cut.
//
// Two rules that shaped the code:
//
//   · WE NEVER READ THE ANALYSIS ALOUD. The intelligence engine emits strings
//     like "Customer Journey (highest leverage)". Speaking that is how a call
//     sounds machine-generated. The raw finding is classified into a customer
//     moment, and then WE say the plain-English sentence for that moment, shaped
//     by this specific business's journey. The raw text survives only as private
//     evidence the operator can read if asked.
//
//   · WHEN WE DON'T KNOW, WE DON'T CLAIM. No analysis, or an analysis with
//     nothing customer-visible in it, produces an honest opening that offers the
//     walkthrough without asserting a problem we haven't observed.
// ─────────────────────────────────────────────────────────────────────────────
import { categoryMetaForIndustry, slug } from "../categories";
import { classify, type FrictionDomain } from "../intelligence/friction-taxonomy";
import { audienceNoun, tradeNoun } from "./voice";

// ── 1 · The customer journey ─────────────────────────────────────────────────

/**
 * How a customer of THIS kind of business actually arrives, and the moment they
 * decide. Everything downstream is phrased through this — which is why a hotel
 * and a law firm cannot end up with the same sentence.
 */
export interface CustomerJourney {
  /** The customer in plain words: "someone trying to book a room". */
  actor: string;
  /** What that person is trying to do: "book a room". */
  goal: string;
  /** The decisive step, named the way a normal person would: "booking". */
  conversion: string;
  /** What we looked at — spoken, never jargon. Follows "I looked at …". */
  lens: string;
  /** Where people realistically fall away: "before they ever call". */
  dropPoint: string;
  /** What this business calls its customers. */
  audience: string;
  /** What this business calls itself: "practice", "firm", "shop". */
  trade: string;
  /** What someone types into Google to find a business like this. */
  searchTerm: string;
  /** Which reasoning branch produced this — for the operator and for tests. */
  source: "category" | "industry-words" | "group" | "generic";
}

type J = Omit<Partial<CustomerJourney>, "source"> & Pick<CustomerJourney, "actor" | "goal" | "lens">;

/**
 * Per-category journeys. This table is the product: it is the difference between
 * a call that sounds like a person who looked, and a call that sounds like a
 * mail merge. Keys are the normalized category slugs from src/lib/categories.ts.
 */
const JOURNEY_BY_CATEGORY: Record<string, J> = {
  // ── Professional Services ──
  "law-firms": {
    actor: "someone who just realized they need a lawyer",
    goal: "call you",
    conversion: "that first call",
    lens: "how someone with a problem finds the firm, and what they see before they ever speak to anyone",
    dropPoint: "before they ever pick up the phone",
    searchTerm: "a lawyer",
  },
  "accounting-firms": {
    actor: "someone deciding who to hand their books to",
    goal: "reach out",
    conversion: "the first conversation",
    lens: "what someone sees while they're deciding which accountant to call",
    searchTerm: "an accountant",
  },
  "tax-professionals": {
    actor: "someone who needs their taxes handled and is comparing two or three names",
    goal: "get in touch",
    conversion: "the first call",
    lens: "what someone comparing a few names sees before they choose one",
    searchTerm: "a tax preparer",
  },
  "business-consultants": {
    actor: "someone deciding whether you are the right person to help them",
    goal: "book an intro call",
    conversion: "booking that first call",
    lens: "what someone reads about you while they're deciding whether to book a call",
    dropPoint: "before they book anything",
  },
  "executive-coaches": {
    actor: "someone deciding whether you are the right coach for them",
    goal: "book a first conversation",
    conversion: "booking that first conversation",
    lens: "what someone sees while they're deciding whether you are the right fit",
  },
  "business-coaches": {
    actor: "a business owner deciding whether you can actually help them",
    goal: "book a first conversation",
    conversion: "booking that first conversation",
    lens: "what an owner sees while they're deciding whether you can actually help",
  },
  "recruiting-and-staffing-firms": {
    actor: "a hiring manager who needs people quickly",
    goal: "hand you a search",
    conversion: "starting a search",
    lens: "what a hiring manager sees when they're deciding who to hand a search to",
  },
  "insurance-agencies": {
    actor: "someone shopping a policy across two or three agencies",
    goal: "get a quote",
    conversion: "getting a quote",
    lens: "what someone shopping a policy goes through trying to get a quote out of you",
    searchTerm: "an insurance agent",
  },
  "financial-advisory-firms": {
    actor: "someone deciding who to trust with their money",
    goal: "book a first meeting",
    conversion: "booking a first meeting",
    lens: "what someone reads while they're deciding who to trust with their money",
    searchTerm: "a financial advisor",
  },
  "architecture-firms": {
    actor: "someone with a project they have been thinking about for a year",
    goal: "start a conversation",
    conversion: "the first project conversation",
    lens: "what someone planning a project sees while they're choosing a firm",
  },
  "engineering-consultancies": {
    actor: "someone scoping a project who needs to know if you take work like theirs",
    goal: "get a call scheduled",
    conversion: "the first scoping call",
    lens: "what someone scoping a project can and cannot tell about you from the outside",
  },
  "interior-design-firms": {
    actor: "someone planning a remodel",
    goal: "start a project conversation",
    conversion: "the first project conversation",
    lens: "what someone planning a remodel sees while they're choosing who to work with",
  },

  // ── Health and Wellness ──
  "dental-practices": {
    actor: "a new patient",
    goal: "book an appointment",
    conversion: "booking an appointment",
    lens: "what a new patient goes through from finding your office online to actually getting an appointment booked",
    dropPoint: "before they ever call to book",
    searchTerm: "a dentist",
  },
  orthodontists: {
    actor: "a parent looking into braces for their kid",
    goal: "book a consult",
    conversion: "booking a consult",
    lens: "what a parent looking into braces goes through before they book a consult",
    searchTerm: "an orthodontist",
  },
  "physical-therapy-practices": {
    actor: "someone who just walked out with a referral",
    goal: "book their first visit",
    conversion: "booking a first visit",
    lens: "what someone with a fresh referral goes through trying to book their first visit",
    searchTerm: "a physical therapist",
  },
  "veterinary-clinics": {
    actor: "someone whose dog or cat needs to be seen",
    goal: "get their pet in",
    conversion: "getting the appointment made",
    lens: "what a worried pet owner goes through trying to get seen this week",
    searchTerm: "a vet",
    audience: "clients",
    trade: "clinic",
  },
  "chiropractic-practices": {
    actor: "someone in pain who wants to be seen this week",
    goal: "get in this week",
    conversion: "getting in the door",
    lens: "what someone in pain goes through trying to get in this week",
    searchTerm: "a chiropractor",
  },
  "wellness-clinics": {
    actor: "someone deciding where to book a treatment",
    goal: "book a treatment",
    conversion: "booking a treatment",
    lens: "what someone goes through deciding where to book and actually booking it",
  },
  "med-spas": {
    actor: "someone comparing two or three places before they book",
    goal: "book a treatment",
    conversion: "booking a treatment",
    lens: "what someone comparing a few places sees before they pick one",
  },
  "fitness-studios": {
    actor: "someone deciding where to work out",
    goal: "book a first class",
    conversion: "booking a first class",
    lens: "what someone deciding where to work out sees, right up to booking a first class",
    searchTerm: "a gym",
  },
  "personal-training-studios": {
    actor: "someone ready to start training but unsure who with",
    goal: "book a first session",
    conversion: "booking a first session",
    lens: "what someone ready to start sees while they're deciding who to train with",
  },
  salons: {
    actor: "someone trying to get on your schedule",
    goal: "book an appointment",
    conversion: "booking",
    lens: "what someone goes through trying to book an appointment with you",
    searchTerm: "a salon",
  },
  barbershops: {
    actor: "someone trying to get a chair",
    goal: "book a cut",
    conversion: "booking",
    lens: "what someone goes through trying to book a cut with you",
    searchTerm: "a barber",
  },
  "massage-studios": {
    actor: "someone trying to book a session",
    goal: "book a session",
    conversion: "booking",
    lens: "what someone goes through trying to book a session",
  },

  // ── Home and Property Services ──
  "hvac-companies": {
    actor: "a homeowner whose air conditioning just quit",
    goal: "get someone out",
    conversion: "booking the visit",
    lens: "what a homeowner goes through when they need someone out fast and are choosing between a few companies",
    dropPoint: "before they call the first company that answers",
    searchTerm: "an HVAC company",
  },
  "plumbing-companies": {
    actor: "a homeowner with water somewhere it should not be",
    goal: "get someone out today",
    conversion: "booking the visit",
    lens: "what a homeowner goes through when something is leaking and they are picking a plumber fast",
    dropPoint: "before they call the next name on the list",
    searchTerm: "a plumber",
  },
  "electrical-contractors": {
    actor: "a homeowner who needs an electrician they can trust",
    goal: "get someone scheduled",
    conversion: "booking the visit",
    lens: "what a homeowner sees while they're deciding which electrician to let in the house",
    searchTerm: "an electrician",
  },
  "roofing-companies": {
    actor: "a homeowner trying to choose a roofer",
    goal: "get an estimate",
    conversion: "getting the estimate booked",
    lens: "what a homeowner experiences when they're trying to choose a contractor and get an estimate",
    dropPoint: "before they ever request a quote",
    searchTerm: "a roofer",
  },
  "landscaping-companies": {
    actor: "a homeowner getting a couple of bids on their yard",
    goal: "get a bid",
    conversion: "getting the bid booked",
    lens: "what a homeowner getting bids sees before they choose who to have out",
  },
  "cleaning-companies": {
    actor: "someone trying to get a cleaning scheduled",
    goal: "get on the schedule",
    conversion: "booking the first clean",
    lens: "what someone goes through trying to get a price and get on your schedule",
  },
  "pest-control-companies": {
    actor: "someone who wants this dealt with today",
    goal: "get someone out",
    conversion: "booking the visit",
    lens: "what someone who wants it handled today goes through trying to reach you",
  },
  "general-contractors": {
    actor: "someone planning a build or a remodel",
    goal: "book a walk-through",
    conversion: "the first walk-through",
    lens: "what someone planning a build sees while they're deciding which contractor to call",
  },
  "restoration-companies": {
    actor: "someone standing in damage right now",
    goal: "get help immediately",
    conversion: "getting a crew out",
    lens: "what someone in an emergency goes through trying to reach you at the worst moment of their week",
    dropPoint: "in the first two minutes",
  },
  "property-management-companies": {
    actor: "an owner deciding who should manage their property",
    goal: "start a conversation",
    conversion: "the first conversation",
    lens: "what an owner sees while they're deciding who to hand their property to",
  },
  "pool-service-companies": {
    actor: "a homeowner looking for regular service",
    goal: "get scheduled",
    conversion: "getting scheduled",
    lens: "what a homeowner goes through trying to get a price and get on a route",
  },
  "home-services": {
    actor: "a homeowner choosing between a few contractors",
    goal: "get a quote",
    conversion: "getting the quote booked",
    lens: "what a homeowner experiences when they're trying to choose a contractor",
    dropPoint: "before they ever request a quote",
  },

  // ── Hospitality and Experiences ──
  "boutique-hotels": {
    actor: "someone trying to book a room",
    goal: "book a room",
    conversion: "finishing a booking",
    lens: "what someone trying to book a room actually goes through",
    dropPoint: "before they ever finish a booking",
    audience: "guests",
    trade: "property",
    searchTerm: "a place to stay",
  },
  "event-venues": {
    actor: "someone planning an event",
    goal: "check their date",
    conversion: "getting a date held",
    lens: "what someone planning an event goes through trying to check a date and get a price",
    audience: "guests",
  },
  "catering-companies": {
    actor: "someone planning an event who needs a number fast",
    goal: "get a quote",
    conversion: "getting a quote",
    lens: "what someone planning an event goes through trying to get a quote out of you",
    audience: "guests",
  },
  "wedding-services": {
    actor: "a couple planning their wedding",
    goal: "check availability and get a price",
    conversion: "getting a date held",
    lens: "what a couple planning a wedding goes through while they are shortlisting who to contact",
    audience: "guests",
  },
  "private-clubs": {
    actor: "someone quietly considering membership",
    goal: "ask about membership",
    conversion: "the first membership conversation",
    lens: "what someone considering membership can find out before they're willing to ask",
    audience: "members",
  },
  "multi-location-restaurants": {
    actor: "someone deciding where to eat tonight",
    goal: "come in or order",
    conversion: "choosing you",
    lens: "what someone sees while they're deciding where to eat",
    dropPoint: "in the thirty seconds they spend deciding",
    audience: "guests",
    trade: "restaurant",
    searchTerm: "somewhere to eat",
  },

  // ── Specialty Retail and Local Commerce ──
  "specialty-retailers": {
    actor: "someone deciding whether it's worth the trip",
    goal: "decide to come in",
    conversion: "getting them through the door",
    lens: "what someone sees while they're deciding whether it's worth coming in",
  },
  "furniture-stores": {
    actor: "someone furnishing a room and comparing showrooms",
    goal: "pick a showroom",
    conversion: "getting them into the showroom",
    lens: "what someone comparing showrooms sees before they choose which one to drive to",
  },
  "jewelry-stores": {
    actor: "someone shopping for something they will only buy once",
    goal: "decide to come in",
    conversion: "getting them through the door",
    lens: "what someone shopping for something significant sees before they trust you enough to come in",
  },
  "home-design-showrooms": {
    actor: "someone planning a project and looking for a showroom",
    goal: "book a visit",
    conversion: "booking a visit",
    lens: "what someone planning a project sees while they're choosing a showroom",
  },
  "premium-apparel-stores": {
    actor: "someone deciding whether this is their kind of store",
    goal: "decide to come in",
    conversion: "getting them through the door",
    lens: "what someone sees while they're deciding whether this is their kind of store",
  },
  "specialty-food-businesses": {
    actor: "someone deciding where to pick something up",
    goal: "come in or order",
    conversion: "the order",
    lens: "what someone sees while they're deciding where to order from",
    audience: "guests",
  },

  // ── Automotive Services ──
  "auto-detailing-companies": {
    actor: "someone trying to get their car booked in",
    goal: "book it in",
    conversion: "booking",
    lens: "what someone goes through trying to get a price and get their car booked in",
  },
  "specialty-auto-repair-shops": {
    actor: "someone whose car needs work and who wants a price",
    goal: "get a price",
    conversion: "booking the work",
    lens: "what someone with a car problem goes through trying to get a straight answer out of a shop",
    searchTerm: "a mechanic",
  },
  "collision-centers": {
    actor: "someone whose car just got hit",
    goal: "get an estimate",
    conversion: "getting the estimate booked",
    lens: "what someone dealing with an accident and an insurer goes through trying to get an estimate",
  },
  "tire-and-service-centers": {
    actor: "someone who needs tires today",
    goal: "get a price",
    conversion: "getting them in the bay",
    lens: "what someone who needs tires today can find out before they drive over",
  },
  "vehicle-wrap-businesses": {
    actor: "a business owner pricing out a wrap",
    goal: "get a quote",
    conversion: "getting a quote",
    lens: "what a business owner pricing a wrap sees before they ask anyone for a number",
  },

  // ── Education and Training ──
  "tutoring-companies": {
    actor: "a parent looking for help for their kid",
    goal: "book a first session",
    conversion: "booking the first session",
    lens: "what a parent goes through from looking for help to actually getting a first session booked",
  },
  "music-schools": {
    actor: "a parent signing a kid up for lessons",
    goal: "get lessons started",
    conversion: "signing up",
    lens: "what a parent goes through trying to get a kid signed up for lessons",
  },
  "language-schools": {
    actor: "someone deciding which program to enroll in",
    goal: "enroll",
    conversion: "enrolling",
    lens: "what someone comparing programs sees before they enroll",
  },
  "vocational-training": {
    actor: "someone deciding whether this is worth enrolling in",
    goal: "enroll",
    conversion: "enrolling",
    lens: "what someone weighing a career change can find out before they enroll",
  },
  "private-learning-centers": {
    actor: "a parent comparing a few options",
    goal: "book an assessment",
    conversion: "booking an assessment",
    lens: "what a parent comparing options sees before they book an assessment",
  },

  // ── Growth-Stage ──
  "membership-businesses": {
    actor: "someone deciding whether to join",
    goal: "join",
    conversion: "signing up",
    lens: "what someone sees while they're deciding whether to join",
    audience: "members",
  },
};

/**
 * When the category is unknown, the industry words themselves usually say what
 * the business is. This is what saves a lead whose industry is "Motel" rather
 * than the taxonomy's "Boutique hotels".
 */
const JOURNEY_BY_WORDS: Array<[RegExp, string]> = [
  [/motel|hotel|inn\b|lodge|resort|hostel|bed and breakfast|b&b/i, "boutique-hotels"],
  [/restaurant|cafe|café|bistro|diner|eatery|pizzeria|taqueria|bakery|coffee|bar\b|brewery|food truck/i, "multi-location-restaurants"],
  [/dental|dentist|orthodont/i, "dental-practices"],
  [/chiropract/i, "chiropractic-practices"],
  [/physical therap|physiother|rehab/i, "physical-therapy-practices"],
  [/veterinar|animal hospital|\bvet\b|\bpet\b/i, "veterinary-clinics"],
  [/med ?spa|medspa|aesthetic|dermatolog|botox/i, "med-spas"],
  [/salon|hair|nail|beauty/i, "salons"],
  [/barber/i, "barbershops"],
  [/massage/i, "massage-studios"],
  [/gym|fitness|yoga|pilates|crossfit|cycling studio/i, "fitness-studios"],
  [/personal train/i, "personal-training-studios"],
  [/clinic|wellness|acupunctur|medical|doctor|physician|urgent care/i, "wellness-clinics"],
  [/law|attorney|legal|counsel/i, "law-firms"],
  [/account|cpa|bookkeep/i, "accounting-firms"],
  [/\btax\b/i, "tax-professionals"],
  [/insurance/i, "insurance-agencies"],
  [/financial|wealth|advisor/i, "financial-advisory-firms"],
  [/recruit|staffing|talent/i, "recruiting-and-staffing-firms"],
  [/architect/i, "architecture-firms"],
  [/engineer/i, "engineering-consultancies"],
  [/interior design/i, "interior-design-firms"],
  [/coach/i, "business-coaches"],
  [/consult/i, "business-consultants"],
  [/hvac|heating|air condition|furnace/i, "hvac-companies"],
  [/plumb/i, "plumbing-companies"],
  [/electric/i, "electrical-contractors"],
  [/roof/i, "roofing-companies"],
  [/landscap|lawn|garden|tree service/i, "landscaping-companies"],
  [/clean|janitor|maid/i, "cleaning-companies"],
  [/pest|exterminat/i, "pest-control-companies"],
  [/restoration|water damage|fire damage|mold/i, "restoration-companies"],
  [/contractor|construction|remodel|builder/i, "general-contractors"],
  [/property manage|realty|real estate/i, "property-management-companies"],
  [/pool/i, "pool-service-companies"],
  [/venue|event space|banquet/i, "event-venues"],
  [/cater/i, "catering-companies"],
  [/wedding|bridal/i, "wedding-services"],
  [/\bclub\b/i, "private-clubs"],
  [/detail/i, "auto-detailing-companies"],
  [/collision|body shop|auto body/i, "collision-centers"],
  [/tire/i, "tire-and-service-centers"],
  [/wrap/i, "vehicle-wrap-businesses"],
  [/auto|car repair|mechanic|automotive|transmission/i, "specialty-auto-repair-shops"],
  [/tutor/i, "tutoring-companies"],
  [/music school|music lesson/i, "music-schools"],
  [/language school|esl\b/i, "language-schools"],
  [/training|vocational|academy/i, "vocational-training"],
  [/jewel/i, "jewelry-stores"],
  [/furniture/i, "furniture-stores"],
  [/apparel|clothing|boutique/i, "premium-apparel-stores"],
  [/showroom/i, "home-design-showrooms"],
  [/retail|store|shop/i, "specialty-retailers"],
  [/membership/i, "membership-businesses"],
];

/** Fallbacks by portfolio group — still specific enough to be worth saying. */
const JOURNEY_BY_GROUP: Record<string, J> = {
  "Professional Services": {
    actor: "someone deciding which firm to call",
    goal: "get in touch",
    conversion: "the first conversation",
    lens: "what someone sees while they're deciding which firm to call",
  },
  "Health and Wellness": {
    actor: "a new patient",
    goal: "book an appointment",
    conversion: "booking an appointment",
    lens: "what a new patient goes through from finding you online to getting an appointment booked",
  },
  "Home and Property Services": {
    actor: "a homeowner choosing between a few companies",
    goal: "get a quote",
    conversion: "getting the quote booked",
    lens: "what a homeowner experiences when they're trying to choose a contractor",
  },
  "Hospitality and Experiences": {
    actor: "someone planning something and deciding where to book",
    goal: "book",
    conversion: "finishing a booking",
    lens: "what someone goes through deciding where to book and actually booking it",
    audience: "guests",
  },
  "Specialty Retail and Local Commerce": {
    actor: "someone deciding whether it's worth the trip",
    goal: "decide to come in",
    conversion: "getting them through the door",
    lens: "what someone sees while they're deciding whether to come in",
  },
  "Automotive Services": {
    actor: "someone whose car needs work",
    goal: "get a price and get it booked",
    conversion: "booking the work",
    lens: "what someone with a car problem goes through trying to get a price and get it booked",
  },
  "Education and Training": {
    actor: "a parent or student comparing a few options",
    goal: "get started",
    conversion: "signing up",
    lens: "what someone comparing options sees before they sign up",
  },
  "Growth-Stage Businesses": {
    actor: "someone deciding whether to work with you",
    goal: "take the first step",
    conversion: "that first step",
    lens: "what someone sees while they're deciding whether to work with you",
  },
};

const GENERIC: J = {
  actor: "someone deciding whether to call you",
  goal: "get in touch",
  conversion: "getting in touch",
  lens: "what someone actually runs into when they try to reach you",
};

/**
 * The search someone would actually type. When a journey doesn't name its own,
 * the industry word is still the truest thing we can say — "when someone
 * searches for an auto body shop" beats "for a business like yours", which is
 * the sentence that gives away a mail merge. The honest generic is reserved for
 * leads whose industry we genuinely don't know.
 */
function searchTermFor(industry: string): string {
  const i = industry.trim().toLowerCase().replace(/\s*\(.*?\)\s*$/, "").trim();
  if (!i) return "a business like yours";
  return `${/^[aeiou]/.test(i) ? "an" : "a"} ${i}`;
}

function fill(j: J, industry: string, source: CustomerJourney["source"]): CustomerJourney {
  return {
    actor: j.actor,
    goal: j.goal,
    conversion: j.conversion ?? "getting in touch",
    lens: j.lens,
    dropPoint: j.dropPoint ?? "before they ever reach out",
    audience: j.audience ?? audienceNoun(industry),
    trade: j.trade ?? tradeNoun(industry),
    searchTerm: j.searchTerm ?? searchTermFor(industry),
    source,
  };
}

/**
 * Step 1 — what this business is, and where its customer decides.
 * Resolution order: the explicit category → the words in the industry string →
 * the portfolio group → a generic-but-honest journey.
 */
export function understandJourney(input: { industry?: string | null; normalizedCategory?: string | null; categoryGroup?: string | null }): CustomerJourney {
  const industry = (input.industry ?? "").trim();
  const cat = (input.normalizedCategory ?? "").trim() || (industry ? categoryMetaForIndustry(industry).normalizedCategory : "");

  const direct = JOURNEY_BY_CATEGORY[cat] ?? JOURNEY_BY_CATEGORY[slug(industry)];
  if (direct) return fill(direct, industry, "category");

  // The taxonomy missed. The words usually still say what the business is —
  // "Motel" is not in the portfolio, but everybody knows what a motel does.
  for (const [re, key] of JOURNEY_BY_WORDS) {
    if (re.test(industry)) return fill(JOURNEY_BY_CATEGORY[key], industry, "industry-words");
  }

  const group = (input.categoryGroup ?? "").trim() || (industry ? categoryMetaForIndustry(industry).group : "");
  if (group && JOURNEY_BY_GROUP[group]) return fill(JOURNEY_BY_GROUP[group], industry, "group");

  return fill(GENERIC, industry, "generic");
}

// ── 2 · What the analysis actually found ─────────────────────────────────────

/** The customer-visible moment a finding belongs to. Not an analyst category. */
export type CustomerMoment =
  | "booking"
  | "getting-in-touch"
  | "being-found"
  | "first-impression"
  | "on-a-phone"
  | "waiting-for-a-reply"
  | "what-people-say"
  | "no-website"
  | "unknown";

export interface FindingRead {
  moment: CustomerMoment;
  /** The plain-English thing we say we noticed. Shaped by the journey. */
  noticed: string;
  /** Why the person holding the phone should care — one clause, no jargon. */
  matters: string;
  /** False when we have nothing customer-visible. Then we claim nothing. */
  grounded: boolean;
  /** The analyst text behind it. PRIVATE — for the operator, never spoken. */
  evidence: string | null;
}

/** Analyst friction domains → the moment a customer would recognize. */
const MOMENT_BY_DOMAIN: Partial<Record<FrictionDomain, CustomerMoment>> = {
  Scheduling: "booking",
  "Customer Journey": "booking",
  "Customer Acquisition": "being-found",
  "Customer Communication": "waiting-for-a-reply",
  "Customer Experience": "first-impression",
  "Sales Process": "getting-in-touch",
  "Information Visibility": "first-impression",
};

/** Words in the raw finding that name the moment more precisely than the domain. */
const MOMENT_BY_WORDS: Array<[RegExp, CustomerMoment]> = [
  [/mobile|phone screen|small screen|responsive/i, "on-a-phone"],
  [/review|rating|reputation|star/i, "what-people-say"],
  [/book|schedul|appointment|reservation|intake|calendar/i, "booking"],
  [/contact|inquir|form|call|reach|phone number/i, "getting-in-touch"],
  [/search|seo|visib|found|discover|listing|maps/i, "being-found"],
  [/speed|slow|load|performance/i, "first-impression"],
  [/follow.?up|response|reply|respond/i, "waiting-for-a-reply"],
  [/trust|credib|outdated|dated|design|photo|brand/i, "first-impression"],
];

/**
 * Step 2 — read the analysis, then say it the way a person would.
 *
 * The engine's own words ("Customer Journey (highest leverage)") are never
 * spoken. They are classified, and then we write the sentence ourselves against
 * this business's journey — so the same finding sounds different, and correct,
 * for a motel and for a roofer.
 */
export function readFinding(
  input: { observations?: string[]; findingCategory?: string | null; hasWebsite: boolean; hasInstagram?: boolean; city?: string | null },
  journey: CustomerJourney,
): FindingRead {
  const raw = (input.observations ?? []).map((o) => (o ?? "").trim()).filter(Boolean);

  // Nothing to send them to is the most concrete, most safely observed thing we
  // can ever have. It outranks whatever the analysis ranked first.
  if (!input.hasWebsite) {
    return {
      moment: "no-website",
      // Say what is actually carrying the weight. Telling a business that runs
      // on Instagram it "all rides on your Google listing" is the kind of wrong
      // that ends the call — they know their own business better than we do.
      noticed: input.hasInstagram
        ? `there's no website to send them to — it all rides on your Instagram and your Google listing`
        : `there's no website to send them to — it all rides on your Google listing`,
      matters: `that's a lot of weight on one page you don't control`,
      grounded: true,
      evidence: raw[0] ?? null,
    };
  }

  const first = raw[0] ?? "";
  const hay = [first, input.findingCategory ?? ""].join(" ").trim();

  // No analysis means no claim. (The taxonomy's classifier defaults to a
  // sensible domain when it sees nothing — sensible for a report, dishonest on
  // a phone call, where it would have us assert a problem we never observed.)
  if (!hay) return { moment: "unknown", noticed: "", matters: "", grounded: false, evidence: null };

  let moment: CustomerMoment = "unknown";
  for (const [re, m] of MOMENT_BY_WORDS) {
    if (re.test(hay)) { moment = m; break; }
  }
  if (moment === "unknown") {
    for (const domain of classify(first, input.findingCategory ?? undefined)) {
      const m = MOMENT_BY_DOMAIN[domain];
      if (m) { moment = m; break; }
    }
  }

  // We have an analysis, but nothing in it is something a customer would ever
  // see. Saying "I noticed something" about internal workflow is exactly the
  // vague opener that gets a call hung up on. Claim nothing; offer the walk.
  if (moment === "unknown") {
    return {
      moment: "unknown",
      noticed: "",
      matters: "",
      grounded: false,
      evidence: first || null,
    };
  }

  // "no-website" returned above; "unknown" returned just now. What is left is a
  // moment we have words for.
  const said = SAY_MOMENT[moment as keyof typeof SAY_MOMENT](journey, (input.city ?? "").trim());
  return { moment, noticed: said.noticed, matters: said.matters, grounded: true, evidence: first || null };
}

// Short, spoken, and written so the sentence around them never has to repeat
// itself — the frame already said who we looked at, so these only say what.
type Said = { noticed: string; matters: string };
const SAY_MOMENT: Record<Exclude<CustomerMoment, "unknown" | "no-website">, (j: CustomerJourney, city: string) => Said> = {
  booking: (j) => ({
    // Named by the conversion, not the goal. The frame already said the goal
    // ("...the way someone trying to book a room would") and repeating it
    // verbatim is exactly how a script starts sounding like one — but dropping
    // it entirely made a motel and a dentist say the same sentence, which is
    // the failure this whole module exists to prevent.
    noticed: `there are a couple of spots where someone could give up before ${j.conversion}`,
    matters: `those are people who'd already decided on you`,
  }),
  "getting-in-touch": () => ({
    noticed: `it takes more steps than it should to get to a person`,
    matters: `most people won't take the extra steps — they call the next name`,
  }),
  "being-found": (j, city) => ({
    noticed: `${city ? `in ${city}, ` : ""}you're hard to find when someone searches for ${j.searchTerm}`,
    matters: `they never get as far as your name`,
  }),
  "first-impression": (j) => ({
    noticed: `what they see first doesn't match how good the ${j.trade} actually is`,
    matters: `people decide in a few seconds, and that's what they decide on`,
  }),
  "on-a-phone": (j) => ({
    noticed: `it gets a lot harder to use on a phone, and that's where most of your ${j.audience} are`,
    matters: `that's most of them, not a slice`,
  }),
  "waiting-for-a-reply": () => ({
    noticed: `there's no quick way to get an answer once they reach out`,
    matters: `whoever answers first usually gets the job`,
  }),
  "what-people-say": () => ({
    // The deliverable already names both sides of the comparison; this only has
    // to say which one wins.
    noticed: `the first thing people find is a worse version of you`,
    matters: `you're being judged on the weaker version`,
  }),
};

// ── 3 · The deliverable, named like a real object ────────────────────────────

/**
 * Step 3 — what physically exists to send. "A review" sounds like a Google
 * review or a sales audit. These sound like a thing somebody made.
 */
export function deliverableFor(moment: CustomerMoment, journey: CustomerJourney): string {
  switch (moment) {
    case "booking":
      return `a one-page walkthrough with a screenshot of every step`;
    case "getting-in-touch":
      return `a one-page breakdown of every step it takes to reach you`;
    case "being-found":
      return `a side-by-side of what actually comes up in that search`;
    case "first-impression":
      return `a one-page breakdown of what they see in the first few seconds`;
    case "on-a-phone":
      // "screenshots" is the point; saying "on my phone" here would be the
      // third phone in three sentences.
      return `a few screenshots I took while trying it myself`;
    case "waiting-for-a-reply":
      return `a one-page breakdown of what happens after someone reaches out`;
    case "what-people-say":
      return `a side-by-side of what comes up versus what your ${journey.audience} actually say`;
    case "no-website":
      return `a one-page breakdown of everything someone finds when they look you up`;
    case "unknown":
      return `a one-page walkthrough, start to finish`;
  }
}

// ── 4 · Who is holding the phone ─────────────────────────────────────────────

export type Answerer = "front-desk" | "reception" | "office-admin" | "owner-likely" | "mid-shift";
export type BusinessSize = "solo" | "small" | "established" | "multi-location";

export function sizeOf(input: { reviewCount?: number | null; locationsCount?: number | null }): BusinessSize {
  if ((input.locationsCount ?? 1) > 1) return "multi-location";
  const r = input.reviewCount ?? 0;
  if (r >= 150) return "established";
  if (r >= 30) return "small";
  return "solo";
}

/**
 * Step 4 — who realistically answers, because that decides the tone and the
 * length. A ten-review roofer is the owner in a truck. A hotel is a front desk
 * with a guest waiting. Those are not the same call.
 */
export function whoAnswers(journey: CustomerJourney, size: BusinessSize, group: string): Answerer {
  if (size === "solo" && (group === "Home and Property Services" || group === "Automotive Services")) return "owner-likely";
  if (journey.audience === "patients") return "front-desk";
  if (journey.trade === "property" || journey.trade === "restaurant") return "mid-shift";
  if (group === "Hospitality and Experiences" || group === "Specialty Retail and Local Commerce") return "mid-shift";
  if (group === "Professional Services") return "reception";
  if (size === "solo") return "owner-likely";
  return "office-admin";
}

// ── 5 · Understanding, then words ────────────────────────────────────────────

export interface OpeningInput {
  businessName: string;
  industry?: string | null;
  normalizedCategory?: string | null;
  categoryGroup?: string | null;
  city?: string | null;
  hasWebsite: boolean;
  /** Changes what we say is carrying the business when there's no website. */
  hasInstagram?: boolean;
  rating?: number | null;
  reviewCount?: number | null;
  locationsCount?: number | null;
  /** What the analysis found, strongest first. Analyst language is expected. */
  observations?: string[];
  /** The opportunity category from the intelligence engine, if we have one. */
  findingCategory?: string | null;
}

export interface LeadUnderstanding {
  businessName: string;
  journey: CustomerJourney;
  finding: FindingRead;
  deliverable: string;
  answerer: Answerer;
  size: BusinessSize;
  /** Strong public reputation is worth acknowledging — it is true and it lands. */
  wellReviewed: boolean;
}

/** Everything reasoned, before a single word is written. */
export function understandLead(input: OpeningInput): LeadUnderstanding {
  const journey = understandJourney(input);
  const finding = readFinding(input, journey);
  const size = sizeOf(input);
  const group = (input.categoryGroup ?? "").trim() || (input.industry ? categoryMetaForIndustry(input.industry).group : "");
  return {
    businessName: input.businessName,
    journey,
    finding,
    deliverable: deliverableFor(finding.moment, journey),
    answerer: whoAnswers(journey, size, group),
    size,
    wellReviewed: (input.rating ?? 0) >= 4.5 && (input.reviewCount ?? 0) >= 40,
  };
}

/**
 * The words. Every line is derived from the understanding above, so all of them
 * change together when the business changes — there is no line in the call that
 * is the same for a motel and a law firm except the name.
 */
export interface CallOpening {
  /** The cold opening — the first thing said when someone picks up. */
  say: string;
  /**
   * Whose point of view we took — "someone trying to book a room", "a new
   * patient". This is the clause the whole call hangs on: it says what we
   * looked at without ever using a word like "analysis" or "review".
   */
  lookedAt: string;
  /** The tangible thing we made. */
  deliverable: string;
  /** The plain-English thing we noticed, or "" when we noticed nothing safe. */
  noticed: string;
  /** The one ask. */
  ask: string;
  /** True when a real, customer-visible observation backs the opening. */
  grounded: boolean;
  /** Private evidence the operator can read if pressed. Never spoken as-is. */
  evidence: string | null;
  /** Why the engine said it this way — shown to the operator, and testable. */
  because: string[];
  /** The reasoning the words came from, for surfaces that need to say more. */
  journey: CustomerJourney;
  /** The same understanding, said differently for each turn of the call. */
  lines: {
    reception: string;
    decisionMaker: string;
    transferred: string;
    whatIsThis: string;
    voicemail: string;
    gatekept: string;
  };
}

const CAP = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function composeOpening(u: LeadUnderstanding): CallOpening {
  const { journey: j, finding: f } = u;
  const name = u.businessName;
  // The one clause the call is built on. It names a person, not a discipline —
  // "the way a new patient would", never "an analysis of your patient journey".
  const lookedAt = j.actor;
  const frame = `I went through ${name} the way ${j.actor} would`;
  const ask = "What's the best email for that?";

  // The claim. When nothing customer-visible was observed there is no claim at
  // all — an honest offer beats a vague one ("I noticed some things" is the
  // sentence that gets you hung up on). Said as its own sentence, once: the
  // frame already established who we watched, so it only has to say what.
  const claim = f.grounded ? `${CAP(f.noticed)}.` : "";
  const honest = f.grounded ? "" : "It's just what I could see from the outside.";
  // True, specific, checkable in two seconds. The fastest way to prove somebody
  // actually looked — and only ever said when it is earned.
  const praise = u.wellReviewed ? `Your ${j.audience} clearly rate you — that's what got my attention.` : "";

  // Length and framing follow who is actually holding the phone.
  const say = (() => {
    switch (u.answerer) {
      case "mid-shift":
        // Someone is standing at the desk or waiting at a table. This person
        // will not hear a fourth sentence, so the observation is deliberately
        // held back for whoever we get transferred to.
        return `Hi — I know it's busy, so thirty seconds, and I'm not selling anything. ${frame}, and made ${u.deliverable}. ${honest} Can I email it over?`;
      case "owner-likely":
        // Probably the person who owns it, probably holding something else.
        return `Hi — quick call, and I'm not selling anything. ${frame}, and put together ${u.deliverable}. ${claim || honest} Can I email it to you? What's the best address?`;
      case "front-desk":
        return `Hi — I'm Jordan, I'll be quick and I'm not selling anything. ${frame}, and put together ${u.deliverable}. ${claim || honest} I'd just like to send it over — what's the best email?`;
      case "reception":
        return `Hi — my name's Jordan, I'll be quick and I'm not selling anything. ${frame}, and put together ${u.deliverable}. ${claim || honest} What's the best email to send it to?`;
      case "office-admin":
        return `Hi — I'm Jordan, I'll keep this short and it's not a sales call. ${frame}, and put together ${u.deliverable}. ${claim || honest} Can I send it over? What's the best address?`;
    }
  })();

  const because = [
    `${name} reads as ${j.source === "category" || j.source === "industry-words" ? "a specific kind of business" : "an unclassified business"}, so the call is framed around ${j.actor}.`,
    f.grounded
      ? `The analysis pointed at ${f.moment.replace(/-/g, " ")}, so that is what we lead with.`
      : `Nothing customer-visible was observed, so the opening claims nothing and offers the walkthrough instead.`,
    u.answerer === "mid-shift"
      ? `Whoever answers is mid-shift at ${/^[aeiou]/.test(u.size) ? "an" : "a"} ${u.size.replace(/-/g, " ")} business, so the opening is three sentences and holds the observation back for the transfer.`
      : `Whoever answers is most likely ${u.answerer.replace(/-/g, " ")} at ${/^[aeiou]/.test(u.size) ? "an" : "a"} ${u.size.replace(/-/g, " ")} business, so the opening stays under a minute.`,
  ];

  return {
    say: tidy(say),
    lookedAt,
    deliverable: u.deliverable,
    noticed: f.noticed,
    ask,
    grounded: f.grounded,
    evidence: f.evidence,
    because,
    journey: j,
    lines: {
      // Reception can hand over the address. Give them the two easy outs.
      reception: tidy(
        `Hi — I'll be quick and I'm not selling anything. I made ${u.deliverable} for ${name} — I went through it the way ${j.actor} would. ${claim} Is there a good email I could send it to, or someone who'd want to see it?`,
      ),
      // The decision-maker gets the observation first — it is why they stay on.
      decisionMaker: tidy(
        f.grounded
          ? `Hi — I'll keep this short. ${praise} ${frame}, and ${f.noticed}. ${CAP(f.matters)}. I could be wrong from the outside, so I put together ${u.deliverable} — you can judge it yourself. Can I send it over? ${ask}`
          : `Hi — I'll keep this short. ${frame}, and put together ${u.deliverable}. It's only what I could see from the outside, so some of it may be off — you'd know better than me. Can I send it over? ${ask}`,
      ),
      // Never run the cold opening twice.
      transferred: tidy(
        // "from someone who just realized they need a lawyer's point of view" is
        // what a possessive does to a long actor. Say it the way a person would.
        `Thanks for taking the call — I know you just got handed this, so I'll be quick. I made ${u.deliverable} for ${name}, from the point of view of ${lookedAt}. ${claim} I'd like to send it to you directly. ${ask}`,
      ),
      // The honest, complete answer to "what is this about". The only line that
      // spends words on the full lens — here it is asked for.
      whatIsThis: tidy(
        `Of course — I run a small studio in LA. I looked at ${j.lens}, and made ${u.deliverable}. ${claim} No cost, nothing to sign. Can I email it over?`,
      ),
      voicemail: tidy(
        `Hi, this is Jordan — ${frame}, and put together ${u.deliverable}. ${claim} There's no cost and nothing to sign. If you'd like it, the easiest thing is to text this number an email address and I'll send it over. Thanks very much.`,
      ),
      // They want it sent to the general inbox. Take it — and make sure it lands.
      gatekept: tidy(
        `That works — is it alright if I send it there? It's ${u.deliverable}, one page, no cost. Who should I put in the subject line so it gets to the right desk?`,
      ),
    },
  };
}

/** One call: understand the business, then say something true about it. */
export function buildCallOpening(input: OpeningInput): CallOpening {
  return composeOpening(understandLead(input));
}

/** The shape every surface already has on hand — a lead row, more or less. */
export interface OpeningLead {
  businessName: string;
  industry?: string | null;
  normalizedCategory?: string | null;
  categoryGroup?: string | null;
  city?: string | null;
  website?: string | null;
  socialLinks?: string[];
  rating?: number | null;
  reviewCount?: number | null;
  locationsCount?: number | null;
}

/**
 * The single entry point every surface uses, so the words on the lead page, in
 * the call workspace, and in the conversation assistant cannot drift apart.
 */
export function openingForLead(
  lead: OpeningLead,
  opts: { observations?: (string | null | undefined)[]; findingCategory?: string | null } = {},
): CallOpening {
  return buildCallOpening({
    businessName: lead.businessName,
    industry: lead.industry,
    normalizedCategory: lead.normalizedCategory,
    categoryGroup: lead.categoryGroup,
    city: lead.city,
    hasWebsite: !!(lead.website ?? "").trim(),
    hasInstagram: (lead.socialLinks ?? []).some((s) => /instagram\.com/i.test(s ?? "")),
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    locationsCount: lead.locationsCount,
    observations: (opts.observations ?? []).map((o) => (o ?? "").trim()).filter(Boolean),
    findingCategory: opts.findingCategory,
  });
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
/** Collapse the gaps left by an empty clause so nothing reads like a template. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s+([.,?])/g, "$1").trim();
}

// ── The guardrail ────────────────────────────────────────────────────────────

/**
 * Phrases that are either ambiguous to the person answering the phone or sound
 * like sales software wrote them. "Review" is first for a reason: to whoever
 * picks up, it means Google, Yelp, or a complaint — not the thing we made.
 *
 * This is enforced by test across a corpus of businesses, not by good intentions.
 */
export const FORBIDDEN_OPENING_PHRASES: string[] = [
  "short review",
  "quick review",
  "a review",
  "the review",
  "few observations",
  "some observations",
  "might be useful",
  "noticed some things",
  "quick analysis",
  "customer experience",
  "digital transformation",
  "workflow optimization",
  "business systems",
  "digital presence",
  "lead funnel",
  "online presence",
  "best practices",
  "leverage",
  "synergy",
  "solutions",
  "optimize",
  "streamline",
  "reach out to you today",
  "how are you today",
];

/** Every forbidden phrase present in a piece of spoken copy. Empty is the bar. */
export function findForbiddenPhrases(text: string): string[] {
  const hay = (text ?? "").toLowerCase();
  return FORBIDDEN_OPENING_PHRASES.filter((p) => hay.includes(p));
}

/** Every line this opening would ever have the operator say aloud. */
export function spokenLines(o: CallOpening): string[] {
  return [o.say, o.lines.reception, o.lines.decisionMaker, o.lines.transferred, o.lines.whatIsThis, o.lines.voicemail, o.lines.gatekept];
}

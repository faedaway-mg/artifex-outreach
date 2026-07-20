// ─────────────────────────────────────────────────────────────────────────────
// Digital Presence Detection.
//
// Before a single word of an opening conversation is written, the engine has to
// know what actually exists. A business is NOT a website with some social bolted
// on. Many of the best prospects have no website at all — a Facebook page doing
// all the work, a Google listing and a phone number, a Yelp profile carrying the
// reputation. The opening conversation is completely different for each of these,
// and the fastest way to sound like every other cold caller is to assume a
// website is there when it isn't.
//
// This module reads only what's observable (the Lead record + optional website
// signals) and produces an honest, structured picture of a business's real
// digital footprint. It NEVER assumes. If we can't see a website, there is no
// website in the conversation.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "./types";
import type { WebsiteSignals } from "./scoring";

/** The dominant channel situation — drives which opening conversation we build. */
export type PresenceProfile =
  | "website" // a real, owned website exists
  | "facebook-only" // Facebook page is the storefront; no website
  | "instagram-only" // Instagram is the storefront; no website
  | "google-only" // just a Google Business Profile + phone
  | "yelp-only" // Yelp profile carries the presence; no website
  | "social-only" // some social presence, no single clear platform, no website
  | "invisible"; // barely findable — a name, a phone, little else

export type ReviewStrength = "none" | "thin" | "solid" | "strong";

/** Named social/booking platforms we can recognize from a URL. */
export interface DetectedPlatform {
  name: string; // "Facebook", "Instagram", "Yelp", "Calendly"…
  kind: "social" | "booking" | "directory";
  url: string;
}

export interface DigitalPresence {
  hasWebsite: boolean;
  hasFacebook: boolean;
  hasInstagram: boolean;
  hasYelp: boolean;
  hasGoogleBusiness: boolean;
  /** Every recognizable platform, named. */
  platforms: DetectedPlatform[];
  /** Human list of social platform names, e.g. ["Facebook", "Instagram"]. */
  socialPlatforms: string[];

  multipleLocations: boolean;
  locationsCount: number;

  /** A scheduling/booking tool is embedded or linked (Calendly, Acuity, Booksy…). */
  hasOnlineBooking: boolean;
  /** A named appointment/scheduling tool if we could identify one. */
  appointmentTool: string | null;
  /** They take appointments/bookings as a core motion (inferred from tool or industry). */
  appointmentDriven: boolean;

  hasContactForm: boolean;
  hasPublicEmail: boolean;
  hasPhone: boolean;

  reviews: {
    count: number;
    rating: number;
    strength: ReviewStrength;
  };

  /** The dominant situation that shapes the whole opening. */
  profile: PresenceProfile;
  /** A plain-English name for their main channel — "a Facebook page", "a Google listing". */
  primaryChannel: string;
  /** Honest, hedged modernization openings — never asserted as broken. */
  modernizationOpportunities: string[];
}

// Known hosts, so we can tell a real website from a social page listed as one.
const SOCIAL_HOSTS: Array<{ re: RegExp; name: string; key: keyof Pick<DigitalPresence, "hasFacebook" | "hasInstagram" | "hasYelp"> | null }> = [
  { re: /facebook\.com|fb\.com|fb\.me/i, name: "Facebook", key: "hasFacebook" },
  { re: /instagram\.com|instagr\.am/i, name: "Instagram", key: "hasInstagram" },
  { re: /yelp\.com|yelp\.to/i, name: "Yelp", key: "hasYelp" },
  { re: /linkedin\.com/i, name: "LinkedIn", key: null },
  { re: /tiktok\.com/i, name: "TikTok", key: null },
  { re: /(twitter\.com|x\.com)/i, name: "X", key: null },
  { re: /youtube\.com|youtu\.be/i, name: "YouTube", key: null },
  { re: /nextdoor\.com/i, name: "Nextdoor", key: null },
];

// Booking / scheduling tools, matched from any URL we can see.
const BOOKING_TOOLS: Array<{ re: RegExp; name: string }> = [
  { re: /calendly\.com/i, name: "Calendly" },
  { re: /acuityscheduling|acuity/i, name: "Acuity" },
  { re: /squareup\.com\/appointments|square\s*appointments/i, name: "Square Appointments" },
  { re: /booksy\.com/i, name: "Booksy" },
  { re: /vagaro\.com/i, name: "Vagaro" },
  { re: /setmore\.com/i, name: "Setmore" },
  { re: /schedulicity\.com/i, name: "Schedulicity" },
  { re: /simplybook/i, name: "SimplyBook" },
  { re: /youcanbook\.me/i, name: "YouCanBook.me" },
  { re: /mindbody(online)?\.com/i, name: "Mindbody" },
  { re: /opentable\.com/i, name: "OpenTable" },
  { re: /resy\.com/i, name: "Resy" },
  { re: /tock\.com/i, name: "Tock" },
  { re: /housecallpro|jobber\.com|servicetitan/i, name: "a field-service scheduler" },
];

const REVIEW_HOSTS = /yelp\.com|google\.com\/maps|tripadvisor|healthgrades|zocdoc|avvo|angi\.com|angieslist/i;

/** Industries whose core customer motion is booking an appointment or reservation. */
const APPOINTMENT_INDUSTRIES = /dental|dentist|medical|clinic|salon|spa|barber|massage|chiro|derma|aesthet|physical therapy|tattoo|nail|lash|brow|optomet|veterinar|law|attorney|accountant|consult|restaurant|dining|hair|wax|grooming|hvac|plumb|electric|roof|landscap|auto repair|mechanic|photograph/i;

function isRealWebsite(url: string | null): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  if (!/^https?:\/\/|^www\.|\.[a-z]{2,}/.test(u)) return false;
  // A "website" that's really a social page doesn't count as an owned website.
  return !SOCIAL_HOSTS.some((h) => h.re.test(u)) && !/linktr\.ee|linktree/i.test(u);
}

function reviewStrength(count: number, rating: number): ReviewStrength {
  if (count <= 0) return "none";
  if (count < 15) return "thin";
  if (count >= 120 || (count >= 60 && rating >= 4.5)) return "strong";
  return "solid";
}

/**
 * Read the observable footprint into a structured, honest picture. Pure and
 * deterministic — no network, no assumptions beyond what's in the record.
 */
export function detectPresence(lead: Lead, signals?: WebsiteSignals): DigitalPresence {
  const links = Array.isArray(lead.socialLinks) ? lead.socialLinks.filter(Boolean) : [];
  const allUrls = [lead.website, lead.contactFormUrl, lead.googleMapsUrl, ...links].filter(Boolean) as string[];

  const hasWebsite = signals?.hasWebsite ?? isRealWebsite(lead.website);

  // Named platforms from every URL we can see.
  const platforms: DetectedPlatform[] = [];
  const seen = new Set<string>();
  const flags = { hasFacebook: false, hasInstagram: false, hasYelp: false };
  for (const url of [...links, lead.website].filter(Boolean) as string[]) {
    for (const h of SOCIAL_HOSTS) {
      if (h.re.test(url) && !seen.has(h.name)) {
        seen.add(h.name);
        platforms.push({ name: h.name, kind: h.name === "Yelp" || h.name === "Nextdoor" ? "directory" : "social", url });
        if (h.key) flags[h.key] = true;
      }
    }
  }

  // Booking tool from any visible URL, plus website signals.
  let appointmentTool: string | null = null;
  for (const url of allUrls) {
    const hit = BOOKING_TOOLS.find((t) => t.re.test(url));
    if (hit) {
      appointmentTool = hit.name;
      if (!seen.has(hit.name)) {
        seen.add(hit.name);
        platforms.push({ name: hit.name, kind: "booking", url });
      }
      break;
    }
  }
  const hasOnlineBooking = (signals?.hasOnlineBooking ?? false) || appointmentTool !== null;
  const appointmentDriven = hasOnlineBooking || APPOINTMENT_INDUSTRIES.test(lead.industry ?? "");

  const hasGoogleBusiness = Boolean(lead.googleMapsUrl);
  const locationsCount = Math.max(1, lead.locationsCount ?? 1);
  const multipleLocations = locationsCount > 1;

  const count = lead.reviewCount ?? 0;
  const rating = lead.rating ?? 0;
  const reviews = { count, rating, strength: reviewStrength(count, rating) };

  const socialPlatforms = platforms.filter((p) => p.kind === "social").map((p) => p.name);

  const profile = chooseProfile({ hasWebsite, flags, hasGoogleBusiness, socialPlatforms, links });
  const primaryChannel = describeChannel(profile, { appointmentTool, hasGoogleBusiness });
  const modernizationOpportunities = modernization({
    profile,
    hasWebsite,
    signals,
    reviews,
    multipleLocations,
    appointmentDriven,
    hasOnlineBooking,
  });

  return {
    hasWebsite,
    hasFacebook: flags.hasFacebook,
    hasInstagram: flags.hasInstagram,
    hasYelp: flags.hasYelp,
    hasGoogleBusiness,
    platforms,
    socialPlatforms,
    multipleLocations,
    locationsCount,
    hasOnlineBooking,
    appointmentTool,
    appointmentDriven,
    hasContactForm: Boolean(lead.contactFormUrl) || (signals?.hasLeadForm ?? false),
    hasPublicEmail: Boolean(lead.publicEmail),
    hasPhone: Boolean(lead.phone),
    reviews,
    profile,
    primaryChannel,
    modernizationOpportunities,
  };
}

function chooseProfile(x: {
  hasWebsite: boolean;
  flags: { hasFacebook: boolean; hasInstagram: boolean; hasYelp: boolean };
  hasGoogleBusiness: boolean;
  socialPlatforms: string[];
  links: string[];
}): PresenceProfile {
  if (x.hasWebsite) return "website";
  const { hasFacebook, hasInstagram, hasYelp } = x.flags;

  // No website — which single channel is doing the work?
  if (hasFacebook && !hasInstagram) return "facebook-only";
  if (hasInstagram && !hasFacebook) return "instagram-only";
  if (hasYelp && !hasFacebook && !hasInstagram) return "yelp-only";
  if (x.socialPlatforms.length > 0) return "social-only";
  if (x.hasGoogleBusiness) return "google-only";
  return "invisible";
}

function describeChannel(profile: PresenceProfile, x: { appointmentTool: string | null; hasGoogleBusiness: boolean }): string {
  switch (profile) {
    case "website":
      return "a website";
    case "facebook-only":
      return "a Facebook page";
    case "instagram-only":
      return "an Instagram account";
    case "yelp-only":
      return "a Yelp profile";
    case "google-only":
      return "a Google Business listing";
    case "social-only":
      return "your social profiles";
    case "invisible":
    default:
      return x.hasGoogleBusiness ? "a Google listing" : "word of mouth and the phone";
  }
}

function modernization(x: {
  profile: PresenceProfile;
  hasWebsite: boolean;
  signals?: WebsiteSignals;
  reviews: { count: number; rating: number; strength: ReviewStrength };
  multipleLocations: boolean;
  appointmentDriven: boolean;
  hasOnlineBooking: boolean;
}): string[] {
  const out: string[] = [];

  // A strong reputation living on a channel they don't own is the single most
  // common, most honest opening — reputation-to-conversion gap.
  if (!x.hasWebsite && (x.reviews.strength === "solid" || x.reviews.strength === "strong")) {
    out.push("a strong reputation that currently lives on a platform the business doesn't own or control");
  }
  if (x.hasWebsite && x.signals?.slowLoad) out.push("a site that loads slowly enough to lose impatient visitors");
  if (x.hasWebsite && x.signals?.mobileFriendly === false) out.push("a site that doesn't hold up on a phone, where most first visits happen");
  if (x.appointmentDriven && !x.hasOnlineBooking) out.push("booking that still runs through the phone during business hours, when many people would rather do it at 10pm");
  if (x.multipleLocations) out.push("several locations whose information and requests are likely kept in step by hand");
  if (x.profile === "invisible") out.push("almost nothing findable online for a business people are clearly trying to reach");
  if (out.length === 0) out.push("small, specific things worth comparing against how the business actually runs");
  return out.slice(0, 4);
}

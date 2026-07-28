"use server";
// Finding a verified contact route. When a lead has no actionable channel, the one
// thing the operator can do is find a real way to reach the business — so the system
// does that work itself (via its existing Google Places discovery) rather than
// telling the operator to go search by hand. Nothing is fabricated: a channel is
// saved only when a real source reports it, and only when it's well-formed.
import { revalidatePath } from "next/cache";
import { getLead, updateLead, appendAudit } from "@/lib/repo";
import { searchPlaces } from "@/lib/providers/places";
import type { PlaceResult } from "@/lib/providers/places";
import { normalizeName, domainFromUrl } from "@/lib/store";
import { isCallablePhone, isValidEmail, isUsableUrl, findInstagram } from "@/lib/outreach/contact-strategy";
import type { Lead } from "@/lib/types";

/** The channels a search or a manual entry can supply. */
export interface FoundChannels {
  phone?: string | null;
  website?: string | null;
  publicEmail?: string | null;
  contactFormUrl?: string | null;
  instagram?: string | null;
}

export interface FindContactResult {
  ok: boolean;
  found: boolean;
  channels: FoundChannels;
  /** Human source label for what supplied the channel(s). */
  source?: string;
  /** The listing name we matched against, so the operator can sanity-check it. */
  matchName?: string;
  /** Which sources the automated search actually consulted. */
  sourcesChecked: string[];
  /** "google" (live) · "mock" (dev) · "disabled" (prod, no key). */
  mode: string;
  message?: string;
}

const nowIso = () => new Date().toISOString();

function appendNote(existing: string | null, line: string): string {
  const stamp = nowIso().slice(0, 10);
  const entry = `[${stamp}] ${line}`;
  return existing?.trim() ? `${entry}\n${existing.trim()}` : entry;
}

async function audit(action: string, targetId: string, meta?: Record<string, unknown>) {
  await appendAudit({ action, actor: "jordan", targetType: "lead", targetId, meta: meta ?? null, ip: null });
}

/** The listing that actually corresponds to this lead — never a loose guess. */
function matchListing(lead: Lead, results: PlaceResult[]): PlaceResult | null {
  if (!results.length) return null;
  // Strongest: the same Google Place. Then an exact normalized-name match in the
  // same city. We do NOT accept a fuzzy "closest" result — a wrong match would
  // save a real-but-unrelated business's phone number.
  if (lead.googlePlaceId) {
    const byId = results.find((r) => r.googlePlaceId === lead.googlePlaceId);
    if (byId) return byId;
  }
  const name = normalizeName(lead.businessName);
  const city = (lead.city ?? "").trim().toLowerCase();
  const byName = results.filter((r) => normalizeName(r.businessName) === name);
  if (byName.length === 1) return byName[0];
  const inCity = byName.find((r) => (r.city ?? "").trim().toLowerCase() === city);
  return inCity ?? null;
}

/**
 * Search public listings for a real contact route and save whatever is genuinely
 * found. Uses the app's existing Google Places discovery (live in production, mock
 * in dev, honestly disabled in production without a key). Saves only well-formed
 * channels the source actually reports.
 */
export async function findContactRouteAction(leadId: string): Promise<FindContactResult> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, found: false, channels: {}, sourcesChecked: [], mode: "disabled", message: "Lead not found." };

  const search = await searchPlaces({
    keyword: lead.businessName,
    category: lead.industry?.trim() || "business",
    city: lead.city ?? "",
    state: lead.state ?? "",
    postalCode: lead.postalCode ?? "",
    radiusMiles: 10,
    minRating: 0,
    minReviews: 0,
    requireWebsite: false,
    requirePhone: false,
  });

  const sourcesChecked = ["Google Business / Places listing"];
  const mode = search.mode;

  if (!search.success) {
    // Honest: no fabricated result. (Quota reached, or live discovery disabled.)
    return { ok: true, found: false, channels: {}, sourcesChecked, mode, message: search.error?.message ?? "Contact search is unavailable right now." };
  }

  const match = matchListing(lead, search.results);
  if (!match) {
    return { ok: true, found: false, channels: {}, sourcesChecked, mode, message: "No listing matched this business closely enough to trust." };
  }

  // Only accept well-formed channels the listing actually reports; fill gaps only.
  const channels: FoundChannels = {};
  const patch: Partial<Lead> = {};
  if (!isCallablePhone(lead.phone) && isCallablePhone(match.phone)) {
    patch.phone = match.phone;
    channels.phone = match.phone;
  }
  if (!isUsableUrl(lead.website) && isUsableUrl(match.website)) {
    patch.website = match.website;
    patch.websiteDomain = domainFromUrl(match.website);
    channels.website = match.website;
  }
  if (!lead.googlePlaceId && match.googlePlaceId) patch.googlePlaceId = match.googlePlaceId;

  const found = !!(channels.phone || channels.website);
  const source = match.googlePlaceId?.startsWith("MOCK_") ? "Mock listing (dev)" : "Google Business listing";

  if (found) {
    patch.retrievedAt = nowIso();
    const parts = [channels.phone ? "phone" : null, channels.website ? "website" : null].filter(Boolean).join(" + ");
    patch.note = appendNote(lead.note, `Contact search: found ${parts} via ${source}.`);
    await updateLead(leadId, patch);
    await audit("lead.contact.discovered", leadId, { source, found: parts, mode });
  } else {
    await audit("lead.contact.searched", leadId, { found: "nothing new", mode });
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { ok: true, found, channels, source, matchName: match.businessName, sourcesChecked, mode };
}

/** Operator-entered contact details — the manual fallback when discovery comes up empty. */
export interface ManualContactInput {
  phone?: string;
  publicEmail?: string;
  website?: string;
  contactFormUrl?: string;
  instagram?: string;
  source?: string;
  verified?: boolean;
}

export interface ManualContactResult {
  ok: boolean;
  saved: string[];
  reason?: string;
}

/**
 * Save operator-entered channels. Each field is validated the same way the strategy
 * engine judges channels, so a malformed entry can never become a usable route.
 * Saving a valid channel lets the page recompute the lead's next action.
 */
export async function saveManualContactAction(leadId: string, input: ManualContactInput): Promise<ManualContactResult> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, saved: [], reason: "Lead not found." };

  const patch: Partial<Lead> = {};
  const saved: string[] = [];

  const phone = (input.phone ?? "").trim();
  if (phone) {
    if (!isCallablePhone(phone)) return { ok: false, saved: [], reason: "That phone number doesn't look dialable." };
    patch.phone = phone; saved.push("phone");
  }
  const email = (input.publicEmail ?? "").trim();
  if (email) {
    if (!isValidEmail(email)) return { ok: false, saved: [], reason: "That email doesn't look valid." };
    patch.publicEmail = email; saved.push("email");
  }
  const website = (input.website ?? "").trim();
  if (website) {
    if (!isUsableUrl(website)) return { ok: false, saved: [], reason: "That website URL doesn't look valid." };
    patch.website = website; patch.websiteDomain = domainFromUrl(website); saved.push("website");
  }
  const form = (input.contactFormUrl ?? "").trim();
  if (form) {
    if (!isUsableUrl(form)) return { ok: false, saved: [], reason: "That contact-form URL doesn't look valid." };
    patch.contactFormUrl = form; saved.push("contact form");
  }
  const ig = (input.instagram ?? "").trim();
  if (ig) {
    if (!isUsableUrl(ig) || !findInstagram([ig])) return { ok: false, saved: [], reason: "That doesn't look like an Instagram profile URL." };
    patch.socialLinks = Array.from(new Set([...(lead.socialLinks ?? []), ig]));
    saved.push("Instagram");
  }

  if (saved.length === 0) return { ok: false, saved: [], reason: "Enter at least one valid contact channel." };

  const src = input.source?.trim();
  const verified = input.verified ? "verified" : "unverified";
  patch.note = appendNote(lead.note, `Contact added manually (${verified}${src ? `, ${src}` : ""}): ${saved.join(", ")}.`);
  await updateLead(leadId, patch);
  await audit("lead.contact.manual", leadId, { saved: saved.join(", "), verified });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { ok: true, saved };
}

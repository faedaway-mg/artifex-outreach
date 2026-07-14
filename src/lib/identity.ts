/**
 * Authoritative Artifex Labs public identity.
 *
 * Single source of truth for company-facing contact info used across
 * Modernization Briefs, outreach templates, booking/contract notices, and share
 * pages. Do NOT put private/auth identities here (Jordan's login/notification
 * email lives in the seeded operator user + env, not this file).
 */
export const ARTIFEX_IDENTITY = {
  companyName: "Artifex Labs",
  publicWebsite: "https://artifexlabs.tech",
  publicEmail: "hello@artifexlabs.tech",
  // Verified live 2026-07-14 (returns 200). NOTE: cal.com/artifexlabs/discovery
  // from the spec currently 404s; point that vanity slug here once it exists.
  bookingUrl: "https://cal.com/jordan-jackson-coa1a0/30min",
  location: "Los Angeles, CA",
  // Company legal name of record is "Faedaway M.G. LLC" (spec wrote "Fadeaway MG LLC").
  legalEntity: "Faedaway M.G. LLC",
  brandTagline: "Build smarter.",
  reportVersion: "v2",
} as const;

/** Convenience: the printed company address line. */
export const ARTIFEX_ADDRESS = `${ARTIFEX_IDENTITY.companyName} · ${ARTIFEX_IDENTITY.location}`;

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
  // NEW Microsoft 365-connected Artifex Labs Cal.com account (organizer =
  // hello@artifexlabs.tech, name "Artifex Labs"). Verified live 2026-07-20
  // (HTTP 200): 30 min, Cal Video. Do NOT use artifex-labs-discovery-call
  // (old personal-Gmail account) or jordan-jackson-coa1a0 (404).
  bookingUrl: "https://cal.com/artifex-labs-ob2qbv/30min",
  location: "Los Angeles, CA",
  // Company legal name of record is "Faedaway M.G. LLC" (spec wrote "Fadeaway MG LLC").
  legalEntity: "Faedaway M.G. LLC",
  brandTagline: "Build smarter.",
  reportVersion: "v2",
} as const;

/** Convenience: the printed company address line. */
export const ARTIFEX_ADDRESS = `${ARTIFEX_IDENTITY.companyName} · ${ARTIFEX_IDENTITY.location}`;

// ─────────────────────────────────────────────────────────────────────────────
// Issuer registry — the contracting/billing legal entity of record.
//
// This is intentionally SEPARATE from ARTIFEX_IDENTITY (the public brand identity
// used across outreach, briefs, and share pages). The brand ("Artifex Labs") does
// not change; the *contracting entity* did. Keeping them apart means changing the
// billing entity for NEW records never retroactively rewrites historical brand
// rendering, outreach copy, or already-frozen agreement snapshots.
//
// Every generated agreement freezes its issuer (id + legal entity) into its
// content snapshot. Rendering and provider-account selection read the FROZEN
// value, so historical Faedaway agreements keep their entity and their account
// binding even after the current issuer moves to Artifex Labs Systems LLC.
//
// SECRET HYGIENE: this file names the ENV VARS that hold each issuer's provider
// credentials. It never contains a key value. Missing config is reported by name.
// ─────────────────────────────────────────────────────────────────────────────

export interface Issuer {
  /** Stable id frozen into snapshots. Never reuse or repoint an id. */
  id: string;
  /** Contracting legal entity, e.g. "Artifex Labs Systems LLC". */
  legalEntity: string;
  /** Brand the entity does business as. */
  dbaBrand: string;
  /** Default human signatory on the Artifex side. */
  signatory: string;
  /** active = used for NEW records; historical = preserved for old records only. */
  status: "active" | "historical";
  /** NAME of the env var holding this issuer's Stripe secret key (never the value). */
  stripeSecretEnvVar: string;
  /** NAME of the env var holding this issuer's Stripe webhook signing secret. */
  stripeWebhookSecretEnvVar: string;
}

export const ISSUERS: Record<string, Issuer> = {
  "artifex-systems": {
    id: "artifex-systems",
    legalEntity: "Artifex Labs Systems LLC",
    dbaBrand: "Artifex Labs",
    signatory: "Jordan Jackson",
    status: "active",
    stripeSecretEnvVar: "STRIPE_SECRET_KEY",
    stripeWebhookSecretEnvVar: "STRIPE_WEBHOOK_SECRET",
  },
  faedaway: {
    id: "faedaway",
    legalEntity: "Faedaway M.G. LLC",
    dbaBrand: "Artifex Labs",
    signatory: "Jordan Jackson",
    status: "historical",
    // Historical entity keeps its own (separate) account credentials. If these are
    // unset, provider actions for a Faedaway record REFUSE rather than fall through
    // to the new entity's account.
    stripeSecretEnvVar: "STRIPE_SECRET_KEY_FAEDAWAY",
    stripeWebhookSecretEnvVar: "STRIPE_WEBHOOK_SECRET_FAEDAWAY",
  },
};

/** The entity that issues NEW agreements and billing. */
export const CURRENT_ISSUER_ID = "artifex-systems";

export function currentIssuer(): Issuer {
  return ISSUERS[CURRENT_ISSUER_ID];
}

export function getIssuer(id: string | null | undefined): Issuer | null {
  if (!id) return null;
  return ISSUERS[id] ?? null;
}

/**
 * Resolve the issuer for a snapshot that may predate the issuer field.
 *  1. explicit frozen issuerId (new records) wins;
 *  2. else match by the frozen legal-entity string (recover old records);
 *  3. else fall back to the historical entity — NEVER the active one — so a
 *     pre-issuer record can never silently bind to the new LLC's account.
 */
export function resolveIssuerForSnapshot(snapshot: {
  issuerId?: string | null;
  artifexLegalEntity?: string | null;
}): Issuer {
  const byId = getIssuer(snapshot.issuerId);
  if (byId) return byId;
  const entity = (snapshot.artifexLegalEntity ?? "").trim();
  if (entity) {
    const match = Object.values(ISSUERS).find((i) => i.legalEntity === entity);
    if (match) return match;
  }
  return ISSUERS.faedaway;
}

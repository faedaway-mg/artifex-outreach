// ─────────────────────────────────────────────────────────────────────────────
// CONTACTABILITY — is this business reachable through the ONE channel Quick-Cash
// uses (cold email)? Raw discovery count is NOT sellable inventory. A lead with no
// usable email is terminal for this channel; a catch-all / unverified address must
// not silently spend fresh mailbox reputation. Provenance is scored HONESTLY — a
// free-provider address a business publishes as its own contact is legitimate and
// is NOT auto-rejected. Nothing here fabricates SMTP/provider verification.
//
// PRINCIPLE 2 (no email = no Quick-Cash outbound) and PRINCIPLE 4 (one real reason)
// both start here: without a usable, honestly-graded address, a lead never becomes
// sendable — no matter how good the fix would be.
// ─────────────────────────────────────────────────────────────────────────────

export type ContactabilityState =
  | "VERIFIED_EMAIL"
  | "HIGH_CONFIDENCE_EMAIL"
  | "CATCH_ALL"
  | "UNVERIFIED_EMAIL"
  | "NO_EMAIL";

/** Where the address came from — provenance, scored honestly (never inflated). */
export type EmailProvenance =
  | "provider-verified"
  | "official-website"
  | "published-contact-page"
  | "directory"
  | "enrichment"
  | "historical"
  | "unknown";

export interface ContactabilitySignals {
  email?: string | null;
  website?: string | null;
  /** Real provider/SMTP verification evidence exists (never assume — pass true only when proven). */
  providerVerified?: boolean;
  /** Enrichment/contact confidence label, when a Contact record backs the address. */
  contactConfidence?: "Verified" | "Likely" | "Unknown" | null;
  provenance?: EmailProvenance | null;
  /** Enrichment reported the domain accepts all recipients (catch-all) — low trust. */
  catchAll?: boolean;
  /** A prior hard bounce was recorded for this address/domain. */
  bounced?: boolean;
}

export interface Contactability {
  state: ContactabilityState;
  provenance: EmailProvenance;
  hasEmail: boolean;
  /** Auto-sendable for cold Quick-Cash without operator approval (reputation-safe). */
  emailableAuto: boolean;
  /** Sendable ONLY with explicit operator approval (catch-all / unverified). */
  emailableWithApproval: boolean;
  /** Small ranking signal in [0..1] — better-verified provenance ranks higher. */
  qualitySignal: number;
  reasons: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_PROVIDERS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
  "me.com", "live.com", "msn.com", "protonmail.com", "proton.me", "gmx.com", "ymail.com",
]);

function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.includes("@") ? value.split("@").pop()! : value;
  try {
    const host = raw.startsWith("http") ? new URL(raw).hostname : raw;
    return host.replace(/^www\./, "").trim().toLowerCase() || null;
  } catch {
    return raw.replace(/^www\./, "").trim().toLowerCase() || null;
  }
}

const QUALITY: Record<ContactabilityState, number> = {
  VERIFIED_EMAIL: 1,
  HIGH_CONFIDENCE_EMAIL: 0.75,
  UNVERIFIED_EMAIL: 0.4,
  CATCH_ALL: 0.3,
  NO_EMAIL: 0,
};

/**
 * Classify how reachable a lead is by cold email. Deterministic and pure — the same
 * signals always produce the same verdict. Provenance is graded honestly: a
 * published free-provider address is treated as a legitimate business contact, not
 * penalized for the domain; only unproven/catch-all addresses lose auto-sendability.
 */
export function assessContactability(sig: ContactabilitySignals): Contactability {
  const email = (sig.email ?? "").trim().toLowerCase();
  const reasons: string[] = [];

  if (!email || !EMAIL_RE.test(email)) {
    return { state: "NO_EMAIL", provenance: "unknown", hasEmail: false, emailableAuto: false, emailableWithApproval: false, qualitySignal: 0, reasons: ["no usable email address on the record"] };
  }

  const emailDomain = domainOf(email);
  const siteDomain = domainOf(sig.website ?? null);
  const matchesWebsite = !!emailDomain && !!siteDomain && emailDomain === siteDomain;
  const isFree = !!emailDomain && FREE_PROVIDERS.has(emailDomain);

  // Infer provenance if none supplied: an address on the business's own domain is
  // most naturally its official website contact.
  let provenance: EmailProvenance = sig.provenance ?? (matchesWebsite ? "official-website" : "unknown");
  if (sig.providerVerified) provenance = "provider-verified";

  const officiallyPublished = provenance === "official-website" || provenance === "published-contact-page";

  let state: ContactabilityState;
  if (sig.providerVerified || sig.contactConfidence === "Verified") {
    state = "VERIFIED_EMAIL";
    reasons.push(sig.providerVerified ? "provider/SMTP verified" : "verified contact record");
  } else if (sig.catchAll) {
    state = "CATCH_ALL";
    reasons.push("domain is catch-all — acceptance does not prove the mailbox exists");
  } else if (officiallyPublished || matchesWebsite || sig.contactConfidence === "Likely") {
    state = "HIGH_CONFIDENCE_EMAIL";
    reasons.push(matchesWebsite ? "address on the business's own domain" : officiallyPublished ? `published as an official contact (${provenance})` : "high-confidence contact record");
    if (isFree && officiallyPublished) reasons.push("free-provider address, but the business publishes it as its own contact — scored on provenance, not domain");
  } else {
    state = "UNVERIFIED_EMAIL";
    reasons.push("address present but unverified and not published on the official site");
  }

  const bounced = !!sig.bounced;
  if (bounced) reasons.push("prior hard bounce — not sendable until cleared");

  const emailableAuto = !bounced && (state === "VERIFIED_EMAIL" || state === "HIGH_CONFIDENCE_EMAIL");
  const emailableWithApproval = !bounced && (state === "CATCH_ALL" || state === "UNVERIFIED_EMAIL");

  return { state, provenance, hasEmail: true, emailableAuto, emailableWithApproval, qualitySignal: bounced ? 0 : QUALITY[state], reasons };
}

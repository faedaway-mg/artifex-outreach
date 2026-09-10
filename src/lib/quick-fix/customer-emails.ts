// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONAL CUSTOMER EMAIL TEMPLATES (Customer Portal mandate CP7 · §24) — the legitimate CUSTOMER
// lifecycle messages (Order Confirmed / Access Needed / Project Complete), each linking securely back to
// that customer's project portal. These are PURE RENDERERS ONLY — this module builds the message; it does
// NOT send. Fixture validation renders and asserts; it never transmits externally.
//
// These are CUSTOMER/transactional communications, not prospect outreach — they ride the existing
// transactional transport (Resend) and DO NOT touch the Google-only prospect-transport invariant. No
// secret, password, or credential ever appears in a template. The portal link is the customer's existing
// unguessable capability token (share token / offerId) — never an internal id or a raw storage URL.
// ─────────────────────────────────────────────────────────────────────────────
import { ARTIFEX_IDENTITY } from "../identity";

export type CustomerEmailKind = "order-confirmed" | "access-needed" | "project-complete" | "project-update";

export interface RenderedCustomerEmail {
  kind: CustomerEmailKind;
  subject: string;
  text: string;
  /** The secure portal link included in the body (customer's capability token). */
  portalUrl: string;
  /** Always false here — this module renders, it never sends. */
  sent: false;
}

export interface CustomerEmailInput {
  /** The customer's capability token — the offer share token (preferred) or the hash-derived offerId. */
  portalToken: string;
  company: string;
  serviceName: string;
  /** For access-needed: a short customer-safe description of what's required. */
  accessSummary?: string;
  /** For project-update: a short customer-safe status line. */
  updateSummary?: string;
}

/** Absolute portal URL for the customer's project. Falls back to the public site origin when no app base
 *  URL is configured (still a valid, non-secret link the customer can open). */
export function portalUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.APP_BASE_URL || env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL || ARTIFEX_IDENTITY.publicWebsite).replace(/\/$/, "");
  return `${base}/offer/${encodeURIComponent(token)}/portal`;
}

const SIGNOFF = `\n\n— The ${ARTIFEX_IDENTITY.companyName} team\n${ARTIFEX_IDENTITY.publicEmail}`;

/** Render one transactional customer email. Pure; never sends; never includes a secret. */
export function renderCustomerEmail(kind: CustomerEmailKind, input: CustomerEmailInput, env: NodeJS.ProcessEnv = process.env): RenderedCustomerEmail {
  const url = portalUrl(input.portalToken, env);
  const base = { kind, portalUrl: url, sent: false as const };

  switch (kind) {
    case "order-confirmed":
      return {
        ...base,
        subject: `Your ${input.serviceName} is confirmed`,
        text: `Hi ${input.company},\n\nThanks — your ${input.serviceName} is confirmed and we're getting started. You can follow everything (status, what we need from you, and the finished result) in your project portal:\n\n${url}\n\nWe'll let you know the moment we need anything from you.${SIGNOFF}`,
      };
    case "access-needed":
      return {
        ...base,
        subject: `One quick step to start your ${input.serviceName}`,
        text: `Hi ${input.company},\n\nWe're ready to begin your ${input.serviceName} — we just need access to get started${input.accessSummary ? `: ${input.accessSummary}` : "."}.\n\nGrant access securely from your project portal (we never ask for your password):\n\n${url}${SIGNOFF}`,
      };
    case "project-complete":
      return {
        ...base,
        subject: `Your ${input.serviceName} is complete`,
        text: `Hi ${input.company},\n\nYour ${input.serviceName} is complete. You can see exactly what we changed, what we tested, and your completion package in your project portal:\n\n${url}\n\nThank you for working with us.${SIGNOFF}`,
      };
    case "project-update":
      return {
        ...base,
        subject: `Update on your ${input.serviceName}`,
        text: `Hi ${input.company},\n\n${input.updateSummary ?? "There's an update on your project."}\n\nSee the details in your project portal:\n\n${url}${SIGNOFF}`,
      };
  }
}

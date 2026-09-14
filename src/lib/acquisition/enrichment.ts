// ─────────────────────────────────────────────────────────────────────────────
// POST-QUALIFICATION CONTACT ENRICHMENT — the canonical stage that resolves a
// send-eligible email ONLY for leads that have already earned a current action
// (PROVEN / OBSERVED). Qualify first, enrich second, contact third.
//
// Cost discipline: uses the existing FREE same-domain website harvest (already-paid
// Places/website fetch); NO paid enrichment provider is introduced (costUsd = 0).
// An inventory lead with no legitimate needle consumes ZERO enrichment spend because
// shouldEnrich() gates on a qualification verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { analyzeWebsite } from "../providers/website";
import { assessContactability } from "../quick-fix/contactability";
import type { Lead } from "../types";

export interface EnrichmentResult {
  leadId: string;
  email: string | null;
  method: string;            // homepage | contact-page | none (harvest provenance)
  provenance: string;        // official-website | published-contact-page | unknown
  confidenceState: string;   // VERIFIED_EMAIL | HIGH_CONFIDENCE_EMAIL | UNVERIFIED_EMAIL | CATCH_ALL | NO_EMAIL
  sendEligible: boolean;     // emailableAuto (VERIFIED/HIGH_CONFIDENCE) and not bounced
  reasons: string[];
  contactFormUrl: string | null;
  contactFormAvailable: boolean;
  captchaPresent: boolean;
  phoneRetained: boolean;
  costUsd: number;           // 0 — free website harvest, no paid provider
  at: string;
}

const CAPTCHA_RE = /recaptcha|g-recaptcha|hcaptcha|cf-turnstile|grecaptcha|data-sitekey|turnstile/i;
const FORM_RE = /<form[\s>]/i;

/** Post-qualification gate: enrich ONLY an OUTREACH-ELIGIBLE lead that lacks a send-approved
 *  email. Under the canonical doctrine only PROVEN is outreach-eligible — OBSERVED and every
 *  other verdict consume ZERO enrichment spend (we enrich only what we may contact). */
export function shouldEnrich(input: { verdict?: string | null; hasSendApprovedEmail: boolean }): boolean {
  const outreachEligible = input.verdict === "PROVEN";
  return outreachEligible && !input.hasSendApprovedEmail;
}

/** Resolve the best send-eligible contact for an already-qualified lead. Read-only. */
export async function enrichContact(lead: Lead, opts: { bounced?: boolean } = {}): Promise<EnrichmentResult> {
  const at = new Date().toISOString();
  const wa: any = await analyzeWebsite(lead).catch(() => null);
  const email = (wa?.emailProvenance?.email || "").trim() || null;
  const method: string = wa?.emailProvenance?.method ?? "none";
  const provenance = method === "homepage" ? "official-website" : method === "contact-page" ? "published-contact-page" : "unknown";

  const contact = assessContactability({
    email,
    website: lead.website ?? null,
    provenance: email ? (provenance as any) : null,
    bounced: opts.bounced,
  } as any);

  let contactFormUrl: string | null = (lead as any).contactFormUrl ?? null;
  let captchaPresent = false;
  const pages: Array<{ url: string; html: string }> = wa?.pages ?? [];
  for (const p of pages) {
    if (!contactFormUrl && FORM_RE.test(p.html)) contactFormUrl = p.url;
    if (CAPTCHA_RE.test(p.html)) captchaPresent = true;
  }
  const contactFormAvailable = !!contactFormUrl || !!wa?.signals?.hasLeadForm;

  return {
    leadId: lead.id,
    email,
    method,
    provenance: email ? provenance : "unknown",
    confidenceState: contact.state,
    sendEligible: contact.emailableAuto,
    reasons: contact.reasons,
    contactFormUrl,
    contactFormAvailable,
    captchaPresent,
    phoneRetained: !!lead.phone,
    costUsd: 0,
    at,
  };
}

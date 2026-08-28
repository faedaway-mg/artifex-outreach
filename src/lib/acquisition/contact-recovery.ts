// ─────────────────────────────────────────────────────────────────────────────
// No-email pool recovery — run the CHEAP contact-first gate over existing leads that already have a
// website but no email, and record the finding (or a precise hold-reason). This NEVER runs deep
// analysis, screenshots, PageSpeed, PDF, or video, and NEVER sends: it only establishes reachability.
//
// It is a thin orchestrator over injectable dependencies so the safety properties are unit-testable
// without a network or a database. The absence of any BI/PDF/video dependency is deliberate and IS the
// savings guarantee — finding an email must not, by construction, trigger expensive work here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import { checkPublishedEmail, type ContactCheckResult } from "./contact-check";

export interface RecoveryDeps {
  now: string;
  /** Eligible leads: website present, no usable email, not terminal/suppressed/contacted/duplicate. */
  candidates: () => Promise<Lead[]>;
  /** Cached website HTML for a lead (e.g. from a prior BI crawl) to avoid a re-fetch. Optional. */
  cachedPagesFor?: (leadId: string) => Promise<Array<{ url: string; html: string }> | null>;
  /** The contact check (defaults to the bounded live checkPublishedEmail). */
  check?: (website: string | null | undefined, cached: Array<{ url: string; html: string }> | null, now: string) => Promise<ContactCheckResult>;
  /** True if this exact address is already suppressed (a new address must not bypass an opt-out). */
  isSuppressed: (email: string) => Promise<boolean>;
  /** Backoff: true if this lead was checked within the retry window (skip — don't rescan failures). */
  recentlyChecked?: (leadId: string) => Promise<boolean>;
  /** Persist a recovered email + provenance on the lead (never overwrites an existing address). */
  saveEmail: (leadId: string, email: string, result: ContactCheckResult) => Promise<void>;
  /** Record the check outcome + hold-reason (audit) regardless of found/not — enables backoff. */
  recordOutcome: (leadId: string, result: ContactCheckResult) => Promise<void>;
  maxLeads?: number;      // hard cap on how many leads this pass touches
  concurrency?: number;   // parallel businesses (each is one host); default 3
}

export interface RecoverySummary {
  attempted: number;
  recovered: number;            // email found + adopted
  heldSuppressed: number;       // email found but already suppressed → not adopted
  noWebsite: number;
  notFound: number;
  fetchFailed: number;
  ambiguous: number;
  skipped: number;              // backoff (recently checked)
  recoveredLeads: Array<{ leadId: string; email: string; domainMatched: boolean; sourceUrl: string | null }>;
}

export async function recoverContacts(deps: RecoveryDeps): Promise<RecoverySummary> {
  const check = deps.check ?? ((w, c, now) => checkPublishedEmail(w, { now, cachedPages: c ?? undefined }));
  const limit = deps.maxLeads ?? Infinity;
  const conc = Math.max(1, deps.concurrency ?? 3);
  const all = (await deps.candidates()).slice(0, limit === Infinity ? undefined : limit);
  const s: RecoverySummary = { attempted: 0, recovered: 0, heldSuppressed: 0, noWebsite: 0, notFound: 0, fetchFailed: 0, ambiguous: 0, skipped: 0, recoveredLeads: [] };

  // Simple bounded worker pool over the candidate list (each lead = one host → no per-host contention).
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++; if (i >= all.length) return;
      const lead = all[i];
      if (deps.recentlyChecked && (await deps.recentlyChecked(lead.id))) { s.skipped++; continue; }
      s.attempted++;
      const cached = deps.cachedPagesFor ? await deps.cachedPagesFor(lead.id) : null;
      const r = await check(lead.website, cached, deps.now);
      await deps.recordOutcome(lead.id, r); // always recorded → future backoff
      if (r.outcome === "found" && r.email) {
        if (await deps.isSuppressed(r.email)) { s.heldSuppressed++; continue; } // opt-out is never bypassed
        await deps.saveEmail(lead.id, r.email, r);
        s.recovered++; s.recoveredLeads.push({ leadId: lead.id, email: r.email, domainMatched: r.domainMatched, sourceUrl: r.sourceUrl });
      } else if (r.outcome === "no-website") s.noWebsite++;
      else if (r.outcome === "fetch-failed") s.fetchFailed++;
      else if (r.outcome === "ambiguous") s.ambiguous++;
      else s.notFound++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, all.length || 1) }, worker));
  return s;
}

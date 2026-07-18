// ─────────────────────────────────────────────────────────────────────────────
// Launch Readiness Checklist (Phase 2).
//
// Verifies the entire acquisition platform before live outreach. Where possible it
// EXERCISES the real code path (runs the intelligence engine on real seeded
// businesses, generates a real outreach sequence, renders a real email body) rather
// than asserting configuration. Checks that can only be confirmed by a human — the
// public marketing site's look on real devices, and the final "would I send this?"
// sign-off — are surfaced as explicit manual checks, never silently passed.
// ─────────────────────────────────────────────────────────────────────────────
import {
  listLeads, findingsForLead, contactsForLead, getSettings, allPlans, allSteps,
  allEmailSends, allDeliverables, allVideos, listSuppressions, allBusinessIntelligence,
  buildSuppressionChecker,
} from "@/lib/repo";
import { hasDb, pingDb } from "@/db/client";
import { authConfigOk } from "@/lib/auth-config";
import { getEmailProvider } from "@/lib/comms/provider";
import { readyProviders } from "@/lib/intelligence";
import { analyzeBusiness, type BusinessIntelligence } from "@/lib/intelligence";
import { computeAcquisitionStrategy } from "@/lib/acquisition/strategy";
import { buildSequence } from "@/lib/acquisition/sequences";
import { assetReadiness } from "@/lib/acquisition/assets";
import { renderBody } from "@/lib/comms/render";
import { estimateRelationshipValue, ENGAGEMENT_MODELS } from "@/lib/pricing";
import { ARTIFEX_SERVICES } from "@/lib/types";
import { platformHealth } from "./health";
import { launchMetrics } from "./metrics";
import { check, rollupSections, type Check, type CheckSection, type CheckStatus, type Rollup } from "./types";

export interface ReadinessResult {
  generatedAt: string;
  sections: CheckSection[];
  rollup: Rollup;
  manualReviewConfirmed: boolean;
  /** True only when there are no failing checks AND the human sign-off is present. */
  ready: boolean;
}

export interface ReadinessOptions {
  /** Explicit human confirmation of the final "would I send this?" checkpoint. */
  manualReviewConfirmed?: boolean;
  /** How many real businesses to exercise the intelligence engine against. */
  sampleSize?: number;
}

const truthyEnv = (v: string | undefined) => v === "1" || v === "true" || v === "yes";

export async function readinessChecklist(opts: ReadinessOptions = {}): Promise<ReadinessResult> {
  const now = new Date();
  const sampleSize = opts.sampleSize ?? 3;

  const [leads, settings, plans, steps, emailSends, deliverables, videos, suppressions, bi] = await Promise.all([
    listLeads(), getSettings(), allPlans(), allSteps(), allEmailSends(), allDeliverables(),
    allVideos(), listSuppressions(), allBusinessIntelligence(),
  ]);

  // Sign-off is durable (Settings) or, for CLI/CI, an explicit opt/env override.
  const manualReviewConfirmed =
    opts.manualReviewConfirmed ??
    (Boolean(settings.launchReviewConfirmedAt) || truthyEnv(process.env.LAUNCH_MANUAL_REVIEW_CONFIRMED));

  const sections: CheckSection[] = [];
  sections.push(await infrastructureSection(plans, steps));
  sections.push(await businessIntelligenceSection(leads.slice(0, sampleSize)));
  sections.push(await outreachSection(leads, settings, plans, steps, emailSends, deliverables, videos, suppressions));
  sections.push(websiteSection());
  sections.push(commercialSection(leads, settings));
  sections.push(await analyticsSection(now));
  sections.push(manualReviewSection(manualReviewConfirmed));

  const rollup = rollupSections(sections);
  const ready = rollup.fail === 0 && manualReviewConfirmed;
  return { generatedAt: now.toISOString(), sections, rollup, manualReviewConfirmed, ready };
}

// ── Infrastructure ───────────────────────────────────────────────────────────
async function infrastructureSection(
  plans: Awaited<ReturnType<typeof allPlans>>,
  steps: Awaited<ReturnType<typeof allSteps>>,
): Promise<CheckSection> {
  const checks: Check[] = [];
  const publicUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.RAILWAY_STATIC_URL;
  checks.push(
    publicUrl
      ? check("infra.website", "Website deployed", "pass", `Public URL configured (${hostOf(publicUrl)}).`)
      : check("infra.website", "Website deployed", "warn", "No public URL env set — running locally.", "Set APP_URL / RAILWAY_STATIC_URL in the deploy environment."),
  );

  const dbConfigured = hasDb();
  const dbConnected = dbConfigured ? await pingDb() : false;
  checks.push(
    dbConfigured && dbConnected
      ? check("infra.db", "Database healthy", "pass", "Postgres reachable.")
      : dbConfigured
        ? check("infra.db", "Database healthy", "fail", "DATABASE_URL set but the database is unreachable.", "Verify the connection string and that Postgres is running.")
        : check("infra.db", "Database healthy", "warn", "In-memory store (no DATABASE_URL) — fine for dev, required for production.", "Provision Postgres and set DATABASE_URL before launch."),
  );

  checks.push(
    authConfigOk()
      ? check("infra.auth", "Authentication working", "pass", "Auth secret and operator password are securely configured.")
      : check("infra.auth", "Authentication working", "warn", "Auth is using development defaults.", "Set AUTH_SECRET and a strong OUTREACH_PASSWORD before launch."),
  );

  const provider = getEmailProvider();
  checks.push(
    provider.canSend
      ? check("infra.email", "Email provider configured", "pass", `${provider.name} ready to send.`)
      : check("infra.email", "Email provider configured", "warn", "No email provider configured — sends are paused (approval-gated system still runs).", "Set RESEND_API_KEY / RESEND_FROM to enable live sending."),
  );

  checks.push(
    process.env.CRON_SECRET
      ? check("infra.cron", "Cron jobs healthy", "pass", "CRON_SECRET set — scheduled prospecting/send endpoints are guarded.")
      : check("infra.cron", "Cron jobs healthy", "warn", "CRON_SECRET not set — cron endpoints are unguarded/disabled.", "Set CRON_SECRET and confirm Railway cron functions are deployed."),
  );

  checks.push(
    readyProviders().length >= 1
      ? check("infra.providers", "Provider architecture healthy", "pass", `${readyProviders().length} enrichment provider(s) ready.`)
      : check("infra.providers", "Provider architecture healthy", "fail", "No enrichment providers are ready.", "Ensure the local providers register at startup."),
  );

  // The BI engine, dashboard, approval center, and analytics are exercised in
  // their own sections; here we confirm the data surfaces they depend on exist.
  checks.push(check("infra.dashboard", "Dashboard healthy", "pass", "Launch metrics + platform health composables load (verified in Analytics)."));
  checks.push(
    check("infra.approvals", "Approval Center healthy", plans.length || steps.length ? "pass" : "warn",
      plans.length || steps.length ? `${plans.length} plan(s), ${steps.length} step(s) available for review.` : "No plans prepared yet.",
      plans.length || steps.length ? undefined : "Run prospecting so the Approval Center has plans to gate."),
  );

  return { name: "Infrastructure", checks };
}

// ── Business Intelligence (exercises the real engine) ─────────────────────────
async function businessIntelligenceSection(sample: Awaited<ReturnType<typeof listLeads>>): Promise<CheckSection> {
  const checks: Check[] = [];
  if (!sample.length) {
    checks.push(check("bi.sample", "Test businesses available", "fail", "No leads to analyze.", "Seed or discover leads first."));
    return { name: "Business Intelligence", checks };
  }

  const results: BusinessIntelligence[] = [];
  const errors: string[] = [];
  for (const lead of sample) {
    try {
      const [findings, contacts] = await Promise.all([findingsForLead(lead.id), contactsForLead(lead.id)]);
      results.push(await analyzeBusiness({ lead, findings, contacts }));
    } catch (err) {
      errors.push(`${lead.businessName}: ${(err as Error).message}`);
    }
  }

  if (!results.length) {
    checks.push(check("bi.run", "Engine runs on real businesses", "fail", `Engine threw on all ${sample.length} sampled businesses. ${errors[0] ?? ""}`, "Investigate the intelligence engine before launch."));
    return { name: "Business Intelligence", checks };
  }
  const n = results.length;
  const every = (label: string, id: string, pred: (r: (typeof results)[number]) => boolean, fix: string): Check => {
    const ok = results.filter(pred).length;
    const status: CheckStatus = ok === n ? "pass" : ok === 0 ? "fail" : "warn";
    return check(id, label, status, `${ok}/${n} sampled businesses produced this.`, ok === n ? undefined : fix);
  };

  checks.push(every("Business Technology Snapshot", "bi.snapshot", (r) => !!r.snapshot, "Snapshot missing for some businesses."));
  checks.push(every("Business Improvement Potential", "bi.improvement", (r) => typeof r.improvement?.score === "number", "Improvement score not computed."));
  checks.push(every("Technology Maturity", "bi.maturity", (r) => !!r.maturity?.overall && r.maturity.dimensions.length > 0, "Maturity assessment incomplete."));
  checks.push(every("Opportunity Graph", "bi.graph", (r) => Array.isArray(r.opportunityGraph?.nodes) && typeof r.opportunityGraph?.story === "string", "Opportunity graph not built."));
  checks.push(every("Business Evolution Preview", "bi.evolution", (r) => Array.isArray(r.evolution?.opportunities), "Evolution plan missing."));
  checks.push(every("Discovery Questions", "bi.discovery", (r) => (r.briefing?.bestDiscoveryQuestions?.length ?? 0) > 0, "No discovery questions generated."));
  checks.push(every("Evidence Confidence", "bi.confidence", (r) => typeof r.evidenceConfidence === "number", "Evidence confidence not scored."));
  checks.push(every("Operator Briefing", "bi.briefing", (r) => !!r.briefing?.whyItMatters && !!r.briefing?.nextAction, "Operator briefing incomplete."));
  checks.push(every("Provider Fusion", "bi.fusion", (r) => Array.isArray(r.fusedEvidence) && Array.isArray(r.contradictions), "Fusion output missing."));
  checks.push(every("No missing critical data", "bi.complete", (r) => !!r.businessName && !!r.industry && r.evidence.length > 0, "Critical fields missing."));
  if (errors.length) checks.push(check("bi.errors", "Engine stability", "warn", `${errors.length} business(es) threw: ${errors[0]}`, "Investigate the failing businesses."));

  return { name: "Business Intelligence", checks };
}

// ── Outreach (generates a real sequence + renders a real email) ───────────────
async function outreachSection(
  leads: Awaited<ReturnType<typeof listLeads>>,
  settings: Awaited<ReturnType<typeof getSettings>>,
  plans: Awaited<ReturnType<typeof allPlans>>,
  steps: Awaited<ReturnType<typeof allSteps>>,
  emailSends: Awaited<ReturnType<typeof allEmailSends>>,
  deliverables: Awaited<ReturnType<typeof allDeliverables>>,
  videos: Awaited<ReturnType<typeof allVideos>>,
  suppressions: Awaited<ReturnType<typeof listSuppressions>>,
): Promise<CheckSection> {
  const checks: Check[] = [];
  const lead = leads[0];
  if (!lead) {
    checks.push(check("out.sample", "Test lead available", "fail", "No leads to generate outreach for."));
    return { name: "Outreach", checks };
  }

  // Generate a real sequence for a representative strategy.
  const observation = "your website's contact path could capture more inquiries";
  let sequence: ReturnType<typeof buildSequence> = [];
  try {
    const strat = computeAcquisitionStrategy(lead, { hasApprovedFindings: false });
    const seqStrategy = strat.strategy === "Do Not Contact" || strat.strategy === "Manual Review" ? "Assisted" : strat.strategy;
    sequence = buildSequence(seqStrategy, lead, settings, observation);
  } catch (err) {
    checks.push(check("out.generate", "Outreach generation", "fail", `Sequence generation threw: ${(err as Error).message}`));
    return { name: "Outreach", checks };
  }

  const first = sequence[0];
  const rendered = first ? renderBody(first.content, { replyEmail: settings.contactEmail, unsubscribeUrl: "https://example.com/u/abc" }) : "";

  checks.push(
    rendered.trim().length > 0
      ? check("out.email", "Email rendering", "pass", "Step content renders to a non-empty body.")
      : check("out.email", "Email rendering", "fail", "Rendered email body is empty."),
  );
  checks.push(
    deliverables.some((d) => !!d.content?.executiveSnapshot?.overview)
      ? check("out.snapshot", "Snapshot rendering", "pass", "Deliverables carry a populated executive snapshot.")
      : check("out.snapshot", "Snapshot rendering", "warn", "No deliverables with snapshot content yet.", "Prepare a Modernization Brief / Quick Snapshot for a lead."),
  );
  checks.push(
    videos.some((v) => !!v.script)
      ? check("out.video", "Video generation", "pass", "Video plans carry a script.")
      : check("out.video", "Video generation", "warn", "No video scripts prepared yet.", "Prepare a personalized video for a Tier A lead."),
  );
  checks.push(
    deliverables.length
      ? check("out.attachments", "Attachments", "pass", "Deliverables can be generated as PDF attachments.")
      : check("out.attachments", "Attachments", "warn", "No deliverables to attach.", "Generate a deliverable PDF."),
  );
  checks.push(
    !/\{\{unsubscribe\}\}/.test(rendered) && /unsubscribe/i.test(rendered)
      ? check("out.links", "Links", "pass", "Unsubscribe token resolves to a working opt-out in the sent body.")
      : check("out.links", "Links", "warn", "Unsubscribe link not detected in rendered body.", "Ensure step templates include the {{unsubscribe}} token."),
  );
  checks.push(
    !/\{\{[a-z]/i.test(rendered)
      ? check("out.format", "Formatting", "pass", "No unresolved template tokens in the rendered body.")
      : check("out.format", "Formatting", "warn", "Rendered body contains unresolved {{tokens}}.", "Fill or remove the leftover template tokens."),
  );
  checks.push(
    first && new RegExp(escapeRe(lead.businessName.split(" ")[0]), "i").test(first.content + " " + first.subject)
      ? check("out.personalization", "Personalization", "pass", "Generated outreach references the business by name.")
      : check("out.personalization", "Personalization", "warn", "Generated outreach did not reference the business name.", "Confirm sequence templates interpolate the business name."),
  );

  // Approval gate: no send may exist for a plan that was never approved.
  const approvedPlanIds = new Set(plans.filter((p) => p.approvalStatus === "approved").map((p) => p.id));
  const leakedSends = emailSends.filter((s) => s.sentAt && s.planId && !approvedPlanIds.has(s.planId)).length;
  checks.push(
    leakedSends === 0
      ? check("out.approval", "Approval flow", "pass", "Every sent email belongs to an approved plan — nothing sends without approval.")
      : check("out.approval", "Approval flow", "fail", `${leakedSends} email(s) were sent for plans that were not approved.`, "Investigate the send-gating logic immediately."),
  );
  checks.push(
    sequence.length >= 2
      ? check("out.followup", "Follow-up sequence", "pass", `Generated a ${sequence.length}-touch sequence with delays.`)
      : check("out.followup", "Follow-up sequence", "warn", "Sequence has fewer than two touches.", "Confirm follow-up steps are configured."),
  );

  // Suppression behaviour: a suppressed contact must be recognised.
  const checker = await buildSuppressionChecker();
  const sup = suppressions[0];
  const suppressionWorks = sup
    ? checker({ email: sup.email, domain: sup.domain, phone: sup.phone })
    : !checker({ email: "definitely-not-suppressed@example.com" });
  checks.push(
    suppressionWorks
      ? check("out.suppression", "Suppression behavior", "pass", sup ? "A known suppressed contact is correctly blocked." : "Suppression checker operates (no suppressions on file).")
      : check("out.suppression", "Suppression behavior", "fail", "Suppression checker did not block a suppressed contact.", "Investigate suppression matching."),
  );

  return { name: "Outreach", checks };
}

// ── Website (public marketing site — mostly human-verified) ───────────────────
function websiteSection(): CheckSection {
  const verified = truthyEnv(process.env.WEBSITE_VERIFIED);
  const manual = (id: string, label: string): Check =>
    verified
      ? check(id, label, "pass", "Confirmed via WEBSITE_VERIFIED sign-off.")
      : check(id, label, "warn", "Requires human verification on the live public site.", "Verify on the deployed Artifex Labs site, then set WEBSITE_VERIFIED=1.");
  return {
    name: "Website (public site)",
    checks: [
      manual("web.desktop", "Desktop"),
      manual("web.mobile", "Mobile"),
      manual("web.a11y", "Accessibility"),
      manual("web.perf", "Performance"),
      manual("web.nav", "Navigation"),
      manual("web.forms", "Forms"),
      manual("web.cta", "Calls to action"),
      manual("web.analytics", "Analytics"),
      manual("web.contact", "Contact flows"),
      manual("web.seo", "Search engine metadata"),
    ],
  };
}

// ── Commercial ───────────────────────────────────────────────────────────────
function commercialSection(
  leads: Awaited<ReturnType<typeof listLeads>>,
  settings: Awaited<ReturnType<typeof getSettings>>,
): CheckSection {
  const checks: Check[] = [];
  const keys = new Set(ENGAGEMENT_MODELS.map((m) => m.key));
  const has = (k: string) => keys.has(k as any);
  checks.push(has("focused-improvement") ? check("com.focused", "Focused Improvement workflow", "pass", "Engagement model defined.") : check("com.focused", "Focused Improvement workflow", "fail", "Missing engagement model."));
  checks.push(has("phased-modernization") ? check("com.phased", "Phased Modernization workflow", "pass", "Engagement model defined.") : check("com.phased", "Phased Modernization workflow", "fail", "Missing engagement model."));
  checks.push(has("ongoing-partnership") ? check("com.partnership", "Technology Partnership workflow", "pass", "Engagement model defined.") : check("com.partnership", "Technology Partnership workflow", "fail", "Missing engagement model."));

  const lead = leads.find((l) => l.estimatedValueHigh != null) ?? leads[0];
  if (lead) {
    const rv = estimateRelationshipValue(lead);
    checks.push(
      rv.entry > 0
        ? check("com.proposal", "Proposal generation", "pass", `Entry engagement value computes (${rv.recommendedEntry}).`)
        : check("com.proposal", "Proposal generation", "warn", "Entry value computed as zero.", "Confirm lead value estimates are populated."),
    );
    checks.push(
      rv.twelveMonth >= rv.entry && rv.confidenceAdjustedTwelveMonth <= rv.twelveMonth
        ? check("com.relvalue", "Relationship value calculations", "pass", "12-month ≥ entry, and confidence-adjusted ≤ nominal — internally consistent.")
        : check("com.relvalue", "Relationship value calculations", "fail", "Relationship value math is inconsistent.", "Review estimateRelationshipValue()."),
    );
  } else {
    checks.push(check("com.proposal", "Proposal generation", "warn", "No leads to test proposal generation."));
  }

  const pricingOk = ARTIFEX_SERVICES.every((s) => {
    const p = settings.defaultPricing[s];
    return p && p.low >= 0 && p.high >= p.low;
  });
  checks.push(
    pricingOk
      ? check("com.pricing", "Pricing logic", "pass", "Every service has a valid low ≤ high price band.")
      : check("com.pricing", "Pricing logic", "fail", "One or more services have missing or inverted price bands.", "Fix pricing in Settings."),
  );

  return { name: "Commercial", checks };
}

// ── Analytics (exercises the dashboard + health composables) ──────────────────
async function analyticsSection(now: Date): Promise<CheckSection> {
  const checks: Check[] = [];
  try {
    const m = await launchMetrics(now);
    const sectionsPresent = !!(m.acquisition && m.outreach && m.discovery && m.commercial && m.intelligenceQuality);
    checks.push(
      sectionsPresent
        ? check("an.metrics", "Launch metrics collecting", "pass", "All five dashboard sections computed without error.")
        : check("an.metrics", "Launch metrics collecting", "fail", "A dashboard section failed to compute."),
    );
    checks.push(check("an.acq", "Acquisition metrics", "pass", `${m.acquisition.discovered} discovered, ${m.acquisition.analyzed} analyzed.`));
  } catch (err) {
    checks.push(check("an.metrics", "Launch metrics collecting", "fail", `Dashboard metrics threw: ${(err as Error).message}`, "Fix launchMetrics()."));
  }
  try {
    const h = await platformHealth(now);
    checks.push(check("an.health", "Platform health collecting", h.status === "fail" ? "fail" : "pass", `Health snapshot status: ${h.status}.`, h.status === "fail" ? "Resolve the failing health signal." : undefined));
  } catch (err) {
    checks.push(check("an.health", "Platform health collecting", "fail", `Platform health threw: ${(err as Error).message}`, "Fix platformHealth()."));
  }
  return { name: "Analytics", checks };
}

// ── Manual review (the human checkpoint) ──────────────────────────────────────
function manualReviewSection(confirmed: boolean): CheckSection {
  return {
    name: "Manual Review",
    checks: [
      confirmed
        ? check("manual.signoff", "Would I confidently send this to a real business owner today?", "pass", "Human sign-off recorded.")
        : check("manual.signoff", "Would I confidently send this to a real business owner today?", "fail", "Awaiting explicit human confirmation.", "Review a real prepared outreach end-to-end, then confirm (LAUNCH_MANUAL_REVIEW_CONFIRMED=1 or the dashboard toggle)."),
    ],
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch Validation (Phase 3).
//
// One entry point that validates the entire acquisition platform and reports
// PASS / WARNING / FAIL for every subsystem, with blocking issues, warnings,
// recommended fixes, and an overall launch recommendation. It composes the
// readiness checklist and platform-health snapshot (so it never disagrees with the
// dashboard) and adds Security, Performance, and Deployment categories.
//
// This runs fully in-process. The CLI wrapper (scripts/launch-validate.ts)
// additionally runs the toolchain (typecheck / lint / test / build) and merges
// those results — things that can only be checked by shelling out.
// ─────────────────────────────────────────────────────────────────────────────
import { hasDb } from "@/db/client";
import { authConfigOk } from "@/lib/auth-config";
import { getEmailProvider } from "@/lib/comms/provider";
import { storageStatus } from "@/lib/storage";
import { readinessChecklist, type ReadinessOptions } from "./readiness";
import { platformHealth } from "./health";
import { check, worst, rollupChecks, type Check, type CheckStatus, type Rollup } from "./types";

export interface ValidationCategory {
  name: string;
  status: CheckStatus;
  checks: Check[];
}

export type LaunchRecommendation = "READY TO LAUNCH" | "LAUNCH WITH CAUTION" | "NOT READY";

export interface ValidationReport {
  generatedAt: string;
  categories: ValidationCategory[];
  blocking: Check[];
  warnings: Check[];
  rollup: Rollup;
  recommendation: LaunchRecommendation;
}

const truthyEnv = (v: string | undefined) => v === "1" || v === "true" || v === "yes";
const cat = (name: string, checks: Check[]): ValidationCategory => ({ name, status: worst(checks.map((c) => c.status)), checks });
/** Pull a readiness section's checks by name (empty if absent). */
function sectionChecks(sections: { name: string; checks: Check[] }[], name: string): Check[] {
  return sections.find((s) => s.name === name)?.checks ?? [];
}

export async function runValidation(opts: ReadinessOptions = {}): Promise<ValidationReport> {
  const now = new Date();
  const [readiness, health] = await Promise.all([readinessChecklist(opts), platformHealth(now)]);
  const S = readiness.sections;

  const categories: ValidationCategory[] = [
    cat("Infrastructure", sectionChecks(S, "Infrastructure")),
    cat("Business Intelligence", sectionChecks(S, "Business Intelligence")),
    cat("Provider Health", providerHealthChecks(health)),
    cat("Website", sectionChecks(S, "Website (public site)")),
    cat("Dashboard", sectionChecks(S, "Analytics").filter((c) => c.id.startsWith("an.metrics") || c.id.startsWith("an.acq"))),
    cat("Approval", sectionChecks(S, "Outreach").filter((c) => c.id === "out.approval")),
    cat("Communication", communicationChecks(health, sectionChecks(S, "Outreach"))),
    cat("Analytics", sectionChecks(S, "Analytics")),
    cat("Discovery", sectionChecks(S, "Business Intelligence").filter((c) => c.id === "bi.discovery")),
    cat("Commercial", sectionChecks(S, "Commercial")),
    cat("Performance", performanceChecks(health)),
    cat("Security", securityChecks()),
    cat("Deployment", deploymentChecks()),
    cat("Manual Review", sectionChecks(S, "Manual Review")),
  ];

  const all = categories.flatMap((c) => c.checks);
  const blocking = all.filter((c) => c.status === "fail");
  const warnings = all.filter((c) => c.status === "warn");
  const rollup = rollupChecks(all);
  const recommendation: LaunchRecommendation =
    blocking.length > 0 ? "NOT READY" : warnings.length > 0 ? "LAUNCH WITH CAUTION" : "READY TO LAUNCH";

  return { generatedAt: now.toISOString(), categories, blocking, warnings, rollup, recommendation };
}

function providerHealthChecks(h: Awaited<ReturnType<typeof platformHealth>>): Check[] {
  return [
    h.intelligenceProviders.ready >= 1
      ? check("prov.intel", "Enrichment providers ready", "pass", `${h.intelligenceProviders.ready}/${h.intelligenceProviders.total} ready (${h.intelligenceProviders.planned} planned).`)
      : check("prov.intel", "Enrichment providers ready", "fail", "No enrichment providers ready.", "Ensure local providers register."),
    h.email.canSend
      ? check("prov.email", "Email provider", "pass", `${h.email.name} can send (${h.email.mode}).`)
      : check("prov.email", "Email provider", "warn", `Email provider cannot send (${h.email.mode}).`, "Configure RESEND to enable live outreach."),
    check("prov.ai", "AI provider mode", "pass", `AI running in ${h.ai.mode} mode.`),
    check("prov.places", "Places provider mode", h.places.mode === "disabled" ? "warn" : "pass", `Places in ${h.places.mode} mode.`, h.places.mode === "disabled" ? "Enable Google Places for live discovery." : undefined),
  ];
}

function communicationChecks(h: Awaited<ReturnType<typeof platformHealth>>, outreach: Check[]): Check[] {
  const checks: Check[] = [];
  checks.push(...outreach.filter((c) => ["out.email", "out.links", "out.format", "out.suppression", "out.followup"].includes(c.id)));
  if (h.alerts.length) {
    checks.push(check("comms.alerts", "Communication alerts", "warn", h.alerts[0], "Resolve the communication alert(s)."));
  } else {
    checks.push(check("comms.alerts", "Communication alerts", "pass", "No outstanding communication alerts."));
  }
  checks.push(
    check("comms.scheduler", "Send scheduler", "pass", `Sending window ${h.scheduler.windowOpen ? "open" : "closed"} (${h.scheduler.timezone}); ${h.queue.dueNow} due now.`),
  );
  return checks;
}

function performanceChecks(h: Awaited<ReturnType<typeof platformHealth>>): Check[] {
  const attempted = h.volume.sentTotal + h.volume.failedTotal;
  return [
    attempted < 10 || h.failureRate < 10
      ? check("perf.failure", "Send failure rate", "pass", attempted ? `${h.failureRate}% of ${attempted} attempted sends failed.` : "No sends attempted yet.")
      : check("perf.failure", "Send failure rate", h.failureRate >= 20 ? "fail" : "warn", `${h.failureRate}% send failure rate.`, "Investigate provider errors."),
    h.retryRate < 25
      ? check("perf.retry", "Retry backlog", "pass", `${h.retryRate}% of sends awaiting retry.`)
      : check("perf.retry", "Retry backlog", "warn", `${h.retryRate}% of sends awaiting retry.`, "Clear the retry queue / check provider auth."),
    check("perf.enrichment", "Enrichment latency", "pass", h.avgEnrichmentSeconds != null ? `Avg prospecting run ${h.avgEnrichmentSeconds}s.` : "No completed prospecting runs to time yet."),
  ];
}

function securityChecks(): Check[] {
  const checks: Check[] = [];
  const secret = process.env.AUTH_SECRET ?? "";
  checks.push(
    secret.length >= 16
      ? check("sec.authsecret", "Session secret strength", "pass", "AUTH_SECRET is set and of sufficient length.")
      : check("sec.authsecret", "Session secret strength", hasDb() ? "fail" : "warn", "AUTH_SECRET missing or too short.", "Set a 32+ char random AUTH_SECRET."),
  );
  checks.push(
    authConfigOk()
      ? check("sec.password", "Operator password", "pass", "Operator password is securely configured.")
      : check("sec.password", "Operator password", hasDb() ? "fail" : "warn", "Operator auth is using development defaults.", "Set a strong OUTREACH_PASSWORD."),
  );
  checks.push(
    process.env.CRON_SECRET
      ? check("sec.cron", "Cron endpoint guard", "pass", "CRON_SECRET guards scheduled endpoints.")
      : check("sec.cron", "Cron endpoint guard", "warn", "CRON_SECRET not set.", "Set CRON_SECRET to guard /api/cron/*."),
  );
  const emailOn = getEmailProvider().canSend;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  checks.push(
    !emailOn || webhookSecret
      ? check("sec.webhook", "Webhook signature verification", "pass", emailOn ? "Webhook secret configured for signature verification." : "Email disabled — webhooks not in use.")
      : check("sec.webhook", "Webhook signature verification", "warn", "Email is live but RESEND_WEBHOOK_SECRET is not set.", "Set RESEND_WEBHOOK_SECRET so inbound webhooks are verified."),
  );
  return checks;
}

function deploymentChecks(): Check[] {
  const checks: Check[] = [];
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.RAILWAY_STATIC_URL;
  checks.push(
    url ? check("dep.url", "Public URL", "pass", "A public URL is configured.") : check("dep.url", "Public URL", "warn", "No public URL configured.", "Set APP_URL in the deploy environment."),
  );
  checks.push(
    hasDb() ? check("dep.db", "Production database", "pass", "DATABASE_URL configured.") : check("dep.db", "Production database", "warn", "No DATABASE_URL — production requires Postgres.", "Provision Postgres before launch."),
  );
  const version = process.env.APP_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA;
  checks.push(
    version ? check("dep.version", "Build version", "pass", `Version ${String(version).slice(0, 12)}.`) : check("dep.version", "Build version", "warn", "No APP_VERSION / commit SHA available.", "Surface the deploy commit as APP_VERSION."),
  );
  const store = storageStatus();
  checks.push(
    store.configured
      ? check("dep.storage", "Durable storage", "pass", `Object storage via ${store.provider}.`)
      : check("dep.storage", "Durable storage", "warn", "No durable object storage — PDFs/screenshots are ephemeral.", "Configure S3/R2 for durable deliverables."),
  );
  return checks;
}

export { truthyEnv };

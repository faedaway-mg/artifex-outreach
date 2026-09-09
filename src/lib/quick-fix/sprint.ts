// ─────────────────────────────────────────────────────────────────────────────
// QUICK-CASH SPRINT / GRADUATION — Quick-Cash is a finite bridge, not the
// destination. This is the scoreboard toward the graduation targets:
//   20 completed jobs = checkpoint · 50 completed jobs = graduation.
// It also models reference readiness (permission-gated — never auto-claims a
// testimonial or public name), a capability-evidence handoff (commercial evidence,
// honestly classed, NEVER auto-claimed as government past performance), and
// recurring-candidate tracking (never forces a subscription). All pure/deterministic
// from real counts — no fabricated goals-achieved.
// ─────────────────────────────────────────────────────────────────────────────

export const SPRINT_CHECKPOINT = 20;
export const SPRINT_GRADUATION = 50;

export interface SprintJob {
  offerId: string;
  state: string; // JobState
  priceCents: number;
  skuFamily?: string | null;
  deliveredAt?: string | null;
  /** Real completion evidence (before/after/test) is persisted for this job. */
  hasCompletionEvidence?: boolean;
  /** True → a demo/seed job. HARD-excluded from every scoreboard number. */
  isDemo?: boolean;
}

export interface SprintCustomer {
  leadId: string;
  purchases: number;
  lifetimeRevenueCents: number;
  maintenancePlanKey?: string | null;
  /** A successfully-delivered job exists for this customer. */
  hasCompletedJob?: boolean;
  /** Customer explicitly approved serving as a reference (permission, not eligibility). */
  referenceApproved?: boolean;
  /** True → this customer's only jobs are demo jobs. Excluded from real customer counts. */
  isDemo?: boolean;
}

export interface SprintScoreboard {
  completedJobs: number;
  checkpoint: number;
  graduation: number;
  progressToGraduation: number; // 0..1
  reachedCheckpoint: boolean;
  graduated: boolean;
  grossRevenueCents: number;
  refundsCents: number;
  avgTicketCents: number | null;
  repeatCustomers: number;
  recurringCustomers: number;
  referenceReady: number;      // eligible (has a completed job)
  referencesApproved: number;  // permission actually granted
  capabilityProofs: number;    // jobs with real completion evidence
  playbooksProven: number;     // distinct SKU families proven in real delivery
}

const COMPLETED = new Set(["COMPLETE"]);
const DELIVERED_OR_DONE = new Set(["DELIVERED", "COMPLETE"]);

/** Build the scoreboard from real jobs + customers. Never fabricates progress.
 *  DEMO jobs (isDemo === true) and demo-only customers are HARD-excluded from every
 *  number here — a demonstration must never inflate the real money loop. */
export function buildSprintScoreboard(jobs: SprintJob[], customers: SprintCustomer[], refundsCents = 0): SprintScoreboard {
  const realJobs = jobs.filter((j) => j.isDemo !== true);
  const realCustomers = customers.filter((c) => c.isDemo !== true);
  const completed = realJobs.filter((j) => COMPLETED.has(j.state));
  const completedJobs = completed.length;
  const grossRevenueCents = completed.reduce((n, j) => n + (j.priceCents || 0), 0);
  const proofs = realJobs.filter((j) => DELIVERED_OR_DONE.has(j.state) && j.hasCompletionEvidence);
  const playbooks = new Set(proofs.map((j) => j.skuFamily).filter(Boolean));

  return {
    completedJobs,
    checkpoint: SPRINT_CHECKPOINT,
    graduation: SPRINT_GRADUATION,
    progressToGraduation: Math.min(1, completedJobs / SPRINT_GRADUATION),
    reachedCheckpoint: completedJobs >= SPRINT_CHECKPOINT,
    graduated: completedJobs >= SPRINT_GRADUATION,
    grossRevenueCents,
    refundsCents,
    avgTicketCents: completedJobs > 0 ? Math.round(grossRevenueCents / completedJobs) : null,
    repeatCustomers: realCustomers.filter((c) => (c.purchases ?? 0) >= 2).length,
    recurringCustomers: realCustomers.filter((c) => !!c.maintenancePlanKey).length,
    referenceReady: realCustomers.filter((c) => !!c.hasCompletedJob).length,
    referencesApproved: realCustomers.filter((c) => !!c.referenceApproved).length,
    capabilityProofs: proofs.length,
    playbooksProven: playbooks.size,
  };
}

// ── Reference readiness — eligibility is NOT permission ───────────────────────────
export interface ReferenceReadiness {
  eligible: boolean;         // a successful completed job exists
  permissionGranted: boolean; // the customer explicitly agreed
  mayNamePublicly: boolean;  // only when permission granted
  note: string;
}

export function referenceReadiness(c: SprintCustomer): ReferenceReadiness {
  const eligible = !!c.hasCompletedJob;
  const permissionGranted = !!c.referenceApproved;
  return {
    eligible,
    permissionGranted,
    mayNamePublicly: eligible && permissionGranted,
    note: eligible ? (permissionGranted ? "reference approved — quotable per recorded permission" : "eligible, but NO permission yet — do not name, quote, or email a request automatically") : "not eligible — no completed job",
  };
}

// ── Capability evidence handoff — COMMERCIAL, honestly classed ─────────────────────
export type EvidenceClass = "PROVEN" | "AVAILABLE" | "PLANNED";

export interface CapabilityEvidence {
  capability: string;   // SKU family / capability label
  klass: EvidenceClass; // PROVEN only when real completion evidence exists
  evidenceType: "COMMERCIAL"; // never labeled as government past performance
  isGovernmentPastPerformance: false; // explicit: commercial ≠ gov past performance
  note: string;
}

/**
 * Turn completed jobs into capability-evidence records for the existing GovCon
 * evidence library. PROVEN requires real completion evidence; delivered-without-
 * evidence is AVAILABLE; anything short is PLANNED. Always COMMERCIAL — never
 * auto-claims it satisfies a solicitation's past-performance requirement.
 */
export function capabilityEvidenceExport(jobs: SprintJob[]): CapabilityEvidence[] {
  const byFamily = new Map<string, SprintJob[]>();
  for (const j of jobs) {
    const fam = j.skuFamily ?? "unknown";
    (byFamily.get(fam) ?? byFamily.set(fam, []).get(fam)!).push(j);
  }
  const out: CapabilityEvidence[] = [];
  for (const [fam, js] of byFamily) {
    const proven = js.some((j) => DELIVERED_OR_DONE.has(j.state) && j.hasCompletionEvidence);
    const available = !proven && js.some((j) => DELIVERED_OR_DONE.has(j.state));
    const klass: EvidenceClass = proven ? "PROVEN" : available ? "AVAILABLE" : "PLANNED";
    out.push({
      capability: fam,
      klass,
      evidenceType: "COMMERCIAL",
      isGovernmentPastPerformance: false,
      note: `${klass} from commercial Quick-Fix delivery (${js.length} job${js.length === 1 ? "" : "s"}). Commercial reference/evidence — NOT government past performance.`,
    });
  }
  return out;
}

// ── Recurring candidate — track, never force a subscription ────────────────────────
export interface RecurringCandidate {
  isCandidate: boolean;
  reason: string;
}

export function recurringCandidate(c: SprintCustomer): RecurringCandidate {
  if (!c.hasCompletedJob) return { isCandidate: false, reason: "no successful delivery yet" };
  if ((c.purchases ?? 0) >= 2) return { isCandidate: true, reason: "repeat purchaser — an ongoing relationship is evidenced" };
  if (c.maintenancePlanKey) return { isCandidate: false, reason: "already on a recurring plan" };
  return { isCandidate: (c.purchases ?? 0) >= 1, reason: (c.purchases ?? 0) >= 1 ? "successful first delivery — a maintenance relationship may fit (do not upsell aggressively)" : "no purchase history" };
}

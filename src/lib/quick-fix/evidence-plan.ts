// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE PLAN — what SHOULD be captured to PROVE a finding, before any capture.
//
// §16/§18/§19. A pure, deterministic planning layer that runs BEFORE screenshots
// are taken. Given a finding (or an ad-hoc scope), it describes:
//   • the user PATH we are proving (what a visitor would do / see),
//   • which page/state matters,
//   • whether desktop, mobile, or BOTH viewports are required to back the claim,
//   • what EACH expected shot must demonstrate (its purpose).
//
// The point is truth-before-capture: a finding that talks about the MOBILE / phone
// / responsive experience REQUIRES a mobile shot — you cannot prove a mobile claim
// with a desktop screenshot. evidencePlanSatisfied() then checks a set of AVAILABLE
// shots against the plan and reports exactly which required viewports are missing,
// so a mobile claim with no mobile shot is UNSATISFIED (§19).
//
// This module performs NO I/O and NO capture — it only decides what proof is owed.
// ─────────────────────────────────────────────────────────────────────────────

/** The viewport a shot is taken at — mirrors EvidenceScreenshot.viewport. */
export type PlanViewport = "mobile" | "desktop";

/** One screenshot the plan expects, with the reason it must exist. */
export interface ExpectedShot {
  /** Stable within a plan — e.g. "mobile:homepage". */
  key: string;
  /** Which viewport this shot must be captured at. */
  viewport: PlanViewport;
  /** Plain page/state label the shot should show (e.g. "Your homepage"). */
  pageLabel: string;
  /** What this specific shot must demonstrate to back the claim. */
  demonstrates: string;
  /** True when the plan cannot be satisfied without this shot. */
  required: boolean;
}

/** A deterministic description of the proof a claim is owed. */
export interface EvidencePlan {
  /** The finding id this plan proves, or null for an ad-hoc scope. */
  findingId: string | null;
  /** The visitor path / experience we are proving. */
  userPath: string;
  /** The page/state that matters for this claim. */
  page: string;
  /** Viewports that MUST be captured for the plan to be satisfiable. */
  requiredViewports: PlanViewport[];
  /** The shots we expect to capture (required + supporting), usually 2–5. */
  expectedShots: ExpectedShot[];
  /** True when the claim is specifically about the mobile/phone experience. */
  mobileClaim: boolean;
}

/** The minimal finding shape the planner reads. */
export interface PlannableFinding {
  id?: string | null;
  observation?: string | null;
  whyItMatters?: string | null;
  /** Some callers carry a plain restatement — folded into the text signal too. */
  plain?: string | null;
}

/** An ad-hoc planning scope (no finding object) — §18. */
export interface PlanScope {
  /** Free text describing the claim/experience being proven. */
  claim: string;
  /** Optional explicit page/state; defaults to the homepage. */
  page?: string;
  /** Optional id to attribute the plan to. */
  id?: string | null;
}

const MOBILE_SIGNAL = /\bmobile\b|\bphone\b|\bsmall screen\b|\bresponsive\b|\bhandheld\b|\btouch\b/i;

function isFinding(x: PlannableFinding | PlanScope): x is PlannableFinding {
  return typeof (x as PlanScope).claim !== "string";
}

/** Collapse the finding/scope into one lowercased text signal used for detection. */
function textSignal(input: PlannableFinding | PlanScope): string {
  if (isFinding(input)) {
    return `${input.observation ?? ""} ${input.whyItMatters ?? ""} ${input.plain ?? ""}`.toLowerCase();
  }
  return `${input.claim ?? ""}`.toLowerCase();
}

/**
 * Build the evidence plan for a finding or an ad-hoc scope. PURE + deterministic.
 *
 * Rules:
 *   • A mobile/phone/responsive claim REQUIRES a mobile shot (§19). Because the
 *     desktop presentation is the baseline a mobile problem is compared against, we
 *     also expect a desktop shot for contrast — so a mobile claim requires MOBILE
 *     and expects both viewports.
 *   • Any other claim is proven on desktop by default, with mobile as a supporting
 *     (non-required) shot so the same page is shown on a phone too.
 *   • expectedShots is always 2–5 entries.
 */
export function buildEvidencePlan(input: PlannableFinding | PlanScope): EvidencePlan {
  const finding = isFinding(input);
  const findingId = finding ? (input.id ?? null) : (input.id ?? null);
  const signal = textSignal(input);
  const mobileClaim = MOBILE_SIGNAL.test(signal);

  const page = (!finding && input.page) ? input.page : "Your homepage";
  const userPath = mobileClaim
    ? `A visitor opens ${lower(page)} on their phone and tries to take the next step.`
    : `A visitor lands on ${lower(page)} and tries to take the next step.`;

  const shots: ExpectedShot[] = [];

  if (mobileClaim) {
    // The claim is about the phone experience — the MOBILE shot is the proof.
    shots.push({
      key: "mobile:page",
      viewport: "mobile",
      pageLabel: `${page} on a phone`,
      demonstrates: "The mobile experience the claim is about — the phone view that proves the problem.",
      required: true,
    });
    // Desktop is the contrast baseline (how the same page reads on a computer).
    shots.push({
      key: "desktop:page",
      viewport: "desktop",
      pageLabel: `${page} on a computer`,
      demonstrates: "The desktop view of the same page, for contrast against the phone experience.",
      required: false,
    });
  } else {
    // A general claim is proven on the desktop view of the page.
    shots.push({
      key: "desktop:page",
      viewport: "desktop",
      pageLabel: `${page} on a computer`,
      demonstrates: "The desktop view of the page where the problem appears — the primary proof.",
      required: true,
    });
    // Show the same page on a phone as supporting (non-required) evidence.
    shots.push({
      key: "mobile:page",
      viewport: "mobile",
      pageLabel: `${page} on a phone`,
      demonstrates: "The same page on a phone, so the finding is shown across both viewports.",
      required: false,
    });
  }

  const requiredViewports = uniqueViewports(shots.filter((s) => s.required).map((s) => s.viewport));

  return {
    findingId,
    userPath,
    page,
    requiredViewports,
    expectedShots: shots,
    mobileClaim,
  };
}

/** A shot the caller actually HAS available, for satisfaction checking. */
export interface AvailableShot {
  viewport: PlanViewport;
  /** True only when a real READY stored image backs this shot. */
  ready: boolean;
}

export interface PlanSatisfaction {
  satisfied: boolean;
  /** The required viewports that have no READY available shot. */
  missing: PlanViewport[];
}

/**
 * Check a plan against the shots we actually have. A plan is SATISFIED only when
 * every REQUIRED viewport has a corresponding READY available shot. So a mobile
 * claim with no mobile shot is unsatisfied, listing "mobile" as missing (§19).
 * Non-ready shots do not count. Deterministic.
 */
export function evidencePlanSatisfied(plan: EvidencePlan, availableShots: AvailableShot[]): PlanSatisfaction {
  const readyViewports = new Set(availableShots.filter((s) => s.ready).map((s) => s.viewport));
  const missing = plan.requiredViewports.filter((v) => !readyViewports.has(v));
  return { satisfied: missing.length === 0, missing };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function uniqueViewports(vps: PlanViewport[]): PlanViewport[] {
  const seen = new Set<PlanViewport>();
  const out: PlanViewport[] = [];
  for (const v of vps) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}

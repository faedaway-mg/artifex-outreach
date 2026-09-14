// ─────────────────────────────────────────────────────────────────────────────
// The canonical qualification FUNNEL. The scanner runs a candidate through these
// stages IN ORDER and only a PROVEN, live-verified material problem continues:
//
//   geo gate → identity/ICP → closed check → cheap anomaly scan → hypothesis →
//   LIVE adversarial browser counter-test → Problem-Reality verdict → decision.
//
// Anything DISPROVEN / NO_MATERIAL_PROBLEM / NEEDS_MORE_EVIDENCE / wrong-geo /
// wrong-ICP / closed is REJECTED with a structured reason (never downgraded into a
// weaker finding, never sent to package production, never left for the operator to
// clean up). Pure except for the injected counter-test runner, so it is testable.
// ─────────────────────────────────────────────────────────────────────────────
import { geoGate } from "../geo/lead-sprint";
import { icpFit } from "./icp";
import { deriveHypotheses } from "../problem-reality/hypothesis";
import type { CounterTestRunner } from "../problem-reality/runner";
import type { ProblemReality, ProblemRealityStatus, CounterTestExecution, ProblemHypothesis } from "../problem-reality/types";
import type { RejectionCategory } from "../rejection";

export interface FunnelCandidate {
  id: string;
  businessName: string;
  industry: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  businessStatus?: string | null;
  locationsCount?: number | null;
  normalizedName?: string | null;
  /** Cheap anomaly signals (from a light fetch / Places) — no browser. */
  signals?: { hasWebsite?: boolean; mobileFriendly?: boolean; hasOnlineBooking?: boolean; hasLeadForm?: boolean; slowLoad?: boolean };
}

export type FunnelStage = "geo" | "icp" | "closed" | "no-website" | "anomaly" | "counter-test";

export interface FunnelResult {
  candidateId: string;
  businessName: string;
  decision: "promote" | "reject";
  stageReached: FunnelStage;
  category?: RejectionCategory;   // set when rejected
  reason: string;
  /** The Problem-Reality verdict when the counter-test ran (PROVEN / OBSERVED / …). */
  verdict?: ProblemRealityStatus;
  /** Canonical route. OBSERVED is CONVERSATION-only; PROVEN is routed by strategy downstream. */
  route?: "DIRECT_FIX" | "FIX_SCAN" | "CONVERSATION";
  hypothesis?: ProblemHypothesis;
  execution?: CounterTestExecution;
  problemReality?: ProblemReality;
}

const CLOSED = new Set(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]);

/** Map a counter-test verdict to a rejection category (for aggregation). */
function categoryFor(status: ProblemRealityStatus): RejectionCategory {
  switch (status) {
    case "DISPROVEN": return "problem-disproven";
    case "NO_MATERIAL_PROBLEM": return "no-material-problem";
    case "NEEDS_MORE_EVIDENCE": return "needs-more-evidence";
    default: return "other";
  }
}

export async function qualifyThroughFunnel(
  candidate: FunnelCandidate,
  runner: CounterTestRunner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FunnelResult> {
  const base = { candidateId: candidate.id, businessName: candidate.businessName };

  // 1) GEO GATE
  const geo = geoGate({ city: candidate.city, state: candidate.state }, env);
  if (!geo.allowed) return { ...base, decision: "reject", stageReached: "geo", category: "wrong-geography", reason: geo.reason };

  // 2) IDENTITY / ICP
  const icp = icpFit(candidate);
  if (!icp.fit) return { ...base, decision: "reject", stageReached: "icp", category: "wrong-icp", reason: icp.reason };

  // 3) CLOSED
  if (candidate.businessStatus && CLOSED.has(candidate.businessStatus)) {
    return { ...base, decision: "reject", stageReached: "closed", category: "closed", reason: `business_status=${candidate.businessStatus}` };
  }

  // 3b) No website ⇒ not testable in the browser loop (routed elsewhere, not here).
  if (!candidate.website || candidate.signals?.hasWebsite === false) {
    return { ...base, decision: "reject", stageReached: "no-website", category: "unreachable", reason: "no website to run a live counter-test against" };
  }

  // 4) CHEAP ANOMALY SCAN → HYPOTHESIS (no browser). Prefer the signal that looks
  //    weakest; else fall back to the industry's expected primary action.
  const [hypothesis] = deriveHypotheses({ id: candidate.id, industry: candidate.industry, website: candidate.website }, anomalyFindings(candidate));

  // 5) LIVE COUNTER-TEST (the reality test — the scan performs it via the runner)
  const execution = await runner.run(hypothesis);
  const status = execution.executed ? execution.verdict : "NEEDS_MORE_EVIDENCE";
  const problemReality: ProblemReality = {
    hypothesis, status,
    execution,
    basis: execution.executed ? "live-counter-test" : "not-executed",
    decidedAt: new Date().toISOString(),
  };

  // 6) DECISION — ONLY PROVEN is outreach-eligible (canonical doctrine). OBSERVED is a
  //    real-but-unprovable condition: it is preserved for internal research/retesting but
  //    NEVER creates outreach/active work — we do not contact a business to discover whether
  //    an observation is actually a problem. Everything else rejects.
  if (status === "PROVEN" && execution.executed) {
    return { ...base, decision: "promote", stageReached: "counter-test", verdict: status, reason: execution.rationale, hypothesis, execution, problemReality };
  }
  return { ...base, decision: "reject", stageReached: "counter-test", verdict: status, category: categoryFor(status), reason: execution.rationale || `verdict ${status}`, hypothesis, execution, problemReality };
}

/** Turn cheap signals into finding-shaped seeds for hypothesis derivation. */
function anomalyFindings(c: FunnelCandidate): Array<{ id: string; title: string; category?: string }> {
  const s = c.signals ?? {};
  const out: Array<{ id: string; title: string; category?: string }> = [];
  if (s.hasOnlineBooking === false) out.push({ id: `${c.id}-book`, title: "No online booking detected", category: "Conversion journey" });
  if (s.hasLeadForm === false) out.push({ id: `${c.id}-form`, title: "No contact/lead form detected", category: "Conversion journey" });
  if (s.mobileFriendly === false) out.push({ id: `${c.id}-mobile`, title: "Primary action hard to reach on mobile", category: "Mobile usability" });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Review — regeneration ADAPTER (M2 Gate 4).
//
// A production regeneration path built on the SAME model infrastructure as the rest of the app
// (`providers/ai.ts`): provider selection (mock | openai | anthropic), schema validation, retry,
// mock fallback, cost logging, and an honest `meta.provider`. Its job is to propose alternative
// copy for ONE review field, constrained to the finding's evidence.
//
// Safety contract:
//   • EVIDENCE-CONSTRAINED — the output may only contain numbers present in the finding's evidence;
//     any figure the model (or the operator's direction) introduces that the evidence can't support
//     is rejected (fail closed) rather than shipped.
//   • NO SPEND BY DEFAULT — a live (paid) call runs ONLY when REGEN_LIVE_ENABLED=1 AND a real
//     provider is configured. Otherwise the deterministic OFFLINE generator runs and is reported
//     honestly as provider="mock" — canned copy is never presented as live model output.
//   • STATES — every call resolves to a "succeeded" (with text) or "failed" (with a reason) result;
//     the caller records both and never auto-approves or sends a proposal.
// ─────────────────────────────────────────────────────────────────────────────
import { aiMode, generateConstrainedText } from "../providers/ai";

export const REGEN_PROMPT_VERSION = "review-regen-1.0.0";

const NUM_RX = /\b\d[\d,]*(?:\.\d+)?\+?\b/g;
function digitsOf(s: string): string[] {
  return (s.match(NUM_RX) ?? []).map((n) => n.replace(/[,+]/g, ""));
}

/** Deterministic, offline rewrite grounded in the evidence: strips any number in the operator's
 *  direction that the evidence can't support, then composes a grounded alternative. Never invents. */
export function deterministicRegen(current: string, evidenceContext: string, direction?: string): string {
  const allowed = new Set(digitsOf(evidenceContext));
  const cleanDir = (direction ?? "")
    .replace(NUM_RX, (m) => (allowed.has(m.replace(/[,+]/g, "")) ? m : ""))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/, "");
  const base = current.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  return cleanDir ? `${cleanDir} — ${base}.` : `${base}.`;
}

export type RegenStatus = "succeeded" | "failed";
export interface RegenProviderResult {
  status: RegenStatus;
  text: string | null;
  provider: "mock" | "openai" | "anthropic";
  model: string;
  promptVersion: string;
  reason?: string;
}
export interface RegenProviderInput {
  current: string;
  /** The ONLY facts the rewrite may rely on — the finding's observation + evidence basis. */
  evidenceContext: string;
  direction?: string;
  fieldLabel: string;
}

/** Is a LIVE (paid) regeneration call authorized here? OFF by default — no spend this milestone. */
export function liveRegenEnabled(): boolean {
  return process.env.REGEN_LIVE_ENABLED === "1" && aiMode().mode !== "mock";
}

/** Output must not introduce a number absent from the evidence (applies to mock AND live output). */
function introducesUnsupportedNumber(text: string, evidenceContext: string): boolean {
  const allowed = new Set(digitsOf(evidenceContext));
  return digitsOf(text).some((n) => !allowed.has(n));
}

export async function regenerateReviewCopy(input: RegenProviderInput): Promise<RegenProviderResult> {
  // Default / unauthorized: deterministic offline generator, reported honestly as mock.
  if (!liveRegenEnabled()) {
    const text = deterministicRegen(input.current, input.evidenceContext, input.direction);
    return { status: "succeeded", text, provider: "mock", model: "artifex-mock-analyst-v1", promptVersion: REGEN_PROMPT_VERSION };
  }
  // LIVE path — only reached when explicitly authorized + a real provider configured.
  try {
    const { text, meta } = await generateConstrainedText({
      user: `Rewrite the "${input.fieldLabel}" of a small-business review. Keep it calm, specific, and TRUTHFUL. Use ONLY the facts in the evidence below — do not introduce any statistic, number, or absolute absence claim ("no", "never", "none") that is not supported by that evidence.

EVIDENCE (the only facts you may rely on):
${input.evidenceContext}

CURRENT TEXT:
${input.current}

OPERATOR DIRECTION (optional): ${input.direction ?? "(none)"}`,
      promptVersion: REGEN_PROMPT_VERSION,
      refs: ["finding-evidence"],
      mock: () => deterministicRegen(input.current, input.evidenceContext, input.direction),
    });
    const provider = (meta.provider as RegenProviderResult["provider"]) ?? "mock";
    // Fail closed if the generated copy introduced an unsupported number.
    if (introducesUnsupportedNumber(text, input.evidenceContext)) {
      return { status: "failed", text: null, provider, model: meta.model, promptVersion: REGEN_PROMPT_VERSION, reason: "generated copy introduced a numeric claim the evidence can't support" };
    }
    return { status: "succeeded", text, provider, model: meta.model, promptVersion: REGEN_PROMPT_VERSION };
  } catch {
    const m = aiMode();
    return { status: "failed", text: null, provider: m.mode, model: m.model, promptVersion: REGEN_PROMPT_VERSION, reason: "regeneration provider error" };
  }
}

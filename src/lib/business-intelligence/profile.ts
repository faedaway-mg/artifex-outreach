// ─────────────────────────────────────────────────────────────────────────────
// Business Intelligence Profile — assembler.
//
// Runs every registered signal against the context, groups readings into the four
// dimensions, scores and rolls each up, derives categorized opportunities, and
// writes a deterministic executive summary. The result is the single structured
// understanding every other system consumes.
//
// Pure and deterministic: same inputs → byte-identical output. `generatedAt` is
// null; a caller stamps it when persisting.
// ─────────────────────────────────────────────────────────────────────────────
import { buildContext } from "./context";
import { SIGNALS_BY_DIMENSION } from "./signals";
import { deriveOpportunities } from "./opportunities";
import { aggregate, type Confidence } from "./confidence";
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  STATUS_HEALTH,
  type BusinessProfile,
  type Dimension,
  type DimensionReport,
  type ProfileContext,
  type ProfileInput,
  type SignalReading,
} from "./types";
import type { ConversationInput } from "../conversation-engine";

export function buildBusinessProfile(input: ProfileInput): BusinessProfile {
  const ctx = buildContext(input);

  // 1) Evaluate signals per dimension (skipping those with no basis).
  const dimensions = {} as Record<Dimension, DimensionReport>;
  const allReadings: SignalReading[] = [];
  for (const dim of DIMENSIONS) {
    const signals = SIGNALS_BY_DIMENSION[dim];
    const readings = signals.map((s) => s.evaluate(ctx)).filter((r): r is SignalReading => r !== null);
    allReadings.push(...readings);
    dimensions[dim] = buildDimensionReport(dim, readings, signals.length);
  }

  // 2) Opportunities from the readings.
  const opportunities = deriveOpportunities(ctx, allReadings);

  // 3) Strengths — only directly-observed positives.
  const strengths = deriveStrengths(ctx, allReadings);

  // 4) Executive narrative.
  const { headline, executiveSummary } = writeExecutive(ctx, dimensions, opportunities, strengths);

  return {
    leadId: ctx.lead.id,
    businessName: ctx.lead.businessName,
    industry: ctx.lead.industry,
    generatedAt: null,
    presence: ctx.presence,
    dimensions,
    strengths,
    opportunities,
    headline,
    executiveSummary,
    evidenceConfidence: computeEvidenceConfidence(ctx, allReadings),
    conversationInput: buildConversationInput(ctx, opportunities, allReadings),
    provenance: buildProvenance(ctx),
    coverage: DIMENSIONS.map((d) => ({ dimension: d, measured: dimensions[d].measured, total: dimensions[d].total })),
  };
}

// ── dimension roll-up ──────────────────────────────────────────────────────────
function buildDimensionReport(dimension: Dimension, readings: SignalReading[], total: number): DimensionReport {
  const measurable = readings.filter((r) => STATUS_HEALTH[r.status] !== null);
  const score = measurable.length ? Math.round((measurable.reduce((s, r) => s + (STATUS_HEALTH[r.status] as number), 0) / measurable.length) * 100) : null;
  const confidence: Confidence = aggregate(readings.map((r) => r.confidence));
  return {
    dimension,
    label: DIMENSION_LABELS[dimension],
    readings,
    score,
    confidence,
    summary: summarizeDimension(dimension, readings, score),
    measured: measurable.length,
    total,
  };
}

function summarizeDimension(dimension: Dimension, readings: SignalReading[], score: number | null): string {
  const label = DIMENSION_LABELS[dimension];
  if (!readings.length) return `${label}: nothing could be assessed from available data.`;
  const strong = readings.filter((r) => r.status === "strong").length;
  const weak = readings.filter((r) => r.status === "weak" || r.status === "absent").length;
  const scoreBit = score === null ? "not scorable" : `${score}/100`;
  const parts: string[] = [`${label} scores ${scoreBit}`];
  if (strong) parts.push(`${strong} strength${strong > 1 ? "s" : ""}`);
  if (weak) parts.push(`${weak} gap${weak > 1 ? "s" : ""}`);
  return `${parts.join(", ")}.`;
}

// ── strengths ─────────────────────────────────────────────────────────────────
function deriveStrengths(ctx: ProfileContext, readings: SignalReading[]): string[] {
  const out: string[] = [];
  const p = ctx.presence;
  if (p.reviews.strength === "strong") out.push(`Excellent reputation — ${p.reviews.rating}★ across ${p.reviews.count} reviews.`);
  for (const r of readings) {
    if (r.status === "strong" && (r.confidence.label === "Observed" || r.confidence.label === "Likely")) out.push(r.summary);
  }
  return dedupe(out).slice(0, 4);
}

// ── executive narrative (deterministic) ─────────────────────────────────────────
function writeExecutive(
  ctx: ProfileContext,
  dimensions: Record<Dimension, DimensionReport>,
  opportunities: BusinessProfile["opportunities"],
  strengths: string[],
): { headline: string; executiveSummary: string } {
  const name = ctx.lead.businessName;
  const scored = DIMENSIONS.map((d) => dimensions[d]).filter((r) => r.score !== null) as Array<DimensionReport & { score: number }>;
  const strongest = [...scored].sort((a, b) => b.score - a.score)[0];
  const weakest = [...scored].sort((a, b) => a.score - b.score)[0];
  const top = opportunities[0];

  const headline = top
    ? `${name}: ${top.category.toLowerCase()} is the clearest opportunity (${top.estimatedImpact.level.toLowerCase()} impact).`
    : `${name}: an early-stage online footprint with room to establish the basics.`;

  const bits: string[] = [];
  bits.push(`${name} presents as ${describePresence(ctx)}.`);
  if (strongest && weakest && strongest !== weakest) bits.push(`It's strongest on ${strongest.label.toLowerCase()} (${strongest.score}/100) and has the most room in ${weakest.label.toLowerCase()} (${weakest.score}/100).`);
  else if (strongest) bits.push(`Its ${strongest.label.toLowerCase()} scores ${strongest.score}/100.`);
  if (strengths.length) bits.push(`Worth acknowledging first: ${lowerFirst(strengths[0])}`);
  if (top) bits.push(`The highest-leverage opportunity is ${top.category.toLowerCase()} — ${lowerFirst(top.whyItMatters)}`);
  bits.push(`Every inference above is confidence-scored; internal operations must be confirmed in conversation.`);
  return { headline, executiveSummary: bits.join(" ") };
}

function describePresence(ctx: ProfileContext): string {
  const p = ctx.presence;
  const rep = p.reviews.strength === "strong" || p.reviews.strength === "solid" ? ` with a ${p.reviews.rating}★ reputation` : "";
  return `${p.primaryChannel}${rep}`;
}

// ── evidence confidence ─────────────────────────────────────────────────────────
function computeEvidenceConfidence(ctx: ProfileContext, readings: SignalReading[]): number {
  // Reuse the engine's evidence confidence when we have it — one source of truth.
  if (ctx.improvement) return ctx.improvement.dimensions.evidenceConfidence;
  if (!readings.length) return 0;
  const meanConf = readings.reduce((s, r) => s + r.confidence.score, 0) / readings.length;
  const totalSignals = DIMENSIONS.reduce((n, d) => n + SIGNALS_BY_DIMENSION[d].length, 0);
  const measurable = readings.filter((r) => r.confidence.label !== "Unknown").length;
  const coverage = measurable / totalSignals;
  return Math.round(Math.min(100, (meanConf * 0.6 + coverage * 0.4) * 100));
}

// ── conversation input — the single analytical source for the call opening ───────
function buildConversationInput(ctx: ProfileContext, opportunities: BusinessProfile["opportunities"], readings: SignalReading[]): ConversationInput {
  // A concrete, directly-observed friction the opener can name honestly. Prefer a
  // weak website/CX reading we actually observed; never fabricate one.
  const observed = readings.find(
    (r) => (r.dimension === "digital-presence" || r.dimension === "customer-experience") && (r.status === "weak" || r.status === "absent") && r.confidence.label === "Observed",
  );
  return {
    businessName: ctx.lead.businessName,
    industry: ctx.lead.industry,
    city: ctx.lead.city,
    observedFriction: observed ? observed.summary : null,
  };
}

// ── provenance ───────────────────────────────────────────────────────────────
function buildProvenance(ctx: ProfileContext): string[] {
  const out = new Set<string>(["presence-detection"]);
  for (const e of ctx.evidence.all()) out.add(e.providerId);
  if (ctx.maturity) out.add("technology-maturity");
  if (ctx.improvement) out.add("improvement-model");
  return Array.from(out);
}

// ── util ────────────────────────────────────────────────────────────────────
function dedupe(a: string[]): string[] {
  return Array.from(new Set(a));
}
function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

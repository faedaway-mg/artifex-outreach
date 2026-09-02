// Content Studio — the bounded, data-driven Field Note template schema. A new piece is STRUCTURED DATA
// validated against this schema, then rendered by a fixed renderer that maps known fields to the
// approved visual vocabulary (scene-lib.js: .surface/.chip/.cnode chain/.frow rows/brand). The renderer
// inserts text via textContent only — it NEVER executes template-provided JS/HTML. This is what makes
// new content reusable without writing rendering code per piece, while staying injection-safe.

import { z } from "zod";

const str = (max: number) => z.string().min(1).max(max);
const tone = z.enum(["teal", "amber", "chalk", "faint", "azure", "neutral"]).optional();

// ── Beat vocabulary (each maps 1:1 to an approved on-screen grammar) ─────────────
const commonBeat = {
  // Narration line indices this beat is on screen for. The FIRST index anchors the beat's start to
  // that line's detected voice onset (line-granular audio sync — see template.mjs). Empty = inherit.
  lines: z.array(z.number().int().min(0)).max(12).default([]),
  mood: z.enum(["problem", "turn", "resolve"]).optional(),
};

const titleBeat = z.object({ type: z.literal("title"), eyebrow: str(40).optional(), headline: str(120), sub: str(160).optional(), ...commonBeat });
const statementBeat = z.object({ type: z.literal("statement"), text: str(160), size: z.enum(["h1", "h2", "h3"]).optional(), accent: str(80).optional(), ...commonBeat });
const surfaceRow = z.object({ label: str(28), value: str(60), tone });
const surfaceBeat = z.object({ type: z.literal("surface"), barLabel: str(40), barIcon: str(4).optional(), kind: str(24).optional(), tone: z.enum(["teal", "amber", "neutral"]).optional(), rows: z.array(surfaceRow).min(1).max(5), ...commonBeat });
const cardItem = z.object({ icon: str(4).optional(), label: str(24), name: str(40).optional(), line: str(60).optional() });
const cardsBeat = z.object({ type: z.literal("cards"), items: z.array(cardItem).min(2).max(6), ...commonBeat });
const chainNode = z.object({ label: str(24), state: z.enum(["on", "gap", "neutral"]) });
const chainBeat = z.object({ type: z.literal("chain"), caption: str(40).optional(), nodes: z.array(chainNode).min(2).max(6), ...commonBeat });
const routesBeat = z.object({ type: z.literal("routes"), items: z.array(str(28)).min(2).max(5), ...commonBeat });
const searchBeat = z.object({ type: z.literal("search"), query: str(48), rows: z.array(str(40)).min(1).max(6), chips: z.array(str(24)).max(4).default([]), ...commonBeat });
const reportRow = z.object({ label: str(24), value: str(40), filled: z.boolean().optional() });
const reportBeat = z.object({ type: z.literal("report"), barLabel: str(40), kind: str(24).optional(), rows: z.array(reportRow).min(2).max(6), ...commonBeat });
const brandBeat = z.object({ type: z.literal("brand"), tagline: str(80).optional(), ...commonBeat });
// Interior EVIDENCE frame (section F addendum): composites the real, SHA-verified website screenshot into
// the video during the finding it proves. The image bytes are NOT persisted here — the render worker
// materializes + verifies the bound screenshot and injects it at render time. Only the on-screen context
// label + caption are authored/persisted, so the schema stays small and injection-safe.
const evidenceShotBeat = z.object({ type: z.literal("evidenceShot"), context: str(48).optional(), caption: str(160).optional(), ...commonBeat });

export const beatSchema = z.discriminatedUnion("type", [
  titleBeat, statementBeat, surfaceBeat, cardsBeat, chainBeat, routesBeat, searchBeat, reportBeat, brandBeat, evidenceShotBeat,
]);
export type Beat = z.infer<typeof beatSchema>;

// Thumbnail art is a bounded, data-driven set (no per-piece art code).
export const THUMB_ARTS = ["statement", "statusCard", "cards", "chain", "search", "report"] as const;

export const thumbnailSchema = z.object({
  headline: z.array(str(24)).min(1).max(3), // 1–3 short lines
  secondary: str(60),
  art: z.enum(THUMB_ARTS),
  // Optional structured art payload (rows/nodes/items) — same bounded shapes, capped.
  rows: z.array(z.object({ label: str(24), value: str(40) })).max(4).optional(),
  nodes: z.array(chainNode).max(5).optional(),
  items: z.array(cardItem).max(4).optional(),
  query: str(48).optional(),
});
export type ThumbnailSpec = z.infer<typeof thumbnailSchema>;

// Evidence bound to a single narration line (section F). Every MATERIAL line (the findings + starting
// point) carries the receipt behind it: what confidence, from which source, the exact provenance basis,
// the finding topic, and — when a real capture exists — the screenshot key. Framing lines (opening hook,
// close) are marked kind:"framing" and need no receipt. This is what lets the operator UI show, per line,
// "this claim is backed by X" and what makes a fabricated line impossible to hide.
export const narrationEvidenceSchema = z.object({
  line: z.number().int().min(0), // index into narration[]
  kind: z.enum(["framing", "finding", "starting-point"]),
  confidence: z.string().max(24).optional(),   // "Observed" | "Reported" | "Likely" | …
  topic: z.string().max(24).optional(),
  sourceLabel: z.string().max(120).optional(), // customer-safe display label (e.g. "silverinthecity.com · Reviews")
  sourceUrl: z.string().max(400).optional(),   // exact crawled URL (operator-only)
  basis: z.array(z.string().max(200)).max(6).default([]), // raw provenance strings
  observedAt: z.string().max(40).optional(),
  screenshotKey: z.string().max(200).optional(), // artifact key of a real capture, when one exists
});
export type NarrationEvidence = z.infer<typeof narrationEvidenceSchema>;

// ── Evidence-led storyboard (section F addendum) ────────────────────────────────
// A persisted, per-scene plan that makes the finished video's visual story auditable BEFORE it renders
// and drives the render worker to composite the RIGHT screenshot into the RIGHT interior scene. Every
// scene binds to its narration line; an "evidence" scene additionally carries the exact page, the real
// screenshot artifact key + SHA-256, and the finding/evidence id it proves. The render worker verifies
// the screenshot SHA before compositing — a scene can never show a screenshot that doesn't match.
export const STORYBOARD_PURPOSES = [
  "identity",        // 1. who the company is
  "page-reviewed",   // 2. what page / journey was reviewed
  "finding",         // 3. the exact finding
  "evidence",        // 4. the real screenshot proving the finding (+5 focus on the relevant portion)
  "why",             // 6. why it matters for this company
  "recommendation",  // 7. the recommended improvement
  "cta",             // 8. a concise Artifex call to action
] as const;

// Bounded visual treatments the render worker knows how to draw. "screenshot" / "screenshot-focus" are
// the interior evidence frames (real capture, clean crop, optional highlight — never a vignette).
export const STORYBOARD_TREATMENTS = ["title", "statement", "screenshot", "screenshot-focus", "chain", "brand"] as const;

export const storyboardSceneSchema = z.object({
  scene: z.number().int().min(1),                 // 1-based scene number, in narration order
  narrationLine: z.number().int().min(0),         // index into narration[] this scene speaks over
  narration: str(200),                            // the exact narrated line (copied for audit)
  purpose: z.enum(STORYBOARD_PURPOSES),
  companyName: str(120),
  sourcePageTitle: z.string().max(120).optional(),// e.g. "Homepage", "Booking flow"
  sourceUrl: z.string().max(400).optional(),
  screenshotKey: z.string().max(200).optional(),  // real capture artifact key (evidence scenes only)
  screenshotSha: z.string().max(80).optional(),   // SHA-256 the worker re-verifies before compositing
  evidenceId: z.string().max(80).optional(),      // finding/evidence id this scene proves
  startSeconds: z.number().min(0).optional(),      // approximate; render resolves exact onset
  endSeconds: z.number().min(0).optional(),
  visualTreatment: z.enum(STORYBOARD_TREATMENTS),
  onScreenContext: z.string().max(48).optional(), // "Homepage" | "What visitors see" | "Opportunity" | …
  recommendation: z.string().max(200).optional(),
  provenance: z.object({
    confidence: z.string().max(24).optional(),    // "Observed" | "Reported" | "Likely" | …
    basis: z.array(z.string().max(200)).max(6).default([]),
    observedAt: z.string().max(40).optional(),
  }),
});
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;

export const templateSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().regex(/^[0-9a-z][0-9a-z_-]{1,40}$/i),
  title: str(80),
  concept: str(120),
  // Client/prospect videos are the SAME data-driven template, bound to a business + its evidence.
  businessId: z.string().max(64).optional(),
  businessName: z.string().max(120).optional(),
  // Explicit, PERSISTED workflow discriminator (mandate I). "prospect" = a Prospect Video Sales Package
  // (evidence-led, business-bound; NEVER shows social caption / posting / share controls). "social" = a
  // Field Note (captions, approve-for-posting, mark-posted, social share). Optional for back-compat; when
  // absent it is derived from businessId / the client- id prefix (see workflowOf).
  workflow: z.enum(["social", "prospect"]).optional(),
  seed: z.number().int().default(20260107),
  narration: z.array(str(200)).min(2).max(12),
  beats: z.array(beatSchema).min(2).max(10),
  thumbnail: thumbnailSchema,
  captions: z.object({ ig: z.string().max(2200).optional(), li: z.string().max(3000).optional() }).optional(),
  // ── Evidence-led scripts (section F) — optional so pre-existing templates stay valid. ──
  narrationEvidence: z.array(narrationEvidenceSchema).max(12).optional(),
  // Persisted evidence-led storyboard (section F addendum). Optional so pre-existing templates stay valid;
  // a client video is only generatable when this contains at least one SHA-bound evidence scene.
  storyboard: z.array(storyboardSceneSchema).max(12).optional(),
  // "evidence-backed" = at least one specific, demonstrable finding beyond ratings/reviews. "needs-evidence"
  // means the review had only thin/generic signal — a client video must NOT be generated from it.
  evidenceState: z.enum(["evidence-backed", "needs-evidence"]).optional(),
  revision: z.number().int().min(1).optional(),        // bumped on every persisted regeneration
  ownerEdited: z.boolean().optional(),                  // true once an operator hand-edits the script
  ownerEditedAt: z.string().max(40).optional(),
  // The exact evidence deficiency to SHOW when evidenceState is "needs-evidence" — so the UI can explain
  // why the active script is withheld instead of displaying a stale, generic one as current content.
  evidenceDeficiency: z.string().max(400).optional(),
  // Archived prior narrations (narration-quality mandate: "preserve it only in revision history"). When a
  // project flips to needs-evidence, its previously-approved/generated script moves here — never shown as
  // current content, but never lost either.
  revisionHistory: z.array(z.object({
    revision: z.number().int().min(0).optional(),
    archivedAt: z.string().max(40),
    reason: z.string().max(200),
    evidenceState: z.enum(["evidence-backed", "needs-evidence"]).optional(),
    narration: z.array(z.string().max(200)).max(12),
  })).max(20).optional(),
});
export type ContentTemplate = z.infer<typeof templateSchema>;

// Extra structural checks beyond field validation: exactly one brand beat, and it must be last; every
// narration line referenced by at most one beat's start; line indices within range.
export function validateTemplateStructure(t: ContentTemplate): { ok: boolean; error?: string } {
  const brandCount = t.beats.filter((b) => b.type === "brand").length;
  if (brandCount !== 1) return { ok: false, error: "Template must contain exactly one 'brand' beat." };
  if (t.beats[t.beats.length - 1].type !== "brand") return { ok: false, error: "The 'brand' beat must be last." };
  for (const b of t.beats) for (const li of (b as any).lines ?? []) {
    if (li >= t.narration.length) return { ok: false, error: `Beat references narration line ${li}, but there are only ${t.narration.length}.` };
  }
  for (const e of t.narrationEvidence ?? []) {
    if (e.line >= t.narration.length) return { ok: false, error: `Evidence references narration line ${e.line}, but there are only ${t.narration.length}.` };
  }
  return { ok: true };
}

// Parse + validate untrusted input (from the API). Returns the typed template or a readable error.
export function parseTemplate(input: unknown): { ok: true; template: ContentTemplate } | { ok: false; error: string } {
  const res = templateSchema.safeParse(input);
  if (!res.success) return { ok: false, error: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const struct = validateTemplateStructure(res.data);
  if (!struct.ok) return { ok: false, error: struct.error! };
  return { ok: true, template: res.data };
}

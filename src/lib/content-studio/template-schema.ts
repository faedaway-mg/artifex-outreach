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

export const beatSchema = z.discriminatedUnion("type", [
  titleBeat, statementBeat, surfaceBeat, cardsBeat, chainBeat, routesBeat, searchBeat, reportBeat, brandBeat,
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

export const templateSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().regex(/^[0-9a-z][0-9a-z_-]{1,40}$/i),
  title: str(80),
  concept: str(120),
  // Client/prospect videos are the SAME data-driven template, bound to a business + its evidence.
  businessId: z.string().max(64).optional(),
  businessName: z.string().max(120).optional(),
  seed: z.number().int().default(20260107),
  narration: z.array(str(200)).min(2).max(12),
  beats: z.array(beatSchema).min(2).max(10),
  thumbnail: thumbnailSchema,
  captions: z.object({ ig: z.string().max(2200).optional(), li: z.string().max(3000).optional() }).optional(),
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

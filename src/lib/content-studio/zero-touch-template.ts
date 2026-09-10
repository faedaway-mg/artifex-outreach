// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH → RENDERABLE TEMPLATE (mandate §17). PURE.
//
// The missing link that makes zero-touch actually produce a video from a brand-new
// idea: a raw draft piece is `renderable: false` and has no template, so the render
// worker has nothing to draw. This module maps the system-written script + the
// deterministic 9:16 SocialScenePlan into a VALID, injection-safe ContentTemplate
// (the same data-driven schema the generic render worker already knows how to draw:
// hook → point/emphasis statement cards → brand close). Saving it makes the piece
// renderable; the operator never sees any of this.
//
// No I/O. The action layer persists the returned template via store.saveTemplate.
// ─────────────────────────────────────────────────────────────────────────────
import type { ContentTemplate, Beat, ThumbnailSpec } from "./template-schema";
import { parseTemplate } from "./template-schema";
import type { SocialScenePlan } from "./zero-touch-orchestrator";

export interface ZeroTouchTemplateInput {
  pieceId: string;
  title: string;
  concept: string | null;
  /** The system-written narration lines (composeScriptFromBrief). */
  script: string[];
  /** The deterministic 9:16 animation plan (planSocialAnimation). */
  plan: SocialScenePlan;
}

// Schema caps we must respect (template-schema.ts): narration line ≤200, 2–12 lines;
// statement text ≤160; title headline ≤120, eyebrow ≤40; brand tagline ≤80; 2–10 beats.
const MAX_NARRATION_LINES = 12;
const MAX_BEATS = 10;
const NARRATION_MAX = 200;
const STATEMENT_MAX = 160;
const HEADLINE_MAX = 120;
const TAGLINE_MAX = 80;

function clamp(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // Cut on a word boundary, keep it readable, never mid-word ellipsis noise.
  return t.slice(0, max - 1).replace(/\s+\S*$/, "").trim() || t.slice(0, max - 1);
}

/** Sanitize a piece id into the schema's allowed template id shape. */
export function zeroTouchTemplateId(pieceId: string): string {
  const safe = pieceId.replace(/[^0-9a-z_-]/gi, "-").replace(/^[^0-9a-z]/i, "z");
  return safe.slice(0, 41) || "zt-piece";
}

/**
 * Build a renderable, valid, injection-safe ContentTemplate from a zero-touch script +
 * plan. Deterministic and PURE. Throws only if the produced template fails schema
 * validation (a programming error, surfaced loudly rather than enqueuing an unrenderable
 * job). The first line is the hook (title beat), interior lines become alternating
 * statement cards, and the final line is the brand close.
 */
export function buildZeroTouchTemplate(input: ZeroTouchTemplateInput): ContentTemplate {
  // 1) Narration — clamp each line and cap the count (keep hook + close as anchors).
  let lines = (input.script ?? []).map((l) => clamp(l, NARRATION_MAX)).filter(Boolean);
  if (lines.length < 2) {
    // A brief always yields ≥2 (hook + close); this only guards a degenerate input.
    lines = [clamp(input.title || "Field note", NARRATION_MAX), "That's the kind of problem Artifex fixes."];
  }
  if (lines.length > MAX_NARRATION_LINES) {
    const head = lines.slice(0, MAX_NARRATION_LINES - 1);
    const close = lines[lines.length - 1];
    lines = [...head, close];
  }
  const lastIdx = lines.length - 1;

  // 2) Beats — title(hook) → statement cards for the interior → brand(close). Reserve
  //    one slot each for title + brand, so interior statements fill up to MAX_BEATS-2.
  const beats: Beat[] = [];
  beats.push({
    type: "title",
    eyebrow: clamp(input.concept || "Field note", 40),
    headline: clamp(lines[0], HEADLINE_MAX),
    lines: [0],
    mood: "problem",
  });

  const interiorIdx: number[] = [];
  for (let i = 1; i < lastIdx; i++) interiorIdx.push(i);
  const interiorSlots = Math.max(0, MAX_BEATS - 2);
  const shownInterior = interiorIdx.slice(0, interiorSlots); // remaining lines still spoken (audio), just no card
  shownInterior.forEach((i, k) => {
    beats.push({
      type: "statement",
      text: clamp(lines[i], STATEMENT_MAX),
      size: k % 2 === 0 ? "h2" : "h1", // point / emphasis kinetic variety
      lines: [i],
      mood: k === shownInterior.length - 1 ? "resolve" : "turn",
    });
  });

  beats.push({
    type: "brand",
    tagline: clamp("Artifex Labs", TAGLINE_MAX),
    lines: [lastIdx],
    mood: "resolve",
  });

  // 3) Thumbnail — a bounded, data-driven cover derived from the hook (never per-piece art code).
  const hookWords = clamp(lines[0], 72);
  const headline = splitHeadline(hookWords);
  const thumbnail: ThumbnailSpec = {
    headline,
    secondary: clamp(input.concept || input.title || "A short Artifex field note", 60),
    art: "statement",
  };

  const candidate = {
    version: 1 as const,
    id: zeroTouchTemplateId(input.pieceId),
    title: clamp(input.title || "Field note", 80),
    concept: clamp(input.concept || input.title || "Field note", 120),
    workflow: "social" as const,
    seed: 20260107,
    narration: lines,
    beats,
    thumbnail,
  };

  const parsed = parseTemplate(candidate);
  if (!parsed.ok) {
    throw new Error(`zero-touch template failed validation: ${parsed.error}`);
  }
  return parsed.template;
}

/** Split a short hook into 1–3 balanced thumbnail lines (≤24 chars each, schema cap). */
function splitHeadline(s: string): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > 24 && cur) {
      lines.push(cur);
      cur = w.slice(0, 24);
      if (lines.length === 3) break;
    } else {
      cur = next.slice(0, 24);
    }
  }
  if (cur && lines.length < 3) lines.push(cur);
  return lines.length ? lines.slice(0, 3) : [clamp(s, 24)];
}

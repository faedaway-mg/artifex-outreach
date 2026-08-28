// Content Studio — phone-friendly script → template. So a new social piece needs only a concept + a
// narration script (one line per row): the lines are auto-laid-out onto the approved statement grammar
// (title → one statement per line → brand), producing a RENDERABLE, schema-valid template with no beat
// authoring and no per-piece code. Power users can still POST a full `beats` template (see #007) for the
// richer surface/cards/chain grammar.

import { parseTemplate, type ContentTemplate } from "./template-schema";

export function autoTemplateFromScript(input: {
  id: string;
  title: string;
  concept?: string;
  narration: string[];
  seed?: number;
}): { ok: true; template: ContentTemplate } | { ok: false; error: string } {
  const lines = input.narration.map((s) => s.trim()).filter(Boolean).slice(0, 8); // schema caps at 12; keep it tight
  if (lines.length < 2) return { ok: false, error: "Enter at least two narration lines." };
  const concept = (input.concept || lines[0]).trim();

  const beats: ContentTemplate["beats"] = [];
  // Opening title = the piece title/hook, on the first narration line.
  beats.push({ type: "title", lines: [0], mood: "problem", eyebrow: "FIELD NOTE", headline: input.title.slice(0, 120), sub: concept.slice(0, 160) });
  // A statement per middle line. The penultimate line is the "turn"; everything before is "problem".
  for (let i = 1; i < lines.length - 1; i++) {
    beats.push({ type: "statement", lines: [i], size: "h2", mood: i === lines.length - 2 ? "turn" : "problem", text: lines[i].slice(0, 160) });
  }
  // Brand resolve on the final line (its text becomes the tagline if short enough).
  const last = lines[lines.length - 1];
  beats.push({ type: "brand", lines: [lines.length - 1], mood: "resolve", tagline: last.length <= 80 ? last : "Business technology that works together." });

  const template = {
    version: 1 as const,
    id: input.id,
    title: input.title.slice(0, 80),
    concept: concept.slice(0, 120),
    seed: input.seed ?? 20260107,
    narration: lines,
    beats,
    thumbnail: {
      headline: input.title.split(/\s+/).length > 3 ? chunkTwo(input.title) : [input.title.slice(0, 24)],
      secondary: concept.slice(0, 60),
      art: "statement" as const,
    },
  };
  const parsed = parseTemplate(template);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, template: parsed.template };
}

// Split a headline into two balanced lines for the cover.
function chunkTwo(s: string): string[] {
  const words = s.split(/\s+/);
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" ").slice(0, 24), words.slice(mid).join(" ").slice(0, 24)].filter(Boolean);
}

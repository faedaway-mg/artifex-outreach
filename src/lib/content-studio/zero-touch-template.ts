// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH → RENDERABLE TEMPLATE (mandate §17, §40–§45). PURE.
//
// The missing link that makes zero-touch actually produce a video from a brand-new
// idea: a raw draft piece is `renderable: false` and has no template, so the render
// worker has nothing to draw. This module maps the system-written script + the
// deterministic 9:16 SocialScenePlan into a VALID, injection-safe ContentTemplate
// (the same data-driven schema the generic render worker already knows how to draw).
//
// §40–§45 — VISUAL STORYTELLING, NOT A NARRATED POWERPOINT. A Field Note must not be
// "mostly text on the same blue/dark background". So this builder no longer emits only
// title/statement/brand text cards. It reads the concept + script and DEMONSTRATES the
// idea with the richer, already-renderable beat grammar (chain / cards / surface /
// search / routes / report), heuristically chosen from the story's own words — e.g. a
// "data entered four times" story becomes a `chain` (form → email → sheet → CRM); a
// "nobody followed up" story becomes a `chain` of record → reminder → missed → cold.
// Text still matters, but a normal Field Note is GUARANTEED ≥2 distinct structured
// (non-text) beat kinds so the whole video has real visual variety.
//
// Deterministic and PURE (no Date.now / Math.random). No I/O — the action layer
// persists the returned template via store.saveTemplate.
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

// The beat kinds that carry a real on-screen STRUCTURE (not centered narration text).
// Kept in sync with social-richness.ts STRUCTURED_BEAT_KINDS — both derive from the
// same idea: everything except title/statement/brand is a visual, demonstrative beat.
const STRUCTURED_BEAT_KINDS = ["surface", "cards", "chain", "routes", "search", "report", "evidenceShot"] as const;

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

// ── Concept → structured "demonstration" beats (§41–§43) ─────────────────────
// The story's own words pick a visual grammar. Each rule returns 1–2 structured beats
// that SHOW the concept (a broken hand-off chain, the places a lead leaks, a search that
// finds nothing, the manual-entry loop). Rules are ordered by specificity; the first two
// that match are used, then a generic fallback guarantees ≥2 distinct structured kinds.
// All node/row/item labels come from a bounded vocabulary — never echoed template HTML.

interface StoryBeat { beat: Beat; kind: (typeof STRUCTURED_BEAT_KINDS)[number]; }

const has = (hay: string, ...needles: string[]) => needles.some((n) => hay.includes(n));

/** A chain beat (state-flow) with the last node marked as the failure/gap. */
function chainOf(caption: string, nodes: Array<[string, "on" | "gap" | "neutral"]>): Beat {
  return {
    type: "chain",
    lines: [], // anchored to a narration line by buildZeroTouchTemplate before use
    caption: clamp(caption, 40),
    nodes: nodes.slice(0, 6).map(([label, state]) => ({ label: clamp(label, 24), state })),
  };
}

/**
 * Infer the ordered structured beats that DEMONSTRATE this Field Note's concept, from
 * the concept + full script text. Deterministic; returns 2–4 structured beats. Text is
 * bounded vocabulary chosen by keyword, so a "data entered four times" story renders a
 * form→email→sheet→CRM chain and a "nobody followed up" story renders a
 * record→reminder→missed→cold chain — real visual storytelling, not text on blue.
 */
export function inferStructuredBeats(concept: string, scriptText: string): Beat[] {
  const hay = `${concept} ${scriptText}`.toLowerCase();
  const beats: StoryBeat[] = [];
  const push = (beat: Beat, kind: StoryBeat["kind"]) => beats.push({ beat, kind });

  // 1) Duplicate / manual data entry ("entered four times", "re-type", "copy-paste"). A
  //    broken hand-off chain across the systems the data is retyped into.
  if (has(hay, "enter", "re-type", "retype", "type it", "copy", "paste", "duplicate", "manual", "again", "twice", "four times", "three times")) {
    push(chainOf("Same data, entered again", [
      ["Web form", "on"], ["Email", "gap"], ["Spreadsheet", "gap"], ["CRM", "gap"],
    ]), "chain");
  }

  // 2) Follow-up / lead leaks ("nobody followed up", "no reply", "went cold", "missed").
  //    Where the lead falls out of the funnel.
  if (has(hay, "follow", "followed up", "no reply", "never call", "went cold", "cold", "missed", "ignored", "forgot", "slip", "fall through", "lost lead", "lose lead", "lost the lead")) {
    push(chainOf("Where the lead goes cold", [
      ["New lead", "on"], ["Reminder", "gap"], ["Missed", "gap"], ["Gone cold", "gap"],
    ]), "chain");
  }

  // 3) After-hours / can't book / dead form ("after 6pm", "closed", "can't book").
  //    A surface (status rows) contrasting what should happen vs. what does.
  if (has(hay, "after hours", "after-hours", "after 6", "after 5", "6pm", "5pm", "closed", "overnight", "weekend", "book", "booking", "dead form", "no one answers")) {
    push({
      type: "surface",
      lines: [],
      barLabel: "After-hours request",
      barIcon: "🕗",
      tone: "amber",
      rows: [
        { label: "Booking form", value: "No response", tone: "amber" },
        { label: "Live chat", value: "Offline", tone: "faint" },
        { label: "Captured", value: "0", tone: "amber" },
      ],
    }, "surface");
  }

  // 4) Search / can't-be-found ("nobody can find you", "not on Google", "search").
  if (has(hay, "search", "google", "find you", "found", "can't find", "cannot find", "invisible", "not ranking", "seo", "listing", "directory")) {
    push({
      type: "search",
      lines: [],
      query: clamp(conceptNoun(concept) || "services near me", 48),
      rows: ["A competitor", "Another competitor", "A directory page"],
      chips: ["Not you"],
    }, "search");
  }

  // 5) Scattered tools / disconnected systems ("spreadsheets", "sticky notes", "five tabs").
  if (has(hay, "spreadsheet", "sticky note", "tabs", "tools", "systems", "apps", "juggle", "scattered", "disconnected", "silo", "everywhere")) {
    push({
      type: "cards",
      lines: [],
      items: [
        { icon: "📄", label: "SPREADSHEET", name: "Leads.xlsx", line: "Half the story" },
        { icon: "✉️", label: "INBOX", name: "Unread", line: "The other half" },
        { icon: "📝", label: "STICKY NOTES", name: "On the monitor", line: "The rest" },
      ],
    }, "cards");
  }

  // 6) Wasted time / hours per week ("hours a week", "every morning", "takes forever").
  if (has(hay, "hours a week", "every morning", "every day", "takes forever", "waste", "wasted", "slow", "time", "manually")) {
    push({
      type: "report",
      lines: [],
      barLabel: "Where the week goes",
      kind: "PER WEEK",
      rows: [
        { label: "Re-entering data", value: "6 hrs", filled: true },
        { label: "Chasing replies", value: "4 hrs", filled: true },
        { label: "Actual work", value: "Less", filled: false },
      ],
    }, "report");
  }

  // Generic demonstration fallbacks — used to reach the ≥2 DISTINCT structured-kind floor
  // when the concept is unremarkable. A problem→fix chain always tells the arc visually.
  const fallbacks: StoryBeat[] = [
    { kind: "chain", beat: chainOf("Today", [["Request", "on"], ["Hand-off", "gap"], ["Follow-up", "gap"], ["Result", "gap"]]) },
    {
      kind: "cards",
      beat: {
        type: "cards",
        lines: [],
        items: [
          { icon: "⚠️", label: "TODAY", name: "Manual + scattered", line: "Things slip" },
          { icon: "✓", label: "FIXED", name: "One connected flow", line: "Nothing slips" },
        ],
      },
    },
  ];

  // De-duplicate by kind (distinct kinds are what make the video visually varied) and
  // ensure at least two DISTINCT structured kinds by drawing from the fallbacks.
  const chosen: Beat[] = [];
  const kinds = new Set<string>();
  for (const b of beats) {
    if (kinds.has(b.kind)) continue;
    kinds.add(b.kind);
    chosen.push(b.beat);
    if (kinds.size >= 3) break; // cap the structured spend; interior statements still narrate
  }
  for (const f of fallbacks) {
    if (kinds.size >= 2) break;
    if (kinds.has(f.kind)) continue;
    kinds.add(f.kind);
    chosen.push(f.beat);
  }
  return chosen;
}

/** A short noun-ish query fragment from a concept, for the search demonstration. */
function conceptNoun(concept: string): string {
  const c = (concept || "").replace(/\s+/g, " ").trim();
  // Drop a leading "Why / How / When …" framing so the query reads like a real search.
  return c.replace(/^(why|how|when|what|the|a|an)\s+/i, "").toLowerCase();
}

/**
 * Build a renderable, valid, injection-safe ContentTemplate from a zero-touch script +
 * plan. Deterministic and PURE. Throws only if the produced template fails schema
 * validation (a programming error, surfaced loudly rather than enqueuing an unrenderable
 * job).
 *
 * §40–§45 scene plan: title(hook) → 2–3 STRUCTURED demonstration beats inferred from the
 * concept/script that SHOW the idea (chain / cards / surface / search / …) interleaved
 * with the interior narration statements → brand(close). A normal Field Note is therefore
 * guaranteed real visual variety (≥2 distinct structured beat kinds), not centered text.
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

  // 2) Structured demonstration beats inferred from the story (§41–§43). These are the
  //    visual spine — anchored to interior narration lines so they appear WHILE the point
  //    they illustrate is spoken (never all text on one background).
  const concept = input.concept || input.title || "Field note";
  const scriptText = lines.join(" ");
  const structured = inferStructuredBeats(concept, scriptText);

  // 3) Assemble the scene plan under the beat/slot budget:
  //    [ title ] + interleave( interior statements, structured beats ) + [ brand ].
  //    Reserve one slot each for title + brand; the remainder is shared between the
  //    structured demonstrations and the interior statement cards, structured-first so a
  //    short Field Note never loses its visual variety to filler text.
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

  const interiorSlots = Math.max(0, MAX_BEATS - 2); // slots between title and brand
  const structuredCount = Math.min(structured.length, Math.max(0, interiorSlots - 1)); // leave ≥1 statement slot when possible
  const usedStructured = structured.slice(0, structuredCount || Math.min(structured.length, interiorSlots));
  const statementSlots = Math.max(0, interiorSlots - usedStructured.length);
  const shownInterior = interiorIdx.slice(0, statementSlots); // remaining lines still spoken (audio), just no card

  // Build the ordered interior: statement cards anchored to their line, with the structured
  // demonstrations woven in between them. Anchor each structured beat to the interior line
  // it best illustrates (spread evenly) so it lands on-narration; the renderer holds one
  // beat on screen at a time, so overlapping line anchors are fine (audio drives timing).
  const statementBeats: Beat[] = shownInterior.map((i, k) => ({
    type: "statement",
    text: clamp(lines[i], STATEMENT_MAX),
    size: k % 2 === 0 ? "h2" : "h1", // point / emphasis kinetic variety
    lines: [i],
    mood: k === shownInterior.length - 1 ? "resolve" : "turn",
  }));

  // Anchor lines for the structured beats: spread across the interior narration so they are
  // spoken over real lines (falls back to the hook line when there is no interior).
  const anchorLine = (k: number): number => {
    if (interiorIdx.length === 0) return 0;
    const pos = Math.round(((k + 1) / (usedStructured.length + 1)) * (interiorIdx.length - 1));
    return interiorIdx[Math.max(0, Math.min(interiorIdx.length - 1, pos))];
  };
  const anchoredStructured: Beat[] = usedStructured.map((b, k) => ({
    ...b,
    lines: [anchorLine(k)],
    mood: k === usedStructured.length - 1 ? "resolve" : "turn",
  }));

  // Interleave: structured demonstration, then a statement, repeating — a rhythm of SHOW
  // then SAY. Whatever is left over from the longer list is appended.
  const woven: Beat[] = [];
  const maxLen = Math.max(anchoredStructured.length, statementBeats.length);
  for (let k = 0; k < maxLen; k++) {
    if (k < anchoredStructured.length) woven.push(anchoredStructured[k]);
    if (k < statementBeats.length) woven.push(statementBeats[k]);
  }
  for (const b of woven.slice(0, interiorSlots)) beats.push(b);

  beats.push({
    type: "brand",
    tagline: clamp("Artifex Labs", TAGLINE_MAX),
    lines: [lastIdx],
    mood: "resolve",
  });

  // 4) Thumbnail — a bounded, data-driven cover. Reflect the dominant structured beat so the
  //    cover previews the visual story (chain / cards / search) instead of always "statement".
  const hookWords = clamp(lines[0], 72);
  const headline = splitHeadline(hookWords);
  const thumbnail: ThumbnailSpec = deriveThumbnail(headline, input, usedStructured);

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

/** Derive a bounded thumbnail whose art mirrors the leading structured demonstration. */
function deriveThumbnail(headline: string[], input: ZeroTouchTemplateInput, structured: Beat[]): ThumbnailSpec {
  const secondary = clamp(input.concept || input.title || "A short Artifex field note", 60);
  const lead = structured[0];
  const base: ThumbnailSpec = { headline, secondary, art: "statement" };
  if (!lead) return base;
  if (lead.type === "chain") return { ...base, art: "chain", nodes: lead.nodes.slice(0, 5) };
  if (lead.type === "cards") return { ...base, art: "cards", items: lead.items.slice(0, 4).map((it) => ({ icon: it.icon, label: it.label, name: it.name, line: it.line })) };
  if (lead.type === "search") return { ...base, art: "search", query: lead.query };
  if (lead.type === "surface") return { ...base, art: "statusCard", rows: lead.rows.slice(0, 4).map((r) => ({ label: r.label, value: r.value })) };
  if (lead.type === "report") return { ...base, art: "report", rows: lead.rows.slice(0, 4).map((r) => ({ label: r.label, value: r.value })) };
  return base;
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

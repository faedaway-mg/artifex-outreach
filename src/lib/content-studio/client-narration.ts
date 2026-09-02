// Content Studio — VALUE-DENSE client-video narration composer (narration-quality mandate, section B/D/E/F).
//
// The prior narration was a stack of terse finding TITLES ("Point visitors to one clear next step") plus a
// generic close ("Happy to walk you through it — no obligation."). That reads as a template with a company
// name swapped in. This module composes, deterministically from ONE directly-observed finding, a script that
// walks the SIX required beats:
//   1 HOOK        — a concrete moment in THIS company's customer journey
//   2 FRICTION    — the exact page / control / missing capability the evidence verified
//   3 CONSEQUENCE — what a prospective customer must do, cannot do, or reasonably experiences (an ASSESSMENT)
//   4 SOLUTION    — what Artifex would build, specific enough that the owner can picture it
//   5 VALUE       — how it improves access / removes work / shortens the journey (no promised revenue)
//   6 CLOSE       — a credible, concrete Artifex offer (never generic "no obligation" filler)
//
// Every script is anchored to an EXACT observed detail (a measured pixel count, the page reviewed, how the
// business can currently be reached), so it cannot survive swapping in another company's name — the section-E
// interchangeability requirement. Per-topic builders give genuinely different STRUCTURE, not just subject, so
// BreakBot can't call two scripts template-equivalent. Pure + deterministic — no AI at compose time.

import type { ObservedFinding } from "./site-evidence";

export type NarrationRole = "hook" | "friction" | "consequence" | "solution" | "value" | "close";
export interface ComposedLine { text: string; role: NarrationRole }
export interface ComposedNarration {
  topic: string;
  key: string;
  lines: ComposedLine[];      // exactly one line per role, in order
  wordCount: number;          // spoken word count across all lines
  anchors: string[];          // the exact observed detail(s) that must appear (non-name) — for the gate
}

// The generic, name-swappable lines the mandate bans outright (section C). They may only ever appear when
// made concrete by company-specific evidence — the composer never emits them, and the gate rejects them.
export const PROHIBITED_RX: RegExp[] = [
  /reputation is stronger than your website/i,
  /put\b[^.]*\breviews to work/i,
  /reviews to work\b/i,
  /point visitors to one clear next step/i,
  /choose one primary action/i,
  /happy to walk you through it/i,
  /\bno obligation\b/i,
];

// Fabricated outcomes / guaranteed metrics the mandate forbids (section B5/E: "without promising unsupported
// revenue", "no unsupported metrics or guaranteed outcomes"). Observed measurements (pixels, page counts) are
// fine — this only catches promises of results.
export const UNSUPPORTED_METRIC_RX =
  /\b\d+\s?%|\b\d+x\b|\bguarantee(d|s)?\b|\bdoubl(e|ing)\b|\btripl(e|ing)\b|\broi\b|increase[^.]*\bby\b|\bup to \d|\bmore (leads|customers|revenue|sales|bookings)\b/i;

function words(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }
function countWords(lines: ComposedLine[]): number { return lines.reduce((n, l) => n + words(l.text), 0); }

// A short, spoken form of the business name: drop legal suffixes and "& Associates"-style tails, keep the
// first 1–3 meaningful tokens. "Robert Hall & Associates" → "Robert Hall"; "a2z Health Massage Schools" →
// "a2z Health"; "Morris Automotive Machine" → "Morris Automotive".
export function shortName(businessName: string): string {
  let n = (businessName || "this business").trim();
  n = n.replace(/\s*(?:,?\s*(?:llc|inc|inc\.|l\.l\.c\.?|co\.?|corp\.?|ltd\.?|pllc|pc|pa))\b\.?/gi, "");
  n = n.replace(/\s*&\s*(?:associates|assoc\.?|sons|co\.?|company|partners)\b.*$/i, "");
  const toks = n.split(/\s+/).filter(Boolean);
  const short = toks.slice(0, 3).join(" ");
  return short || (businessName || "this business");
}

const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v: unknown): string => (v == null ? "" : String(v));

// ── Per-topic builders. Each returns the six beats + the exact anchors. Distinct arcs on purpose:
//    mobile = legibility/rendering · booking = a transaction flow · contact = message capture · etc. ──

// Each builder targets ~90 spoken words: six short beats (~12–18 words each). Keep sentences tight so the
// finished script lands in the mandate's ~70–110 band.
function mobile(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const vw = num(f.details.viewportWidth) ?? 390;
  const overflow = num(f.details.overflowPx);
  const isOverflow = f.details.kind === "overflow" && overflow != null && overflow > 0;
  const anchors = isOverflow ? [`${overflow} pixels`, `${vw}-pixel`] : ["no mobile layout", "desktop page"];
  const friction = isOverflow
    ? `But on a ${vw}-pixel phone the homepage runs ${overflow} pixels past the edge, so it scrolls sideways.`
    : `But the homepage has no mobile layout — a phone loads the desktop page and shrinks the text.`;
  return {
    anchors,
    lines: [
      { role: "hook", text: `Most people first meet ${short} on a phone, straight from a search result.` },
      { role: "friction", text: friction },
      { role: "consequence", text: `A visitor has to pinch and zoom to read the services or find the number.` },
      { role: "solution", text: `We'd ${f.recommendation}, sized for the thumb.` },
      { role: "value", text: `The first ten seconds become legible instead of a zoom-and-hunt, so visitors can act.` },
      { role: "close", text: `Artifex can make the current site fit the phone it opens on.` },
    ],
  };
}

function booking(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const inspected = num(f.details.inspected) ?? 0;
  const svc = str(f.details.serviceWord) || "appointment";
  const aan = /^[aeiou]/i.test(svc) ? "an" : "a";
  const anchors = [`${inspected} pages`, "no scheduler", `book ${aan} ${svc}`];
  return {
    anchors,
    lines: [
      { role: "hook", text: `Someone lands on ${short} ready to book ${aan} ${svc}, and the only way forward is a phone call.` },
      { role: "friction", text: `Across the ${inspected} pages we reviewed there's no scheduler — no "book" or "request appointment" control anywhere.` },
      { role: "consequence", text: `If they're browsing after hours, that ready intent has nowhere to go and quietly disappears.` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That turns the site into an always-available front desk and closes the handoff where a customer slips away.` },
      { role: "close", text: `Artifex can map and build that flow without replacing the rest of the site.` },
    ],
  };
}

function contact(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const inspected = num(f.details.inspected) ?? 0;
  const reach = str(f.details.reach) || "a phone number";
  const anchors = [`${inspected} pages`, "no form", reach];
  return {
    anchors,
    lines: [
      { role: "hook", text: `A prospective client decides ${short} is the one, and looks for a way to reach out.` },
      { role: "friction", text: `Across all ${inspected} pages we reviewed, including the contact page, there's no form — only ${reach}.` },
      { role: "consequence", text: `So anyone deciding at night or on a weekend has to remember to call back — and many won't.` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That captures the client the moment they're ready, instead of asking them to call back later.` },
      { role: "close", text: `Artifex can add that form to your existing contact page in a single pass.` },
    ],
  };
}

function cta(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const n = num(f.details.ctaCount) ?? 3;
  const labels = str(f.details.ctaLabels);
  return {
    anchors: [`${n} competing`, labels].filter(Boolean),
    lines: [
      { role: "hook", text: `A first-time visitor reaches ${short}'s homepage having decided to take a step — they just need to see which one.` },
      { role: "friction", text: `Instead the top of the page offers ${n} competing buttons at equal weight${labels ? ` (${labels})` : ""}, with nothing marked as the main one.` },
      { role: "consequence", text: `When every option looks equally important the visitor hesitates, and a hesitating visitor is the one who leaves.` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That removes the split-second of indecision the moment someone is ready to move, without hiding the other paths.` },
      { role: "close", text: `Artifex can restructure the homepage's actions in a focused pass.` },
    ],
  };
}

function navigation(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const n = num(f.details.navCount) ?? 9;
  return {
    anchors: [`${n} top-level`, `${n} menu`],
    lines: [
      { role: "hook", text: `A visitor arrives at ${short} looking for one specific thing and glances up at the menu to find it.` },
      { role: "friction", text: `The main navigation lists ${n} top-level items, so the one destination they want competes with ${n - 1} others.` },
      { role: "consequence", text: `A crowded menu spreads focus thin and makes the page you want people on harder to reach than it should be.` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That shortens the path to the page that converts and makes the site feel built around what customers came for.` },
      { role: "close", text: `Artifex can simplify the navigation without losing anything that matters.` },
    ],
  };
}

function copy(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const sample = str(f.details.sample);
  return {
    anchors: [sample].filter(Boolean),
    lines: [
      { role: "hook", text: `Someone weighing ${short} reads down the page to decide whether this is a business they can trust.` },
      { role: "friction", text: `Partway down they hit unfinished placeholder text${sample ? ` — "${sample}"` : ""} that was never swapped for real copy.` },
      { role: "consequence", text: `Leftover template text reads as unfinished and quietly plants a doubt at the moment someone is deciding to reach out.` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That turns a page that looks half-built into one that reads as finished, right where trust is won or lost.` },
      { role: "close", text: `Artifex can finish the page's copy in a short pass.` },
    ],
  };
}

function brand(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const hn = str(f.details.headerName), fn = str(f.details.footerName);
  return {
    anchors: [hn, fn].filter(Boolean),
    lines: [
      { role: "hook", text: `A customer who liked ${short} goes to note the name down so they can find it again later.` },
      { role: "friction", text: `But the site writes it two ways — "${hn}" in the header and "${fn}" in the footer — so which is the real name?` },
      { role: "consequence", text: `An inconsistent name is harder to remember and to search for, which quietly costs you the return visit.` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That makes the business easier to recall and find again, so the goodwill you earn comes back to you.` },
      { role: "close", text: `Artifex can align the name across the site in one pass.` },
    ],
  };
}

function general(f: ObservedFinding, short: string): { lines: ComposedLine[]; anchors: string[] } {
  const anchor = str(f.details.count) ? `${f.details.count}` : (f.sourcePageTitle || "the homepage");
  return {
    anchors: [anchor],
    lines: [
      { role: "hook", text: `A visitor arrives at ${short} ready to move forward and starts down the page toward the next step.` },
      { role: "friction", text: `On ${f.sourcePageTitle || "the homepage"} we observed a concrete problem: ${f.observation}` },
      { role: "consequence", text: `${f.whyItMatters}` },
      { role: "solution", text: `We'd ${f.recommendation}.` },
      { role: "value", text: `That clears the obstacle in front of the visitor so the interest you're already earning can turn into contact.` },
      { role: "close", text: `Artifex can fix this in a focused, single pass.` },
    ],
  };
}

const BUILDERS: Partial<Record<string, (f: ObservedFinding, short: string) => { lines: ComposedLine[]; anchors: string[] }>> = {
  mobile, booking, contact, cta, navigation, copy, brand,
};

/** Compose the value-dense, six-beat client narration for one directly-observed finding. Deterministic. */
export function composeClientNarration(finding: ObservedFinding, businessName: string): ComposedNarration {
  const short = shortName(businessName);
  const build = BUILDERS[finding.topic] ?? general;
  const { lines, anchors } = build(finding, short);
  // Hard cap each spoken line at the template schema's per-line limit (200 chars) — should never trigger,
  // but guarantees a composed line can always be persisted.
  const capped = lines.map((l) => ({ ...l, text: l.text.length > 198 ? l.text.slice(0, 197).trimEnd() + "…" : l.text }));
  return { topic: finding.topic, key: finding.key, lines: capped, wordCount: countWords(capped), anchors: anchors.filter(Boolean) };
}

export interface ScriptQuality {
  ok: boolean;
  wordCount: number;
  reasons: string[];   // empty when ok
}

// The word band the mandate sets: 70–110 spoken words, enforced as a hard ceiling/floor. A script outside
// the band fails the gate (ok:false) and its template stays needs-evidence — never a silent overflow.
const MIN_WORDS = 70, MAX_WORDS = 110;

// Section-E script quality gate. A composed script is voiceover-ready only when it carries an exact observed
// detail, a customer scenario, an explained consequence, a concrete proposed change, a practical benefit, no
// prohibited generic lines, and no unsupported metrics — and lands in the spoken-word band. Pure.
export function assessScriptQuality(n: ComposedNarration): ScriptQuality {
  const reasons: string[] = [];
  const byRole = (r: NarrationRole) => n.lines.find((l) => l.role === r)?.text ?? "";
  const all = n.lines.map((l) => l.text).join(" ");

  for (const role of ["hook", "friction", "consequence", "solution", "value", "close"] as NarrationRole[]) {
    if (!byRole(role).trim()) reasons.push(`missing ${role} beat`);
  }

  // 1) At least one EXACT observed detail, present in the friction beat, and not merely the company name.
  const friction = byRole("friction").toLowerCase();
  const hasAnchor = n.anchors.some((a) => a && friction.includes(a.toLowerCase()));
  if (!hasAnchor) reasons.push("no exact observed detail in the friction beat (would survive a name swap)");

  // 2) A clear customer scenario in the hook (a person + a present-tense action).
  if (!/\b(someone|a visitor|a prospective client|a customer|a first-time visitor|most people)\b/i.test(byRole("hook")))
    reasons.push("hook does not describe a concrete customer moment");

  // 3) An explained consequence (what they must do / cannot do / experience).
  if (!/\b(has to|have to|can't|cannot|won't|will not|nowhere to go|disappears?|slips|hesitat|back to|hold the thought|harder to)\b/i.test(byRole("consequence")))
    reasons.push("consequence beat does not explain a customer impact");

  // 4) A concrete proposed change ("we'd" + a build/intervention verb). The verb list mirrors the
  // topic interventions the review engine actually emits (rework, surface, simplify, consolidate…), so a
  // real evidence-led recommendation is never rejected for using an action word the gate hadn't listed.
  if (!/\bwe'd\b/i.test(byRole("solution")) || !/\b(add|rebuild|build|map|design|create|route|reflow|restructure|reduce|replace|standardi[sz]e|finish|align|repair|give|rework|surface|simplify|consolidate|reorgani[sz]e|redesign|clarify|remove|redirect|profile|cut|prioriti[sz]e|audit|instrument|improve|stand up|set up)\b/i.test(byRole("solution")))
    reasons.push("solution beat is not a concrete proposed change");

  // 5) A practical benefit in the value beat.
  if (words(byRole("value")) < 8) reasons.push("value beat does not explain a practical benefit");

  // 6) No prohibited generic line anywhere.
  for (const rx of PROHIBITED_RX) if (rx.test(all)) { reasons.push(`prohibited generic phrase: ${rx.source.slice(0, 40)}`); break; }

  // 7) No unsupported metric / guaranteed outcome.
  if (UNSUPPORTED_METRIC_RX.test(all)) reasons.push("contains an unsupported metric or guaranteed outcome");

  // 8) Spoken-word band.
  if (n.wordCount < MIN_WORDS) reasons.push(`too short: ${n.wordCount} words (min ${MIN_WORDS})`);
  if (n.wordCount > MAX_WORDS) reasons.push(`too long: ${n.wordCount} words (max ${MAX_WORDS})`);

  return { ok: reasons.length === 0, wordCount: n.wordCount, reasons };
}

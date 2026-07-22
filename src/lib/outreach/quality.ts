// ─────────────────────────────────────────────────────────────────────────────
// Communication quality scoring.
//
// Replaces technical confidence with a human read on the writing: would a founder
// be proud to send this? Every dimension is a 1–5 read with one plain sentence,
// plus the reading time and concrete suggested edits. All deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import { voiceViolations, readingSeconds, wordCount, sentenceStats, hasFounderSignals, type VoiceViolation } from "./voice-engine";

export interface QualityDimension {
  name: string;
  /** 1–5. */
  stars: number;
  detail: string;
}
export interface EmailQuality {
  dimensions: QualityDimension[];
  readingSeconds: number;
  wordCount: number;
  /** 0–100 composite. */
  overall: number;
  whyItWorks: string[];
  suggestedEdits: string[];
  violations: VoiceViolation[];
}

const clampStar = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export function scoreEmailQuality(
  email: { paragraphs: string[]; subject: string },
  ctx: { lead: Lead; profile?: BusinessProfile | null; observationCount?: number },
): EmailQuality {
  const body = email.paragraphs.join("\n\n");
  const violations = voiceViolations(body);
  const softwareTells = violations.filter((v) => ["our-analysis", "we-identified", "leverage", "solutions", "synergy"].includes(v.id));
  const sig = hasFounderSignals(body);
  const stats = sentenceStats(body);
  const secs = readingSeconds(body);
  const words = wordCount(body);
  const obs = ctx.observationCount ?? Math.min(2, ctx.profile?.opportunities.length ?? 0);
  const namesBusiness = body.includes(ctx.lead.businessName);
  const hasQuestion = /\?/.test(body) || /\bi'?d (genuinely )?enjoy|worth (fifteen|a short)|would you\b/i.test(body);

  const dims: QualityDimension[] = [];

  dims.push({
    name: "Founder Authenticity",
    stars: clampStar(sig.introducesSelf && softwareTells.length === 0 ? 5 : sig.introducesSelf ? 4 : sig.firstPerson ? 3 : 2),
    detail: softwareTells.length ? "Some phrasing reads automated rather than personal." : "Reads like a thoughtful founder, not marketing copy.",
  });
  dims.push({
    name: "Specificity",
    stars: clampStar(obs >= 2 ? 5 : obs === 1 ? 4 : 2),
    detail: obs >= 1 ? `References ${obs} business-specific observation${obs === 1 ? "" : "s"}.` : "Leans general — no concrete observation to anchor it.",
  });
  dims.push({
    name: "Curiosity",
    stars: clampStar(sig.humble && hasQuestion ? 5 : sig.humble ? 4 : 3),
    detail: sig.humble ? "Admits it might be wrong and invites a reply." : "Could be more openly curious.",
  });
  dims.push({
    name: "Professionalism",
    stars: clampStar(5 - violations.length),
    detail: violations.length ? `A few phrases to clean up (${violations[0].match}).` : "Calm and clean — no clichés or hype.",
  });
  dims.push({
    name: "Personalization",
    stars: clampStar(namesBusiness && obs >= 1 ? 5 : namesBusiness ? 4 : 3),
    detail: namesBusiness && obs >= 1 ? "Names the business and something specific about it." : "Personal, but could reference something more specific.",
  });
  dims.push({
    name: "Clarity",
    stars: clampStar((stats.avgWords <= 20 ? 3 : 1) + (stats.longest <= 34 ? 1 : 0) + (email.paragraphs.length <= 5 ? 1 : 0)),
    detail: stats.longest > 34 ? "One sentence runs long — worth splitting." : "Short sentences, easy to skim.",
  });
  dims.push({
    name: "Reading Time",
    stars: clampStar(secs >= 20 && secs <= 42 ? 5 : secs <= 55 ? 4 : secs <= 75 ? 3 : 2),
    detail: `~${secs} seconds — ${secs <= 45 ? "reads in a glance." : "a touch long; trimming would help."}`,
  });
  dims.push({
    name: "Respectfulness",
    stars: clampStar(sig.lowPressure ? 5 : 3),
    detail: sig.lowPressure ? "Low-pressure — clearly respects their time." : "Could soften the ask a little.",
  });

  const overall = Math.max(0, Math.min(100, Math.round((dims.reduce((a, d) => a + d.stars, 0) / (dims.length * 5)) * 100) - violations.length * 4));

  const whyItWorks: string[] = [];
  if (sig.introducesSelf) whyItWorks.push("Introduces a real person, not a company.");
  if (obs >= 1) whyItWorks.push(`Grounds the note in ${obs} specific observation${obs === 1 ? "" : "s"}.`);
  if (sig.humble) whyItWorks.push("Admits it might be wrong — no assumptions.");
  if (sig.lowPressure) whyItWorks.push("Invites a conversation with zero pressure.");

  const suggestedEdits: string[] = [];
  for (const v of violations.slice(0, 3)) suggestedEdits.push(`Remove "${v.match}" — ${v.why}.`);
  if (obs === 0) suggestedEdits.push("Open with one concrete thing you noticed, e.g. \"One thing that stood out…\".");
  if (!sig.introducesSelf) suggestedEdits.push("Open as a founder: \"I'm Jordan — I run Artifex Labs.\"");
  if (stats.longest > 34) suggestedEdits.push("Split the longest sentence in two.");
  if (secs > 55) suggestedEdits.push("Trim ~20 words — aim for a 30-second read.");

  return { dimensions: dims, readingSeconds: secs, wordCount: words, overall, whyItWorks, suggestedEdits, violations };
}

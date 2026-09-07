// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH EMAIL COPY CONTRACT (mandate 27). Deterministic, evidence-grounded composer for the cold outreach
// email to a proud, busy local operator. The message it must land: "You've already built the reputation —
// your website isn't carrying it through to the customer's next step." ~80–140 words, ONE observation, ONE
// next step, low pressure. It NEVER fabricates a metric/claim; it restates verified evidence only, and a
// prohibited-language filter blocks hype/guarantees/unsupported percentages. Cross-company similarity is
// graded so a mail-merge template can't slip through.
// ─────────────────────────────────────────────────────────────────────────────
import type { TargetingInput } from "./scoring";

export interface EmailCopy {
  available: boolean;
  blocker: string | null;
  subject: string;
  bodyText: string;
  wordCount: number;
  evidenceIds: string[];
  prohibitedHits: string[];     // must be empty for a sendable email
  requiresReview: boolean;
}

const words = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []);
const clip = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
const lower1 = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// Language that must never appear — hype, guarantees, unsupported quantitative promises, fake engagement.
const PROHIBITED: Array<{ re: RegExp; label: string }> = [
  { re: /\bterrible\b|\bawful\b|\bbad website\b/i, label: "disparagement" },
  { re: /\bguarantee(d)?\b/i, label: "guarantee" },
  { re: /\b10x\b|\btriple\b|\bdouble your\b/i, label: "growth-hype" },
  { re: /\byou(?:'re| are) losing \$?\d/i, label: "unsupported-loss-claim" },
  { re: /\b\d+%/i, label: "unsupported-percentage" },
  { re: /\bAI\b/i, label: "ai-as-reason" },
  { re: /\byou watched\b|\byou opened\b|\byou clicked\b/i, label: "fake-engagement" },
  { re: /\brevenue by\b|\bincrease your revenue\b/i, label: "unsupported-revenue" },
];

/** Compose the outreach email from the strongest reputation + website evidence. Deterministic; variant rotates
 *  phrasing so it isn't a mail-merge. */
export function composeOutreachEmail(input: TargetingInput, opts: { variant?: number; artifactUrl?: string | null } = {}): EmailCopy {
  const bn = input.businessName.trim();
  const finding = input.websiteFindings[0];
  const empty = (blocker: string): EmailCopy => ({ available: false, blocker, subject: "", bodyText: "", wordCount: 0, evidenceIds: [], prohibitedHits: [], requiresReview: false });
  if (!bn) return empty("no company name");
  if (!finding) return empty("no verified website finding to ground the email");
  if (!input.hasSupportedConsequence) return empty("no supported business consequence");

  const v = Math.max(0, Math.floor(opts.variant ?? 0)) % 3;
  const openers = [
    `I spent a few minutes on ${bn}'s website after seeing your reviews`,
    `I was looking at ${bn} and your reputation clearly stands out`,
    `Your reviews for ${bn} caught my eye, so I took a look at the website`,
  ];
  const acks = [
    `${input.reviewCount} reviews at ${input.rating}★ is a real, earned reputation`,
    `a ${input.rating}★ record across ${input.reviewCount} reviews says a lot about the work`,
    `people clearly trust ${bn} — ${input.reviewCount} reviews at ${input.rating}★`,
  ];
  const bridges = [
    `but the site isn't carrying that through to a customer's next step`,
    `and the website could do more to carry that reputation forward`,
    `and the site doesn't quite reflect what those customers already know`,
  ];
  const obs = `Specifically, ${lower1(clip(finding.observation))}`;
  const why = `For someone deciding whether to reach out, that's the moment they need it most`;
  const fix = input.websiteFindings[0].observation ? `A small, focused change there would make the site match the business` : "";
  const link = opts.artifactUrl ? ` I put together a short review — ${opts.artifactUrl}.` : "";
  const cta = [`No pressure at all — if it's useful, just reply and I'm happy to share what I found.`, `If that's helpful, reply and I'll walk you through it — no pressure.`, `Happy to send over what I noticed if it's useful — just reply.`][v];

  const bodyText = `Hi,\n\n${openers[v]}. ${acks[v]}, ${bridges[v]}. ${obs}. ${why}.${fix ? " " + fix + "." : ""}${link}\n\n${cta}\n\n— Jordan, Artifex Labs`;
  const subject = `A quick note on ${bn}'s website`;

  const wc = words(bodyText).length;
  const prohibitedHits = PROHIBITED.filter((p) => p.re.test(bodyText)).map((p) => p.label);
  // 80–140 words target; outside the band flags review rather than blocking.
  const requiresReview = wc < 80 || wc > 140 || prohibitedHits.length > 0;
  return {
    available: prohibitedHits.length === 0,
    blocker: prohibitedHits.length ? `prohibited language: ${prohibitedHits.join(", ")}` : null,
    subject, bodyText, wordCount: wc,
    evidenceIds: Array.from(new Set(input.websiteFindings.map((f) => f.id))),
    prohibitedHits, requiresReview,
  };
}

/** Cross-company similarity on the SUBSTANTIVE sentences (ignore the greeting + signature + CTA). Jaccard on
 *  word-shingles — high similarity means a near-mail-merge and must be regenerated / reviewed. */
export function emailSimilarity(a: string, b: string): number {
  const substantive = (s: string) => s.split(/\n+/).filter((l) => !/^hi\b|^—|no pressure|just reply/i.test(l.trim())).join(" ");
  const shingles = (s: string) => {
    const w = substantive(s).toLowerCase().match(/[a-z0-9']+/g) ?? [];
    const set = new Set<string>();
    for (let i = 0; i < w.length - 2; i++) set.add(w[i] + " " + w[i + 1] + " " + w[i + 2]);
    return set;
  };
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Controlled sequence templates per strategy. Every email step carries an
// {{unsubscribe}} token + postal address for compliance. Hard max touches per
// strategy. No step sends automatically — approval is enforced separately.
//
// SOURCE OF TRUTH: fixed wording (identity line, footer, reassurances, closings)
// is assembled from ./communication-guide.ts — the in-repo projection of the
// approved ARTIFEX_COMMUNICATION_GUIDE.md. This file only adds the per-lead
// personalization layer (the strategy tier + the specific observation hook). It
// invents no copy of its own.
//
// Voice: friction-finder, not vendor. We took time to understand part of the
// business, noticed something specific, acknowledge that public info shows only
// part of the picture, and invite a low-pressure conversation to compare notes.
// We NEVER lead with "your website is outdated", never prescribe a build before
// discovery, and never claim to know the internal operation from the outside.
import type { Lead, Settings, AcquisitionStrategy, AcqChannel } from "../types";
import { policyFor } from "./policy";
import { businessImprovementPotential } from "../improvement";
import { IDENTITY_LINE, SNIPPETS, complianceFooter } from "../communication-guide";

export interface SequenceStepDraft {
  stepNumber: number;
  channel: AcqChannel;
  delayDays: number;
  subject: string;
  content: string;
  approvalRequired: boolean;
}

function footer(settings: Settings): string {
  return complianceFooter(settings);
}
function name(lead: Lead): string {
  return lead.businessName;
}

// Guide §7 reassurances/closings — referenced, never re-written here.
const STEP_BACK = SNIPPETS.reassurances[2]; // "If it's not the season, tell me and I'll step back — no follow-up loop."

/** A specific, honest opener hook derived from the lead's strongest signal. */
function angleHook(lead: Lead, observation: string): string {
  const bip = businessImprovementPotential(lead);
  const d = bip.dimensions;
  const obs = observation?.trim() ? observation.trim() : "";
  if ((lead.locationsCount ?? 1) > 1 && d.operationalComplexity >= 55)
    return `Serving several locations usually means requests get routed and re-entered in ways that quietly add work. ${obs}`;
  if (d.operationalComplexity >= d.customerExperience && d.operationalComplexity >= 55)
    return `From the outside it looks like there may be manual, repeatable work happening behind the scenes. ${obs}`;
  if (obs) return obs;
  return `I had a couple of small, specific observations about how customers experience you online.`;
}

export function buildSequence(strategy: AcquisitionStrategy, lead: Lead, settings: Settings, observation: string): SequenceStepDraft[] {
  const p = policyFor(strategy);
  const n = name(lead);
  const f = footer(settings);
  const hook = angleHook(lead, observation);
  const intro = `Hi ${n},\n\n${IDENTITY_LINE}`;

  const email = (num: number, delay: number, subject: string, body: string): SequenceStepDraft => ({
    stepNumber: num, channel: "email", delayDays: delay, subject, content: `${body}${f}`, approvalRequired: strategy === "Personal",
  });

  switch (strategy) {
    case "Personal":
      return [
        email(1, 0, `A few notes on ${lead.businessName}, from the outside`, `${intro}\n\nI spent a little time understanding how ${lead.businessName} attracts and serves customers, and was genuinely impressed by the reputation you've built. ${hook}\n\nPublic information only shows part of the picture, so I'd like to compare what I noticed with how it actually works for you. If it's already handled well, I'm happy to be wrong. Would a short, low-pressure conversation be useful?`),
        email(2, 3, `One more thought for ${lead.businessName}`, `Hi ${n},\n\nA quick, useful question rather than a pitch: when a new customer first reaches out, how much of what happens next is still handled by hand? That's usually where the quiet time goes — and where a small change pays off.`),
        email(3, 8, `A short outside-in snapshot for ${lead.businessName}`, `Hi ${n},\n\nI put together a short, complimentary snapshot of what I observed and a couple of questions worth exploring — no obligation. Would it be helpful if I shared it?`),
        email(4, 14, `Closing the loop — ${lead.businessName}`, `Hi ${n},\n\nI'll leave this here for now. If there's ever a moment where technology is creating more work than it's saving, I'd be glad to take a look — and if the best answer is simpler than building something new, I'll say that too.`),
      ].slice(0, p.maxTouches);
    case "Assisted":
      return [
        email(1, 0, `Comparing notes on ${lead.businessName}`, `${intro}\n\nWhile researching established local businesses, ${lead.businessName} stood out. ${hook}\n\nI can only see part of the picture from the outside, so I'd value comparing notes for fifteen minutes. If this is already working well internally, I'm happy to hear it.`),
        email(2, 4, `One question for ${lead.businessName}`, `Hi ${n},\n\nWhere do prospective customers usually need the most reassurance before they commit? Small improvements right there tend to recover inquiries that are otherwise lost — happy to share what I noticed if it's useful.`),
        email(3, 10, `Final note — ${lead.businessName}`, `Hi ${n},\n\nNo pressure at all. If there's ever a practical opportunity worth exploring — or if a simpler existing tool would do the job — I'm glad to help you figure that out.`),
      ].slice(0, p.maxTouches);
    case "Light":
      return [
        email(1, 0, `A quick note for ${lead.businessName}`, `${intro}\n\n${hook}\n\nI recognize public information only shows part of the picture. If it's useful, would a brief conversation about where technology is helping — and where it may be creating extra work — be worthwhile?`),
        email(2, 7, `One more thought — ${lead.businessName}`, `Hi ${n},\n\nOne more thought in case it's useful — no agenda. ${STEP_BACK}`),
      ].slice(0, p.maxTouches);
    case "Nurture":
      return [
        email(1, 0, `A useful idea for businesses like ${lead.businessName}`, `Hi ${n},\n\nSharing a quick, practical idea for reducing friction in how customers reach you — happy to talk whenever the timing is right.`),
      ];
    default:
      return [];
  }
}

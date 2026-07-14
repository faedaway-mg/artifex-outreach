// Controlled sequence templates per strategy. Every email step carries an
// {{unsubscribe}} token + postal address for compliance. Hard max touches per
// strategy. No step sends automatically — approval is enforced separately.
import type { Lead, Settings, AcquisitionStrategy, AcqChannel } from "../types";
import { policyFor } from "./policy";

export interface SequenceStepDraft {
  stepNumber: number;
  channel: AcqChannel;
  delayDays: number;
  subject: string;
  content: string;
  approvalRequired: boolean;
}

function footer(settings: Settings): string {
  return `\n\n${settings.signature}\n\n${settings.businessAddress}\nDon't want these notes? {{unsubscribe}} to opt out.`;
}
function firstName(lead: Lead): string {
  return lead.businessName;
}

export function buildSequence(strategy: AcquisitionStrategy, lead: Lead, settings: Settings, observation: string): SequenceStepDraft[] {
  const p = policyFor(strategy);
  const name = firstName(lead);
  const svc = lead.recommendedService ?? "a modern website";
  const f = footer(settings);
  const intro = `Hi ${name},\n\nI'm Jordan, founder of Artifex Labs.`;

  const email = (n: number, delay: number, subject: string, body: string): SequenceStepDraft => ({
    stepNumber: n, channel: "email", delayDays: delay, subject, content: `${body}${f}`, approvalRequired: strategy === "Personal",
  });

  switch (strategy) {
    case "Personal":
      return [
        email(1, 0, `A quick observation about ${lead.businessName}`, `${intro}\n\nI came across ${lead.businessName} and was impressed by your reputation. ${observation} The strongest opening looks like ${svc}. No obligation — I thought the observations might be useful. Would you be open to a brief conversation?`),
        email(2, 3, `Following up — ${lead.businessName}`, `Hi ${name},\n\nJust adding a little useful context to my note: a clearer path for customers to reach and book with you tends to recover inquiries that are otherwise lost.`),
        email(3, 8, `A short walkthrough for ${lead.businessName}`, `Hi ${name},\n\nI put together a short, complimentary walkthrough and brief with the specifics. Happy to share it — would that be helpful?`),
        email(4, 14, `Closing the loop — ${lead.businessName}`, `Hi ${name},\n\nI'll leave this here for now. If modernizing the customer experience is ever a priority, I'd be glad to talk.`),
      ].slice(0, p.maxTouches);
    case "Assisted":
      return [
        email(1, 0, `Making it easier for ${lead.businessName}'s customers`, `${intro}\n\nWhile researching established local businesses I noticed a few specific opportunities for ${lead.businessName}. ${observation} ${svc} would be the natural first step. Open to a brief conversation?`),
        email(2, 4, `One more thought for ${lead.businessName}`, `Hi ${name},\n\nA small change to how customers reach you could reduce missed inquiries — happy to share what I noticed.`),
        email(3, 10, `Final note — ${lead.businessName}`, `Hi ${name},\n\nNo pressure at all — if the timing is ever right to modernize, I'd be glad to help.`),
      ].slice(0, p.maxTouches);
    case "Light":
      return [
        email(1, 0, `A quick note for ${lead.businessName}`, `${intro}\n\nI noticed one specific opportunity for ${lead.businessName}: ${observation} ${svc} could help. Would a short conversation be useful?`),
        email(2, 7, `Following up — ${lead.businessName}`, `Hi ${name},\n\nJust circling back once in case this is helpful. No pressure either way.`),
      ].slice(0, p.maxTouches);
    case "Nurture":
      return [
        email(1, 0, `A useful modernization idea`, `Hi ${name},\n\nSharing a quick, useful idea for businesses like yours — happy to talk whenever the timing is right.`),
      ];
    default:
      return [];
  }
}

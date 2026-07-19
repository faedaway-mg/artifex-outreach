// ─────────────────────────────────────────────────────────────────────────────
// Client-facing agreement lifecycle emails. Same voice as the Communication Guide
// (calm, outcome-focused, no hype, no "!"), and the same Artifex identity used by
// every other client message. NO AshMap references, always artifexlabs.tech.
//
// These build {subject, body}. Whether they are actually SENT is gated elsewhere
// (AGREEMENT_SENDING_ENABLED + a configured email provider). SignWell sends the
// signature-request email itself; agreementReady is the optional heads-up we send.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement, Settings } from "../types";
import { ARTIFEX_IDENTITY } from "../identity";
import { signatureBlock } from "../communication-guide";

export interface Msg {
  subject: string;
  body: string;
}

const firstName = (fullName: string | null): string => {
  const n = (fullName ?? "").trim().split(/\s+/)[0];
  return n || "there";
};

function usd(cents: number, currency: string): string {
  const amount = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

/** Heads-up that the agreement is on its way for signature (SignWell sends the actual request). */
export function agreementReadyEmail(agreement: Agreement, settings: Settings): Msg {
  const c = agreement.contentSnapshot;
  return {
    subject: `your agreement with Artifex Labs — ${c.agreementNumber}`,
    body:
      `Hi ${firstName(c.clientContactName)},\n\n` +
      `Thank you for moving forward. Your Professional Services Agreement for ${c.projectName} is ready to sign.\n\n` +
      `You'll receive a separate email from SignWell with a secure link to review and sign — no account needed. The agreement reflects what we discussed: ${usd(c.totalPriceCents, c.currency)} total, with a ${c.depositPercent}% deposit to begin.\n\n` +
      `Take your time with it, and reply here with any questions before you sign.` +
      signatureBlock(settings),
  };
}

/** Confirmation after the agreement is signed. */
export function agreementSignedEmail(agreement: Agreement, settings: Settings): Msg {
  const c = agreement.contentSnapshot;
  return {
    subject: `signed — welcome aboard`,
    body:
      `Hi ${firstName(c.clientContactName)},\n\n` +
      `Your agreement is signed — thank you. A fully executed copy is attached to the SignWell completion email for your records.\n\n` +
      `Next, I'll send a short note with the deposit so we can lock in your start. Looking forward to getting to work on ${c.projectName}.` +
      signatureBlock(settings),
  };
}

/** The deposit request. `paymentLinkUrl` is the Stripe payment link (external). */
export function depositRequestEmail(agreement: Agreement, paymentLinkUrl: string, settings: Settings): Msg {
  const c = agreement.contentSnapshot;
  return {
    subject: `deposit to begin — ${c.projectName}`,
    body:
      `Hi ${firstName(c.clientContactName)},\n\n` +
      `To reserve your start, here's the deposit: ${usd(c.depositAmountCents, c.currency)} (${c.depositPercent}% of ${usd(c.totalPriceCents, c.currency)}).\n\n` +
      `You can pay securely here: ${paymentLinkUrl}\n\n` +
      `Once it's in, we'll schedule kickoff and begin. The remaining ${usd(c.remainingBalanceCents, c.currency)} follows the schedule in your agreement.` +
      signatureBlock(settings),
  };
}

/** Confirmation once the deposit is received. */
export function depositReceivedEmail(agreement: Agreement, settings: Settings): Msg {
  const c = agreement.contentSnapshot;
  return {
    subject: `deposit received — let's schedule kickoff`,
    body:
      `Hi ${firstName(c.clientContactName)},\n\n` +
      `Got the deposit — thank you. We're officially underway on ${c.projectName}.\n\n` +
      `I'll follow up shortly to find a kickoff time that works for you. If you'd like to grab one now, here's my calendar: ${settings.calendarLink}` +
      signatureBlock(settings),
  };
}

/** Kickoff scheduling nudge. */
export function kickoffSchedulingEmail(agreement: Agreement, settings: Settings): Msg {
  const c = agreement.contentSnapshot;
  return {
    subject: `scheduling your kickoff`,
    body:
      `Hi ${firstName(c.clientContactName)},\n\n` +
      `Let's get ${c.projectName} started. Kickoff is a short working session where we align on priorities, access, and the first milestone.\n\n` +
      `Grab whatever time suits you here: ${settings.calendarLink}\n\n` +
      `From ${ARTIFEX_IDENTITY.companyName} — glad to be building with you.` +
      signatureBlock(settings),
  };
}

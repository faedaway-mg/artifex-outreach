// ─────────────────────────────────────────────────────────────────────────────
// Money-state separation. Four DISTINCT things the UI must never conflate:
//   1. invoice state     — what the client owes / has been billed;
//   2. collected         — what the processor (Stripe) has confirmed captured;
//   3. payout            — Stripe → bank transfer (aggregates many payments/fees);
//   4. bank receipt      — funds actually reconciled in Relay.
//
// A paid invoice proves (2), never (3) or (4). Relay has no public API (verified in
// M1), so payout/bank reconciliation is inherently out-of-band and UNVERIFIED here.
// These functions deliberately expose collected money only, and NEVER derive a bank
// balance from invoice state. Pure — no IO.
// ─────────────────────────────────────────────────────────────────────────────
import type { Invoice } from "../types";
import { isSettledPositive } from "./invoice";

export interface MoneyView {
  currency: string;
  invoicedCents: number; // sum of all non-void invoice amounts
  // NET collected = paid − refunds − chargeback losses. These are DISTINCT facts,
  // reported separately below so nothing is double-counted or mislabeled.
  collectedCents: number;
  refundedCents: number; // merchant-initiated refunds
  chargebackLostCents: number; // disputes LOST — money withdrawn by the bank (NOT a refund)
  disputedOpenCents: number; // disputes still OPEN — at risk, not yet resolved
  outstandingCents: number; // issued/processing/failed still owed
  // Payout + bank receipt are NOT derivable from the above. Callers must treat
  // these as unknown until reconciled out-of-band against the bank.
  payoutStatus: "unverified";
  bankReceiptStatus: "unverified";
}

export function moneyView(invoices: Invoice[], currency = "usd"): MoneyView {
  let invoiced = 0, collected = 0, refunded = 0, chargebackLost = 0, disputedOpen = 0, outstanding = 0;
  for (const inv of invoices) {
    if (inv.state === "void") continue;
    invoiced += inv.amountCents;
    const paid = isSettledPositive(inv.state);
    const refundedAmt = inv.amountRefundedCents ?? 0;
    // A lost dispute withdraws the disputed amount (fall back to full amount if the
    // disputed amount wasn't recorded). A won/open/none dispute withdraws nothing.
    const lostAmt = inv.disputeStatus === "lost" ? (inv.amountDisputedCents || inv.amountCents) : 0;
    refunded += refundedAmt;
    chargebackLost += paid ? lostAmt : 0;
    if (inv.disputeStatus === "open") disputedOpen += inv.amountDisputedCents || inv.amountCents;
    // Net still-held = paid minus what's been refunded and lost to chargebacks.
    if (paid) collected += Math.max(0, inv.amountCents - refundedAmt - lostAmt);
    if (inv.state === "issued" || inv.state === "processing" || inv.state === "failed") outstanding += inv.amountCents;
  }
  return {
    currency,
    invoicedCents: invoiced,
    collectedCents: collected,
    refundedCents: refunded,
    chargebackLostCents: chargebackLost,
    disputedOpenCents: disputedOpen,
    outstandingCents: outstanding,
    payoutStatus: "unverified",
    bankReceiptStatus: "unverified",
  };
}

/** The caveat to show anywhere collected money is displayed. */
export const PAYOUT_CAVEAT =
  "Collected = confirmed by Stripe. Payout to Relay and bank receipt are separate, aggregate across payments and fees, and are not verified here.";

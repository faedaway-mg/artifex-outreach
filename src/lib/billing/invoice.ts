// ─────────────────────────────────────────────────────────────────────────────
// Invoice state machine + identity helpers. Pure functions only.
//
// Money state is NOT globally forward-only: an invoice can be collected
// (draft → issued → processing → paid) but a later return, refund, or dispute must
// be representable WITHOUT erasing history. Transitions here gate what the domain
// permits; the durable event log (persisted elsewhere) records the actual path.
// ─────────────────────────────────────────────────────────────────────────────

export const INVOICE_STATES = [
  "draft", // prepared locally, not issued to the client
  "issued", // finalized/sent at the provider (hosted invoice exists)
  "processing", // payment in flight (e.g. ACH pending)
  "paid",
  "failed", // a payment attempt failed (invoice may still be collectible)
  "void", // cancelled before payment; no obligation
  "refunded",
  "partially_refunded",
  "disputed",
  "uncollectible", // written off
] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

// Allowed transitions. Collection path is forward; post-payment money events
// (refund/dispute) are reachable from paid and do not erase the paid history.
const TRANSITIONS: Record<InvoiceState, InvoiceState[]> = {
  draft: ["issued", "void"],
  issued: ["processing", "paid", "failed", "void", "uncollectible"],
  processing: ["paid", "failed", "uncollectible"],
  failed: ["processing", "paid", "void", "uncollectible"], // retry or give up
  paid: ["refunded", "partially_refunded", "disputed"],
  partially_refunded: ["refunded", "disputed"],
  disputed: ["paid", "refunded", "uncollectible"], // dispute won → paid, lost → refunded
  refunded: ["disputed"], // a refund can still be disputed/charged back
  void: [],
  uncollectible: ["paid"], // late recovery
};

export function canTransition(from: InvoiceState, to: InvoiceState): boolean {
  if (from === to) return true; // idempotent re-apply
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** True once the client's money has actually been collected and retained. */
export function isSettledPositive(state: InvoiceState): boolean {
  return state === "paid";
}

/**
 * Stable idempotency key binding an invoice to (issuer, agreement, exact version,
 * milestone). Re-issuing the same milestone for the same agreement version yields
 * the same key → duplicate creation is prevented under retries/concurrency.
 */
export function invoiceIdempotencyKey(input: {
  issuerId: string;
  agreementId: string;
  agreementVersion: number;
  milestoneKey: string;
}): string {
  return `inv:${input.issuerId}:${input.agreementId}:v${input.agreementVersion}:${input.milestoneKey}`;
}

/**
 * Coexistence with historical Stripe Checkout deposits: if the deposit milestone
 * was already paid via a legacy Checkout `payments` row, do NOT create a duplicate
 * deposit invoice obligation. Returns true = SKIP creating the deposit invoice.
 */
export function shouldSkipForPaidCheckoutDeposit(
  milestoneKey: string,
  existingPayments: { type: string; status: string }[],
): boolean {
  if (milestoneKey !== "deposit") return false;
  return existingPayments.some((p) => p.type === "deposit" && p.status === "paid");
}

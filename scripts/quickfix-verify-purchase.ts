// Read-only verification of a Fix Scan purchase in the deployed store state.
// Prints safe counts/states only — no secrets. VERIFY_OFFER_ID=qfs_<leadId>.
import * as store from "../src/lib/quick-fix/store";

async function main() {
  const OFFER = process.env.VERIFY_OFFER_ID || "";
  const LEAD = OFFER.replace(/^qfs_/, "");
  const s = await store.getState();
  const jobsForOffer = Object.values(s.jobs).filter((j) => j.offerId === OFFER);
  const job = s.jobs[OFFER];
  const cust = s.customers[LEAD];
  const credit = s.credits[OFFER];
  console.log("OFFER_ID:" + OFFER);
  console.log("JOB_COUNT_FOR_OFFER:" + jobsForOffer.length + "  (expect exactly 1)");
  console.log("JOB_STATE:" + (job?.state ?? "none") + "  purchasedAt:" + (job?.purchasedAt ?? "none"));
  console.log("DELIVERY_CLOCK_STARTED:" + !!job?.fulfillmentClockStartedAt + "  targetDeliveryAt:" + (job?.targetDeliveryAt ?? "none") + "  (expect NOT started pre-intake)");
  console.log("CUSTOMER:" + (cust ? "firstPurchaseType=" + cust.firstPurchaseType + " lifetimeRevenueCents=" + cust.lifetimeRevenueCents + " purchases=" + cust.offersPurchased.length : "NONE"));
  console.log("FIXSCAN_CREDIT_AT_PURCHASE:" + (credit ? "present(used=" + credit.used + ")" : "none — created at scan DELIVERY per terms, not at purchase"));
  console.log("PROCESSED_EVENTS_LEDGER_SIZE:" + s.processedEvents.length + "  (idempotency ledger; dedup by event.id)");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });

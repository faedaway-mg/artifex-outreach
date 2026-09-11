"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Quick Cash operator escape controls (Problem-Reality amendment §14/§40). Reject a
// lead (retire — history preserved, never deleted) and re-run the Problem Reality check.
// Operator-gated; never sends/charges. Thin, audited wrappers over the store.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";

/** Reject / Retire a lead as Not-a-Fit with a canonical reason (§14). Removes it from
 *  active work immediately; the record + reason + audit are preserved. */
export async function rejectLeadAction(formData: FormData): Promise<void> {
  if (!isAuthenticated()) return;
  const offerId = String(formData.get("offerId") ?? "");
  const reason = String(formData.get("reason") ?? "Not a fit").slice(0, 120);
  if (!offerId) return;
  await store.retireOffer(offerId, { reason, actor: "operator", now: new Date().toISOString() });
  revalidatePath("/revenue/quick-cash");
}

"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Breakbot Explainer QA Gallery — server actions. The only mutation is the operator's
// CREATIVE sign-off on an explainer ("Reviewed — Looks Good" / "Needs Fix"), tied to the
// exact asset revision so it resets when the asset changes. Explicit + audited.
//
// SAFETY (§30): a human "reviewed" can NEVER be recorded over a Breakbot BLOCKER. The
// gallery read-model already refuses to let a review flip a BLOCKED badge; this guard
// stops the review from even being written, so the two can never disagree.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/auth";
import { nowIso } from "./store";
import { setExplainerReview, getMediaQaSnapshot, type ReviewVerdict } from "./breakbot/explainer-qa-store";
import { resolveCanonicalExplainer } from "./quick-fix/explainer-library";
import type { TrustVideoScope } from "./quick-fix/trust-videos";

export async function setExplainerReviewAction(scope: string, verdict: ReviewVerdict, note?: string): Promise<{ ok: boolean; reason?: string }> {
  const resolved = await resolveCanonicalExplainer(scope as TrustVideoScope);
  if (resolved.source === "missing" || !resolved.assetRevision) {
    return { ok: false, reason: "no canonical asset to review" };
  }
  if (verdict === "reviewed") {
    // Defence in depth: refuse a positive sign-off while Breakbot blocks THIS revision.
    const snap = await getMediaQaSnapshot(scope);
    if (snap && snap.assetRevision === resolved.assetRevision && snap.status === "BLOCKED") {
      return { ok: false, reason: "Breakbot blocks this asset — resolve the blocker before signing off" };
    }
  }
  await setExplainerReview(
    { scope, assetRevision: resolved.assetRevision, verdict, note: note ?? null, actor: currentActor(), reviewedAt: nowIso() },
    currentActor(),
  );
  revalidatePath("/launch/explainers");
  return { ok: true };
}

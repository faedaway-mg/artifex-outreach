// ─────────────────────────────────────────────────────────────────────────────
// EXPLAINER QA GALLERY (mandate §9/§30) — /launch/explainers.
//
// One operator page to open, scroll through EVERY required explainer, watch each inline,
// see its Breakbot QA status (technical correctness first), and record a creative sign-off.
// Enumerates every required scope from the registry — a scope with no canonical asset shows
// MISSING and is never dropped. Uses the SAME canonical resolver as the offer readiness, so
// what the operator reviews here is exactly what a customer would see on the offer page.
//
// NOT Content Studio, NOT social. Read-only except the human review sign-off.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveExplainerLibrary } from "@/lib/quick-fix/explainer-library";
import { listMediaQaSnapshots, listExplainerReviews } from "@/lib/breakbot/explainer-qa-store";
import { buildExplainerGallery } from "@/lib/breakbot/explainer-gallery";
import { escapedDefectSummary } from "@/lib/breakbot/escaped-defects";
import { ExplainerGallery } from "@/components/breakbot/ExplainerGallery";

export const dynamic = "force-dynamic";

export default async function ExplainersPage() {
  const [resolved, snapshots, reviews] = await Promise.all([
    resolveExplainerLibrary(),
    listMediaQaSnapshots(),
    listExplainerReviews(),
  ]);
  const model = buildExplainerGallery(resolved, snapshots, reviews);
  const escaped = escapedDefectSummary();
  return <ExplainerGallery model={model} escapedTotal={escaped.total} />;
}

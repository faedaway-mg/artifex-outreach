// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — RELEASE QA cockpit (mandate §25). Launch Readiness → Breakbot. A readable
// surface of what Breakbot enforces before a release reaches production: the synthetic
// user journeys, the business-contract invariants, the escaped-defect regressions, and
// the explainer coverage. Not raw logs — the operator's at-a-glance "is the release
// authority healthy" view. Deep evidence lives in the Explainer QA Gallery + reports.
// ─────────────────────────────────────────────────────────────────────────────
import { ESCAPED_DEFECTS, escapedDefectSummary } from "@/lib/breakbot/escaped-defects";
import { BUSINESS_INVARIANTS } from "@/lib/breakbot/business-invariants";
import { JOURNEYS, PERSONAS } from "@/lib/breakbot/personas";
import { resolveExplainerLibrary } from "@/lib/quick-fix/explainer-library";
import { listMediaQaSnapshots, listExplainerReviews } from "@/lib/breakbot/explainer-qa-store";
import { buildExplainerGallery } from "@/lib/breakbot/explainer-gallery";
import { BreakbotOverview } from "@/components/breakbot/BreakbotOverview";

export const dynamic = "force-dynamic";

export default async function BreakbotPage() {
  const [resolved, snaps, reviews] = await Promise.all([
    resolveExplainerLibrary(),
    listMediaQaSnapshots(),
    listExplainerReviews(),
  ]);
  const gallery = buildExplainerGallery(resolved, snaps, reviews);
  return (
    <BreakbotOverview
      escaped={ESCAPED_DEFECTS}
      escapedSummary={escapedDefectSummary()}
      invariants={BUSINESS_INVARIANTS}
      journeys={JOURNEYS.map((j) => ({ id: j.id, persona: j.persona, title: j.title, mandateRef: j.mandateRef, viewport: j.viewport, steps: j.steps.length }))}
      personaCount={Object.keys(PERSONAS).length}
      coverage={gallery.summary}
    />
  );
}

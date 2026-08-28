// ─────────────────────────────────────────────────────────────────────────────
// Lightweight operator review page (Gate 3). Server component: fetches the effective review +
// editorial state + delivery readiness via the existing editorStateAction, then hands them to a
// small client panel with exactly 4 controls (Preview, Approve, Regenerate, Skip/Hold). NO
// business logic lives here — it only reads and renders.
// ─────────────────────────────────────────────────────────────────────────────
import { ClipboardCheck } from "lucide-react";
import { editorStateAction } from "@/lib/outreach/review-editor-actions";
import { EmptyState } from "@/components/ui";
import { OperatorReviewPanel } from "./OperatorReviewPanel";

export const dynamic = "force-dynamic";

export default async function OperatorReviewPage({ params }: { params: { id: string } }) {
  const data = await editorStateAction(params.id);

  if (!data || !data.readiness) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No review to operate on yet."
        hint="This lead has no Quick Review to preview, approve, or hold. Analyze the business first, then return here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <ClipboardCheck size={16} className="text-azure-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Operator review</h1>
        <span className="text-[12px] text-chalk-500">· preview, approve, regenerate, or hold — nothing is ever sent from here</span>
      </div>
      <OperatorReviewPanel leadId={params.id} review={data.review} state={data.state} readiness={data.readiness} />
    </div>
  );
}

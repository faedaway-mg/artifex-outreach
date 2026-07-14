import { listLeads } from "@/lib/repo";
import { PipelineBoard } from "@/components/PipelineBoard";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const leads = await listLeads();
  return (
    <div className="space-y-6">
      <div>
        <p className="label">Pipeline</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Every lead, by stage</h1>
        <p className="mt-1 text-sm text-chalk-400">Drag a card between columns to change its stage, or switch to the table view.</p>
      </div>
      <PipelineBoard leads={leads} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { opportunityWorkspaceView, persuasionFlowView } from "@/lib/quick-fix/operator-views";
import { OpportunityWorkspace } from "@/components/quick-fix/OpportunityWorkspace";

export const dynamic = "force-dynamic";

// OPERATOR opportunity command center for ONE prepared offer. Mobile-first: the
// first screen answers WHO · Open Website · STATUS · what we found · what we sell +
// price · evidence presence · PRIMARY NEXT ACTION. Behind the (app) auth layout.
// Read-only surface — the only mutation is the gated outreach action buttons, and
// nothing here can itself send (the /api/revenue/send endpoint is the gated path).
export default async function OpportunityPage({ params, searchParams }: { params: { offerId: string }; searchParams: { tab?: string } }) {
  const w = await opportunityWorkspaceView(params.offerId);
  if (!w) notFound();
  // The operator persuasion-flow PREVIEW (read-only) — inspected before approving.
  const persuasion = await persuasionFlowView(params.offerId).catch(() => null);
  return (
    <div className="space-y-3">
      <Link href="/revenue/quick-cash" className="mx-auto block max-w-2xl text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Cash</Link>
      <OpportunityWorkspace w={w} persuasion={persuasion} initialTab={searchParams?.tab} />
    </div>
  );
}

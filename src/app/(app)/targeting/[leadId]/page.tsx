import Link from "next/link";
import { notFound } from "next/navigation";
import { X } from "lucide-react";
import { buildTargetingBoard } from "@/lib/targeting/board";

export const dynamic = "force-dynamic";

// DEDICATED "WHY THIS BUSINESS" (mandate 27). Full-page, mobile tap-through target detail: score breakdown,
// reputation earned, website gap, strongest opportunity, recipient rationale, disqualifiers, recommended asset.
export default async function TargetingDetailPage({ params, searchParams }: { params: { leadId: string }; searchParams?: { from?: string } }) {
  const board = await buildTargetingBoard({});
  const t = board.cards.find((c) => c.leadId === params.leadId);
  if (!t) notFound();
  const back = searchParams?.from ? decodeURIComponent(searchParams.from) : "/targeting";
  const w = t.why;
  const comp = t.score.components;

  return (
    <div className="mx-auto w-full max-w-3xl" data-target-detail={t.leadId}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href={back} aria-label="Back to targeting" data-target-back className="rounded-lg border border-white/10 p-2 text-chalk-400 hover:text-chalk-100"><X size={16} /></Link>
        <div className="min-w-0 text-center">
          <div className="truncate text-sm font-semibold text-chalk-50">{t.businessName}</div>
          <div className="text-[11px] text-chalk-500">{t.city}, {t.state} · {t.marketTier} market</div>
        </div>
        <span data-target-band={t.band} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-chalk-200">{t.band.replace(/_/g, " ")} · {t.total}</span>
      </div>

      <div data-why-business className="card space-y-3 p-4 text-[12.5px] leading-relaxed text-chalk-300">
        <Row label="Persona fit" v={w.personaFit} />
        <Row label="Reputation earned" v={w.reputationEarned} />
        <Row label="Website gap" v={w.websiteGap} />
        <Row label="Strongest opportunity" v={w.strongestOpportunity} mark="data-strongest-opportunity" />
        <Row label="Recipient" v={w.recipientRationale} mark="data-recipient" />
        <Row label="Why this market" v={w.marketReason} />
        <Row label="Disqualifiers" v={w.disqualifiers} />
        <Row label="Recommended asset" v={w.recommendedAsset} mark="data-recommended-asset" />
      </div>

      <div className="card mt-4 p-4">
        <h3 className="mb-2 text-[13px] font-semibold text-chalk-100">Score breakdown <span className="text-chalk-500">· {t.total}/100</span></h3>
        <ul data-score-breakdown className="grid grid-cols-2 gap-1.5 text-[11.5px] text-chalk-400 sm:grid-cols-4">
          <Comp k="Reputation" v={comp.reputationStrength} max={15} />
          <Comp k="Digital gap" v={comp.digitalReputationGap} max={25} />
          <Comp k="Evidence" v={comp.evidenceSpecificity} max={15} />
          <Comp k="Access" v={comp.decisionMakerAccess} max={10} />
          <Comp k="Value" v={comp.customerValue} max={10} />
          <Comp k="Market" v={comp.marketFit} max={10} />
          <Comp k="Growth" v={comp.growthTiming} max={10} />
          <Comp k="Recipient" v={comp.recipientConfidence} max={5} />
        </ul>
        {t.score.penalties.length > 0 && <p className="mt-2 text-[11px] text-amber-300">Penalties: {t.score.penalties.map((p) => `${p.code}(${p.points})`).join(", ")}</p>}
      </div>

      <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-chalk-500">
        Evidence backing this target: {w.evidenceIds.length ? w.evidenceIds.join(", ") : "none"}. This view is read-only — preparation, approval, scheduling, and sending happen only through the operator's explicit canonical actions elsewhere.
      </div>
    </div>
  );
}

function Row({ label, v, mark }: { label: string; v: string; mark?: string }) {
  const props = mark ? { [mark]: "1" } : {};
  return <p {...props}><span className="font-medium text-chalk-200">{label}:</span> {v}</p>;
}
function Comp({ k, v, max }: { k: string; v: number; max: number }) {
  return <li className="flex items-center justify-between rounded border border-white/[0.06] px-2 py-1"><span>{k}</span><span className="text-chalk-200">{v}/{max}</span></li>;
}

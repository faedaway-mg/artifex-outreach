import Link from "next/link";
import { Zap, Wrench, Users, MessageSquare, ShieldCheck, ArrowRight, DollarSign } from "lucide-react";
import { quickCashHomeView } from "@/lib/quick-fix/operator-views";
import { sprintScoreboardView } from "@/lib/quick-fix/sprint-view";
import { PrepareOfferButton } from "@/components/quick-fix/PrepareOfferButton";

export const dynamic = "force-dynamic";
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;

// DEFAULT HOME (Quick-Cash Consolidation): Acquisition OS opens on the money loop —
// "what can we sell right now?" — not the legacy Today queue (now at /today). Shows
// the revenue metrics band, the reclassification inventory, and the ranked, ready-
// to-sell opportunity feed. Legacy cold outreach is frozen; nothing here sends.
export default async function HomePage() {
  const { rows, routing, inventory, metrics } = await quickCashHomeView();
  const { scoreboard } = await sprintScoreboardView();
  const eligible = rows.filter((r) => r.eligible);
  const top = eligible.slice(0, 12);

  const tiles = [
    { label: "Ready to sell", value: String(metrics.readyToSell), accent: "text-teal-300" },
    { label: "Addressable", value: usd(metrics.addressableRevenueCents), accent: "text-chalk-50" },
    { label: "In fulfillment", value: String(metrics.inFulfillment), accent: "text-amber-300" },
    { label: "Customers", value: String(metrics.customers), accent: "text-chalk-50" },
    { label: "Revenue", value: usd(metrics.revenueCents), accent: "text-teal-300" },
    { label: "Purchases", value: String(metrics.purchases), accent: "text-chalk-50" },
    { label: "Engaged", value: String(metrics.engaged), accent: "text-chalk-50" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="eyebrow flex items-center gap-1.5"><Zap size={13} className="text-amber-300" /> Quick-Cash</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">What can we sell right now?</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Ranked by transaction quality — gross profit per operator hour, not price. A ready $249 outranks a vague big project.</p>
      </div>

      {metrics.coldOutreachFrozen && (
        <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] text-chalk-400">
          <ShieldCheck size={15} className="mt-0.5 flex-none text-teal-300" />
          <span>Legacy cold outreach is <span className="text-chalk-200">frozen</span> — Quick-Cash is the primary pipeline. New leads enter classification first; the old acquisition path no longer sends prospect email by default. Replies &amp; customer comms are unaffected.</span>
        </div>
      )}

      {/* Money-loop metrics band */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-chalk-500">{t.label}</div>
            <div className={`text-lg font-semibold tabular-nums ${t.accent}`}>{t.value}</div>
          </div>
        ))}
        <Link href="/revenue/fulfillment" className="card flex items-center justify-between p-3 transition-colors hover:bg-white/[0.05]">
          <span className="flex items-center gap-2 text-[12.5px] text-chalk-300"><Wrench size={14} className="text-amber-300" /> Fulfillment</span>
          <ArrowRight size={13} className="text-chalk-500" />
        </Link>
      </div>

      {/* Quick-Cash sprint / graduation — 20 checkpoint · 50 graduation (finite bridge, not the destination). */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-medium text-chalk-300">Quick-Cash sprint</span>
          <span className="tabular-nums text-chalk-400">{scoreboard.completedJobs} / {scoreboard.graduation} jobs {scoreboard.reachedCheckpoint ? "· checkpoint reached" : `· ${scoreboard.checkpoint} = checkpoint`}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-teal-400/70" style={{ width: `${Math.round(scoreboard.progressToGraduation * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-[11.5px] text-chalk-500">
          revenue {usd(scoreboard.grossRevenueCents)} · repeat {scoreboard.repeatCustomers} · recurring {scoreboard.recurringCustomers} · references ready {scoreboard.referenceReady} (approved {scoreboard.referencesApproved}) · capability proofs {scoreboard.capabilityProofs}.
        </p>
      </div>

      {/* Honest usable-inventory funnel — raw discovery is NOT sellable inventory. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-[12px] text-chalk-500">
        <p>
          Funnel — {inventory.funnel.totalDiscovered} discovered · {inventory.funnel.hasWebsite} w/ website · {inventory.funnel.emailable} emailable · {inventory.funnel.commerciallyQualified} commercially-qualified · {inventory.funnel.evidenceQualified} evidence-qualified · <span className="text-teal-300">{inventory.funnel.readyToSell} ready to sell</span>.
        </p>
        <p className="mt-1">
          Not sellable (preserved) — no-email {inventory.disqualified.noEmail} · no-website {inventory.disqualified.noWebsite} · suppressed {inventory.disqualified.suppressed} · overlap {inventory.disqualified.competitiveOverlap} · weak-fit {inventory.disqualified.weakCommercialFit} · weak-evidence {inventory.disqualified.weakEvidence} · jurisdiction {inventory.disqualified.jurisdictionBlocked + inventory.disqualified.jurisdictionUnknown}.
        </p>
        <p className="mt-1 text-chalk-600">
          Routes — DIRECT_FIX {routing.DIRECT_FIX} · FIX_SCAN {routing.FIX_SCAN} · CONVERSATION {routing.CONVERSATION_REQUIRED} · NO_FIX {routing.NO_FIX_FOUND} · customers {inventory.customers} · legacy-frozen {inventory.legacyFrozenScheduled}.
        </p>
      </div>

      {/* Ranked opportunity feed */}
      {top.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No confidently-sellable fixes in the current inventory yet.</div>
      ) : (
        <ul className="space-y-2.5">
          {top.map((r) => (
            <li key={r.leadId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                  <div className="mt-0.5 text-[12.5px] text-chalk-400">{r.offerName} — {r.problem}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[16px] font-bold text-chalk-50">{usd(r.priceCents)}</div>
                  <div className="text-[11px] text-chalk-500">{r.band} · {r.sla || "—"}</div>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-chalk-500">
                <span>SKU <span className="text-chalk-300">{r.matchedSku ?? "—"}</span></span>
                <span>Fixability <span className="text-chalk-300">{r.score}</span></span>
                <span>~{r.estimatedHours}h · {usd(r.effectiveHourlyCents)}/hr</span>
                <span>evidence conf <span className="text-chalk-300">{r.confidence.toFixed(2)}</span></span>
                <span className={r.readyToSell ? "text-teal-300" : "text-amber-300"}>{r.readyToSell ? "READY TO SELL" : r.fixabilityState}</span>
              </div>
              <div className="mt-3"><PrepareOfferButton leadId={r.leadId} /></div>
            </li>
          ))}
        </ul>
      )}

      {/* Money-loop quick links */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 pt-1">
        <Link href="/revenue/quick-cash" className="card flex items-center justify-between p-3 text-[12.5px] text-chalk-300 transition-colors hover:bg-white/[0.05]"><span className="flex items-center gap-2"><DollarSign size={14} className="text-teal-300" /> All opportunities</span><ArrowRight size={13} className="text-chalk-500" /></Link>
        <Link href="/revenue/customers" className="card flex items-center justify-between p-3 text-[12.5px] text-chalk-300 transition-colors hover:bg-white/[0.05]"><span className="flex items-center gap-2"><Users size={14} className="text-azure-300" /> Customers</span><ArrowRight size={13} className="text-chalk-500" /></Link>
        <Link href="/meetings" className="card flex items-center justify-between p-3 text-[12.5px] text-chalk-300 transition-colors hover:bg-white/[0.05]"><span className="flex items-center gap-2"><MessageSquare size={14} className="text-teal-300" /> Replies</span><ArrowRight size={13} className="text-chalk-500" /></Link>
        <Link href="/today" className="card flex items-center justify-between p-3 text-[12.5px] text-chalk-400 transition-colors hover:bg-white/[0.05]"><span>Today (queue)</span><ArrowRight size={13} className="text-chalk-500" /></Link>
      </div>
    </div>
  );
}

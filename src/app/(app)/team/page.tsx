// ─────────────────────────────────────────────────────────────────────────────
// Team — who is carrying what, and what the scheduler is about to do about it.
//
// This page exists so that ownership stays explainable. It shows load, not rank:
// the point is never who is winning, it is whether any business is about to sit
// still because the person accountable for it cannot move it right now.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { Users, AlertTriangle, Inbox, Scale } from "lucide-react";
import {
  listOperators, listLeads, allTasks, allPlans, allMeetings, allEmailSends, allInbound,
} from "@/lib/repo";
import { currentOperatorId } from "@/lib/auth";
import { computeOperatorMetrics } from "@/lib/operators/metrics";
import { planDistribution } from "@/lib/operators/assignment";
import { needsAttention } from "@/lib/operators/scope";
import { distributionEnabled } from "@/lib/operators/distribute";
import { AVAILABILITY_LABEL, AVAILABILITY_MEANING, initialsOf, shortName } from "@/lib/operators/model";
import { OperatorControls } from "@/components/OperatorControls";
import { RebalancePanel } from "@/components/RebalancePanel";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const hours = (v: number | null) => (v == null ? "—" : v < 1 ? `${Math.round(v * 60)}m` : v < 48 ? `${v.toFixed(1)}h` : `${Math.round(v / 24)}d`);

export default async function TeamPage() {
  const [operators, leads, tasks, plans, meetings, emailSends, inbound] = await Promise.all([
    listOperators(), listLeads(), allTasks(), allPlans(), allMeetings(), allEmailSends(), allInbound(),
  ]);

  const now = new Date();
  const viewerId = currentOperatorId();
  const ctx = { plans, meetings };
  const metrics = computeOperatorMetrics({ operators, leads, tasks, emailSends, inbound, meetings, now });
  const metricsById = new Map(metrics.map((m) => [m.operatorId, m]));

  // What the nightly maintain pass would do right now — shown, not hidden, so an
  // operator is never surprised by a business changing hands overnight.
  const upcoming = planDistribution({ operators, leads, tasks, ctx, now, mode: "maintain" });
  const leadName = new Map(leads.map((l) => [l.id, l.businessName]));
  const opName = new Map(operators.map((o) => [o.id, shortName(o)]));

  const unassigned = leads.filter((l) => !l.assignedTo).length;
  const atRisk = leads.filter((l) => needsAttention({ lead: l, operators, ctx, now })).length;

  if (!operators.length) {
    return <EmptyState title="No operators yet" hint="The workspace has no operators configured. Run the migration to seed them." />;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-chalk-50">
          <Users size={18} className="text-azure-300" /> Team
        </h1>
        <p className="mt-1 text-sm text-chalk-400">
          Ownership exists to ensure accountability, not exclusivity. Every qualified business has someone answerable for it.
        </p>
      </header>

      {/* ── Standing signals ─────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/?view=unassigned" className="card flex items-center gap-3 p-4 hover:bg-white/[0.03]">
          <Inbox size={18} className="text-chalk-400" />
          <div>
            <p className="text-sm font-medium text-chalk-100">{unassigned} unassigned</p>
            <p className="text-[11px] text-chalk-500">Nobody is accountable for these yet.</p>
          </div>
        </Link>
        <Link href="/?view=team" className="card flex items-center gap-3 p-4 hover:bg-white/[0.03]">
          <AlertTriangle size={18} className={atRisk ? "text-amber-300" : "text-chalk-400"} />
          <div>
            <p className="text-sm font-medium text-chalk-100">{atRisk} at risk of stalling</p>
            <p className="text-[11px] text-chalk-500">Unassigned, unavailable owner, or ownership expired.</p>
          </div>
        </Link>
      </div>

      {/* ── Operators ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        {operators.map((op) => {
          const m = metricsById.get(op.id)!;
          const over = m.load > 1;
          return (
            <div key={op.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-azure-500/15 text-sm font-semibold text-azure-200 ring-1 ring-azure-400/25">
                    {initialsOf(op)}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-chalk-50">
                      {op.name}
                      {op.id === viewerId && <span className="ml-2 text-[11px] font-normal text-chalk-500">you</span>}
                    </p>
                    <p className="text-[11px] text-chalk-500">
                      {AVAILABILITY_LABEL[op.availabilityMode]} · {AVAILABILITY_MEANING[op.availabilityMode]}
                    </p>
                  </div>
                </div>
                <OperatorControls
                  operatorId={op.id}
                  availabilityMode={op.availabilityMode}
                  dailyCapacity={op.dailyCapacity}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-5">
                <Metric label="Businesses owned" value={String(m.leadsOwned)} href={`/?view=${op.id}`} />
                <Metric label="Today's load" value={`${m.dueToday}/${m.capacity}`} tone={over ? "text-coral-300" : undefined} />
                <Metric label="Calls today" value={String(m.callsCompletedToday)} />
                <Metric label="Emails today" value={String(m.emailsSentToday)} />
                <Metric label="Reviews today" value={String(m.reviewsDeliveredToday)} />
                <Metric label="Follow-ups due" value={String(m.followUpsDue)} />
                <Metric label="Meetings booked" value={String(m.meetingsBooked)} />
                <Metric label="Response rate" value={pct(m.responseRate)} />
                <Metric label="Median reply time" value={hours(m.medianResponseHours)} />
              </div>
            </div>
          );
        })}
      </section>

      {/* ── What the scheduler will do ───────────────────────────────────────── */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-200">
          <Scale size={15} className="text-azure-300" /> Scheduled ownership changes
        </h2>
        <p className="mt-0.5 text-[11px] text-chalk-500">
          What the next automatic pass would do with today&apos;s state. Live conversations are never moved automatically.
        </p>
        <div className="mt-3 space-y-2">
          {upcoming.reassignments.length === 0 ? (
            <p className="card p-4 text-sm text-chalk-400">Nothing needs to move. Every business has an operator who can work it.</p>
          ) : (
            upcoming.reassignments.map((r) => (
              <div key={r.leadId} className="card p-4">
                <p className="text-sm text-chalk-100">
                  <Link href={`/leads/${r.leadId}`} className="font-medium hover:text-azure-200">{leadName.get(r.leadId) ?? r.businessName}</Link>
                  <span className="text-chalk-500"> → </span>
                  <span className="text-azure-200">{opName.get(r.to) ?? r.to}</span>
                </p>
                <p className="mt-1 text-[11px] text-chalk-500">{r.reason}</p>
                <p className="mt-0.5 text-[11px] text-chalk-600">{r.because.join(" · ")}</p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Deliberate rebalance ─────────────────────────────────────────────── */}
      <RebalancePanel enabled={distributionEnabled()} />
    </div>
  );
}

function Metric({ label, value, tone, href }: { label: string; value: string; tone?: string; href?: string }) {
  const body = (
    <>
      <p className={`font-mono text-lg font-semibold tabular-nums ${tone ?? "text-chalk-100"}`}>{value}</p>
      <p className="text-[11px] text-chalk-500">{label}</p>
    </>
  );
  return href ? <Link href={href} className="block hover:opacity-80">{body}</Link> : <div>{body}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Engagement Command Center — the operator's home for one business.
//
// One calm surface that answers "what needs my attention right now?" and quietly
// leads to the next step. It composes the intelligence foundation; it invents nothing.
// Attention items come first (surfaced, never nagging), then where things stand, then
// the single continuous timeline. Every card links to where the work actually lives.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import {
  AlertCircle, Compass, Activity, Rocket, Wrench, Ban, ClipboardCheck, Lightbulb, MessagesSquare, CalendarClock, History, ArrowRight, Brain, Route, Trophy,
} from "lucide-react";
import type { CommandCenter as CC, FollowUpItem, TimelineEntry } from "@/lib/engagement";

const SEV_STYLE = { high: "border-coral-400/30 text-coral-300", medium: "border-amber-400/30 text-amber-300", low: "border-white/10 text-chalk-400" } as const;
const SRC_LABEL: Record<TimelineEntry["source"], string> = {
  meeting: "Meeting", memory: "Learned", reasoning: "Reasoning", roadmap: "Roadmap", outcome: "Outcome",
  evolution: "Change", email: "Email", reply: "Reply", proposal: "Proposal", snapshot: "Baseline",
};

function fmt(at: string): string {
  const d = new Date(at);
  return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Card({ icon, title, right, children }: { icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <span className="text-chalk-500">{icon}</span>
        <h2 className="text-sm font-semibold text-chalk-100">{title}</h2>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PendingRow({ item }: { item: FollowUpItem }) {
  return (
    <Link href={item.nextHref} className="block rounded-lg border border-white/[0.06] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-chalk-100">{item.title}</p>
          <p className="mt-0.5 text-[12.5px] text-chalk-400">{item.why}</p>
          <p className="mt-1 text-[11px] text-chalk-600">Evidence · {item.evidence}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${SEV_STYLE[item.severity]}`}>{item.severity}</span>
      </div>
      <p className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-azure-300">{item.nextLabel} <ArrowRight size={12} /></p>
    </Link>
  );
}

export function CommandCenter({ cc, leadId }: { cc: CC; leadId: string }) {
  const base = `/leads/${leadId}`;
  return (
    <div className="space-y-6">
      {/* ── Where things stand ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-chalk-500"><Compass size={12} /> Stage</div>
          <p className="mt-1 text-[15px] font-semibold text-chalk-100">{cc.stage?.key ?? "—"}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-chalk-500"><Activity size={12} /> Relationship</div>
          <p className="mt-1 text-[15px] font-semibold text-chalk-100">{cc.healthReached}/{cc.healthTotal}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-chalk-500"><Activity size={12} /> Momentum</div>
          <p className={`mt-1 text-[15px] font-semibold ${cc.momentum.tone}`}>{cc.momentum.label}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-chalk-500"><ClipboardCheck size={12} /> Awaiting review</div>
          <p className={`mt-1 text-[15px] font-semibold ${cc.awaitingReviewCount ? "text-amber-300" : "text-chalk-100"}`}>{cc.awaitingReviewCount}</p>
        </div>
      </div>

      {/* ── What needs my attention now ──────────────────────────────────────── */}
      <Card icon={<AlertCircle size={16} />} title="What needs your attention" right={cc.pending.length > 0 ? <span className="text-[11px] text-chalk-600">{cc.pending.length}</span> : undefined}>
        {cc.pending.length > 0 ? (
          <div className="space-y-2">{cc.pending.map((p) => <PendingRow key={p.id} item={p} />)}</div>
        ) : (
          <p className="text-[13px] text-chalk-500">Nothing pending. The next move is whatever conversation moves the relationship forward.</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Current recommendation + priorities ────────────────────────────── */}
        <Card icon={<Rocket size={16} />} title="Where to focus" right={<Link href={`${base}/roadmap`} className="text-[11px] text-azure-300 hover:text-chalk-100">Roadmap →</Link>}>
          {cc.currentRecommendation ? (
            <div className="rounded-lg border border-white/[0.06] p-3">
              <p className="text-[13.5px] font-medium text-chalk-100">{cc.currentRecommendation.title}</p>
              <p className="mt-0.5 text-[12.5px] text-chalk-400">{cc.currentRecommendation.reason}</p>
            </div>
          ) : (
            <p className="text-[13px] text-chalk-500">No recommendation sequenced yet — keep learning first.</p>
          )}
          {cc.priorities.length > 1 && (
            <ul className="mt-2 space-y-1">
              {cc.priorities.slice(1).map((p) => <li key={p.recommendationId} className="text-[12.5px] text-chalk-400">· {p.title}</li>)}
            </ul>
          )}
        </Card>

        {/* ── In progress + blockers ─────────────────────────────────────────── */}
        <Card icon={<Wrench size={16} />} title="In motion">
          {cc.currentImplementation.length > 0 ? (
            <ul className="space-y-1.5">
              {cc.currentImplementation.map((i) => <li key={i.recommendationId} className="text-[13px] text-chalk-200">● {i.title}</li>)}
            </ul>
          ) : (
            <p className="text-[13px] text-chalk-500">Nothing in delivery right now.</p>
          )}
          {cc.blockers.length > 0 && (
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <p className="flex items-center gap-1 text-[11px] text-coral-300"><Ban size={12} /> Blocked</p>
              <ul className="mt-1 space-y-0.5">{cc.blockers.map((b) => <li key={b.recommendationId} className="text-[12.5px] text-chalk-400">{b.title}</li>)}</ul>
            </div>
          )}
        </Card>

        {/* ── Latest learning ────────────────────────────────────────────────── */}
        <Card icon={<Lightbulb size={16} />} title="Latest learning" right={<Link href={`${base}/relationship`} className="text-[11px] text-azure-300 hover:text-chalk-100">Memory →</Link>}>
          {cc.latestLearning.length > 0 ? (
            <ul className="space-y-1.5">
              {cc.latestLearning.map((m) => <li key={m.id} className="text-[13px] text-chalk-300">{m.title} <span className="text-chalk-600">· {m.category}</span></li>)}
            </ul>
          ) : (
            <p className="text-[13px] text-chalk-500">Nothing captured yet.</p>
          )}
        </Card>

        {/* ── Recent communications + upcoming ───────────────────────────────── */}
        <Card icon={<MessagesSquare size={16} />} title="Conversation">
          {cc.upcomingFollowUp && (
            <p className="flex items-center gap-1.5 text-[13px] text-azure-200"><CalendarClock size={13} /> Next · {fmt(cc.upcomingFollowUp.scheduledAt)}</p>
          )}
          {cc.recentComms.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {cc.recentComms.map((e, i) => <li key={i} className="text-[12.5px] text-chalk-400"><span className="text-chalk-600">{fmt(e.at)} · </span>{e.title}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-chalk-500">No conversations recorded yet.</p>
          )}
        </Card>
      </div>

      {/* ── One continuous timeline ──────────────────────────────────────────── */}
      <Card icon={<History size={16} />} title="The engagement, end to end">
        {cc.timeline.length > 0 ? (
          <ul className="space-y-2">
            {cc.timeline.map((e, i) => (
              <li key={i} className="flex gap-3 text-[13px]">
                <span className="w-16 shrink-0 text-[11px] text-chalk-600">{fmt(e.at)}</span>
                <span className="w-16 shrink-0 text-[10.5px] text-chalk-500">{SRC_LABEL[e.source]}</span>
                <span className="text-chalk-300">{e.title}{e.detail ? <span className="text-chalk-600"> · {e.detail}</span> : null}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-chalk-500">The story starts as soon as the first conversation happens.</p>
        )}
      </Card>

      {/* ── Quiet way into every subsystem ───────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[
          { href: `${base}/discovery`, label: "Discovery", icon: Compass },
          { href: `${base}/reasoning`, label: "Strategist", icon: Brain },
          { href: `${base}/roadmap`, label: "Roadmap", icon: Route },
          { href: `${base}/outcomes`, label: "Outcomes", icon: Trophy },
        ].map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-3 py-1.5 text-[12.5px] text-chalk-300 hover:border-white/15 hover:text-chalk-100">
              <Icon size={13} /> {l.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

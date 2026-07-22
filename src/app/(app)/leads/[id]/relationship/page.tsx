// Relationship Overview — think in relationships, not projects.
// A calm read of where a business sits with Artifex: stage, trust, momentum, the
// history so far, what's underway, and the next conversation worth having. Money is
// context at the very bottom, never the headline.
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Compass,
  ShieldCheck,
  Activity,
  History,
  CheckCircle2,
  Rocket,
  Sprout,
  MessageCircle,
  GitBranch,
} from "lucide-react";
import {
  getLead,
  getBusinessIntelligence,
  plansForLead,
  meetingsForLead,
  proposalsForLead,
  deliverablesForLead,
  videosForLead,
  outreachForLead,
  inboundForLead,
  previewsForLead,
  findingsForLead,
  memoryForLead,
} from "@/lib/repo";
import { collectTimeline } from "@/lib/acquisition/timeline";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { RelationshipMemory } from "@/components/lead/RelationshipMemory";
import { EvolutionTimeline } from "@/components/lead/EvolutionTimeline";
import { JourneyBadge } from "@/components/JourneyBadge";
import { journeyPhaseOf, JOURNEY_META } from "@/lib/journey";
import { estimateRelationshipValue } from "@/lib/pricing";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The timeline records label/at; we read title|label + optional detail defensively.
type Timelineish = { at?: string; kind?: string; title?: string; label?: string; detail?: string };

const PARTNER_PHASES = new Set([
  "Focused Improvement",
  "Partnership Active",
  "Expansion Opportunity",
  "Relationship Mature",
]);

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-chalk-400">
      {children}
    </span>
  );
}

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100">
      <span className="text-chalk-500">{icon}</span>
      {children}
    </h2>
  );
}

function fmtDate(at: string | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  return isNaN(+d) ? "" : d.toLocaleDateString();
}

export default async function RelationshipOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [
    bi,
    plans,
    meetings,
    proposals,
    deliverables,
    videos,
    outreach,
    inbound,
    previews,
    findings,
    memory,
  ] = await Promise.all([
    getBusinessIntelligence(lead.id),
    plansForLead(lead.id),
    meetingsForLead(lead.id),
    proposalsForLead(lead.id),
    deliverablesForLead(lead.id),
    videosForLead(lead.id),
    outreachForLead(lead.id),
    inboundForLead(lead.id),
    previewsForLead(lead.id),
    findingsForLead(lead.id),
    memoryForLead(lead.id),
  ]);

  const p = bi?.profile;
  const phase = journeyPhaseOf(lead);
  const rv = estimateRelationshipValue(lead);

  // ── Engagement history (unified timeline, most recent first) ────────────────
  const events = (collectTimeline({
    lead,
    findings,
    deliverables,
    videos,
    shares: [],
    meetings,
    proposals,
    plans,
    outreach,
    inbound,
  }) as Timelineish[])
    .slice()
    .sort((a, b) => +new Date(b.at ?? 0) - +new Date(a.at ?? 0));

  const lastEvent = events[0];
  const lastTouchAt = lastEvent?.at;

  // ── Trust level (evidence confidence + journey phase) ───────────────────────
  function trustLevel(): { label: string; note: string } {
    if (phase && PARTNER_PHASES.has(phase)) {
      return { label: "Established", note: "An active partnership — trust has been earned through delivered work." };
    }
    if (meetings.length > 0) {
      return { label: "Building", note: "A real conversation has happened; trust is forming." };
    }
    if (bi) {
      return { label: "Early", note: "We understand the business, but no dialogue has opened yet." };
    }
    return { label: "Unknown", note: "Not enough signal yet — generate an intelligence profile to begin." };
  }
  const trust = trustLevel();

  // ── Client momentum (recency of last touch) ─────────────────────────────────
  function momentum(): { label: string; tone: string } {
    if (!lastTouchAt) return { label: "Quiet", tone: "text-chalk-400" };
    const days = Math.floor((Date.now() - +new Date(lastTouchAt)) / 86_400_000);
    if (days <= 14) return { label: "Active", tone: "text-emerald-300" };
    if (days <= 45) return { label: "Steady", tone: "text-azure-300" };
    return { label: "Quiet", tone: "text-chalk-400" };
  }
  const mo = momentum();

  // ── Completed improvements ──────────────────────────────────────────────────
  const acceptedProposals = proposals.filter((pr) => pr.status === "accepted");
  const completedPlans = plans.filter((pl) => pl.status === "completed");
  const hasCompleted = acceptedProposals.length > 0 || completedPlans.length > 0;

  // ── Current initiatives ─────────────────────────────────────────────────────
  const activePlans = plans.filter((pl) => pl.status === "active");

  // ── Expansion opportunities ─────────────────────────────────────────────────
  const expansion = p?.evolution.opportunities.filter((o) => o.horizon === "future") ?? [];

  // ── Next recommended conversation ───────────────────────────────────────────
  const nextConversation =
    p?.briefing.nextAction ??
    p?.briefing.bestOutreachAngle ??
    "Schedule a check-in to understand what's changed.";

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />

      {/* Relationship Memory — the persistent understanding of this business */}
      <RelationshipMemory items={memory} leadId={lead.id} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Main column: history-heavy ──────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* 1. Relationship stage */}
          <div className="card p-5">
            <SectionHeading icon={<Compass size={16} />}>Relationship stage</SectionHeading>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <JourneyBadge phase={phase} showMotion />
            </div>
            {phase && (
              <p className="mt-3 text-sm leading-relaxed text-chalk-300">
                {JOURNEY_META[phase]?.description}
              </p>
            )}
            <p className="mt-2 text-xs text-chalk-500">
              Underlying status · {lead.pipelineStage}
            </p>
          </div>

          {/* 4. Engagement history */}
          <div className="card p-5">
            <SectionHeading icon={<History size={16} />}>Engagement history</SectionHeading>
            {events.length > 0 ? (
              <ul className="mt-3 space-y-2.5">
                {events.map((e, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-20 shrink-0 text-xs text-chalk-500">{fmtDate(e.at)}</span>
                    <span className="text-chalk-300">
                      {e.title ?? e.label}
                      {e.detail ? <span className="text-chalk-500"> · {e.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">No engagement recorded yet.</p>
            )}
          </div>

          {/* 5. Completed improvements */}
          <div className="card p-5">
            <SectionHeading icon={<CheckCircle2 size={16} />}>Completed improvements</SectionHeading>
            {hasCompleted ? (
              <ul className="mt-3 space-y-2">
                {acceptedProposals.map((pr) => (
                  <li key={pr.id} className="flex gap-2 text-sm text-chalk-300">
                    <span className="mt-0.5 text-emerald-300">✓</span>
                    <span>
                      Proposal accepted{pr.amount != null ? ` · ${formatCurrency(pr.amount)}` : ""}
                      {pr.acceptedAt ? (
                        <span className="text-chalk-500"> · {fmtDate(pr.acceptedAt)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
                {completedPlans.map((pl) => (
                  <li key={pl.id} className="flex gap-2 text-sm text-chalk-300">
                    <span className="mt-0.5 text-emerald-300">✓</span>
                    <span>
                      {pl.strategy} completed
                      {pl.completedAt ? (
                        <span className="text-chalk-500"> · {fmtDate(pl.completedAt)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                None yet — completed work will appear here as the partnership grows.
              </p>
            )}
          </div>

          {/* 6. Current initiatives */}
          <div className="card p-5">
            <SectionHeading icon={<GitBranch size={16} />}>Current initiatives</SectionHeading>
            {activePlans.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {activePlans.map((pl) => (
                  <li key={pl.id}>
                    <p className="text-sm font-medium text-chalk-100">{pl.strategy}</p>
                    <p className="mt-0.5 text-sm text-chalk-400">{pl.objective}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                Nothing underway right now — the next conversation sets the direction.
              </p>
            )}
          </div>

          {/* 9. Evolution timeline */}
          <div className="card p-5">
            <SectionHeading icon={<Sprout size={16} />}>Evolution timeline</SectionHeading>
            <div className="mt-4">
              <EvolutionTimeline evolution={p?.evolution} />
            </div>
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* 2. Trust level */}
          <div className="card p-5">
            <SectionHeading icon={<ShieldCheck size={16} />}>Trust level</SectionHeading>
            <div className="mt-3">
              <Chip>{trust.label}</Chip>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-chalk-400">{trust.note}</p>
            {p?.evidenceConfidence != null && (
              <p className="mt-2 text-xs text-chalk-500">
                Evidence confidence · {p.evidenceConfidence}%
              </p>
            )}
          </div>

          {/* 3. Client momentum */}
          <div className="card p-5">
            <SectionHeading icon={<Activity size={16} />}>Client momentum</SectionHeading>
            <p className={`mt-3 text-sm font-medium ${mo.tone}`}>{mo.label}</p>
            <p className="mt-1 text-xs text-chalk-500">
              {lastTouchAt ? `Last touch · ${fmtDate(lastTouchAt)}` : "No touches recorded yet."}
            </p>
          </div>

          {/* 7. Expansion opportunities */}
          <div className="card p-5">
            <SectionHeading icon={<Rocket size={16} />}>Expansion opportunities</SectionHeading>
            {expansion.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {expansion.map((o) => (
                  <li key={o.id}>
                    <p className="text-sm font-medium text-chalk-100">{o.title}</p>
                    <p className="mt-0.5 text-sm text-chalk-400">{o.rationale}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                No strategic opportunities mapped yet.
              </p>
            )}
            {rv.partnershipLikelihood >= 0.5 && (
              <p className="mt-3 border-t border-white/[0.06] pt-3 text-sm text-teal-300">
                Signals suggest room to grow into an ongoing partnership.
              </p>
            )}
          </div>

          {/* 8. Next recommended conversation */}
          <div className="card border-azure-500/20 bg-azure-500/[0.04] p-5">
            <SectionHeading icon={<MessageCircle size={16} />}>
              Next recommended conversation
            </SectionHeading>
            <p className="mt-3 text-sm leading-relaxed text-chalk-100">{nextConversation}</p>
            <Link
              href={`/leads/${lead.id}/conversation`}
              className="mt-3 inline-block text-xs text-azure-300 hover:text-chalk-100"
            >
              Open the Conversation tab →
            </Link>
          </div>
        </div>
      </div>

      {/* 10. Relationship value — de-emphasized, money is context not headline */}
      <p className="text-xs text-chalk-600">
        Relationship value (internal projection) · entry {formatCurrency(rv.entry)} · 12-month projected{" "}
        {formatCurrency(rv.confidenceAdjustedTwelveMonth)}
      </p>
    </div>
  );
}

// Discovery Workspace — the pre-call preparation surface for a single lead.
// Goal: no consultant ever walks into a discovery call unprepared. Everything here
// is a calm, scannable read of the Business Intelligence profile plus a consultative
// checklist. Inferences are always framed as things to confirm live, never as facts.
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Compass,
  HelpCircle,
  Target,
  Gauge,
  Sprout,
  ShieldQuestion,
  GitBranch,
  ListChecks,
  CalendarClock,
  Sparkles,
  TrendingUp,
  Circle,
  Radio,
} from "lucide-react";
import {
  getLead,
  getBusinessIntelligence,
  meetingsForLead,
  findingsForLead,
  getSettings,
  contactsForLead,
} from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { MissionBriefCard } from "@/components/lead/MissionBriefCard";
import { buildMissionBrief } from "@/lib/outreach/mission-brief";
import { ConsultingReadCard } from "@/components/lead/ConsultingReadCard";
import { buildConsultingRead } from "@/lib/outreach/consulting-read";
import { updateMeetingNotesAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

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

export default async function DiscoveryWorkspacePage({
  params,
}: {
  params: { id: string };
}) {
  const id = params.id;
  const [lead, bi, meetings] = await Promise.all([
    getLead(id),
    getBusinessIntelligence(id),
    meetingsForLead(id),
  ]);

  if (!lead) notFound();

  const [, settings, contacts] = await Promise.all([findingsForLead(id), getSettings(), contactsForLead(id)]);

  // ── No intelligence yet ────────────────────────────────────────────────────
  if (!bi) {
    return (
      <div className="space-y-6">
        <LeadHeader lead={lead} />
        <div className="card p-5">
          <SectionHeading icon={<Compass size={16} />}>
            Prepare for discovery
          </SectionHeading>
          <p className="mt-3 text-sm text-chalk-400">
            Generate a Business Intelligence profile to prepare for discovery. Once
            the profile exists, this workspace assembles the business summary,
            hypotheses to validate, and the questions worth asking — so you never
            walk into a call unprepared.
          </p>
          <Link
            href={`/leads/${id}`}
            className="btn-secondary mt-4 inline-flex items-center gap-1.5"
          >
            <Sparkles size={14} /> Go to the lead overview
          </Link>
        </div>
      </div>
    );
  }

  const p = bi.profile;
  const meeting = meetings[0];
  const missionBrief = buildMissionBrief({ lead, profile: p.businessProfile, settings, contacts, meetingAt: meeting?.scheduledAt ?? null });
  const consultingRead = buildConsultingRead(lead, p.businessProfile);

  const topOpportunities =
    p.briefing.strongestOpportunities.length > 0
      ? p.briefing.strongestOpportunities
      : p.evolution.opportunities.map((o) => o.title);

  const discoveryQuestions =
    p.briefing.bestDiscoveryQuestions.length > 0
      ? p.briefing.bestDiscoveryQuestions
      : p.snapshot.discoveryQuestions;

  const immediateOpportunities = p.evolution.opportunities.filter(
    (o) => o.horizon === "immediate",
  );

  // ── Growth signals read (calm, derived from public facts) ──────────────────
  const growthSentences: string[] = [];
  if (lead.reviewCount != null) {
    growthSentences.push(
      `${lead.reviewCount.toLocaleString()} public reviews${
        lead.rating != null ? ` at a ${lead.rating} average` : ""
      } give a sense of how actively the market engages with them.`,
    );
  }
  if (lead.locationsCount != null && lead.locationsCount > 1) {
    growthSentences.push(
      `Operating across ${lead.locationsCount} locations suggests they have already navigated the coordination that comes with growth.`,
    );
  } else if (lead.locationsCount === 1) {
    growthSentences.push(
      `A single location keeps operations focused — worth confirming whether expansion is on their horizon.`,
    );
  }
  if (growthSentences.length === 0) {
    growthSentences.push(
      `Public growth signals are limited, so treat the meter as a starting point and confirm momentum in conversation.`,
    );
  }

  const staticChecklist = [
    "Reviewed the business's public presence",
    "Understood their strongest current strengths",
    "Prepared 3 questions that confirm the hypotheses above",
    "Framed the conversation around their goals, not our services",
    "Ready to listen more than pitch",
  ];

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />

      {/* The consulting read — judgment for the room, then the detailed brief */}
      <ConsultingReadCard read={consultingRead} />
      <MissionBriefCard brief={missionBrief} businessName={lead.businessName} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* 2. Business summary */}
          <div className="card p-5">
            <SectionHeading icon={<Compass size={16} />}>
              Business summary
            </SectionHeading>
            <p className="mt-3 text-sm leading-relaxed text-chalk-300">
              {p.briefing.whyItMatters}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip>Maturity · {p.maturity.overall}</Chip>
              <Chip>Improvement · {p.improvement.score}/100</Chip>
              <Chip>Evidence · {p.evidenceConfidence}%</Chip>
              <Chip>Growth · {p.improvement.dimensions.growthSignals}/100</Chip>
            </div>
          </div>

          {/* 3. Top opportunities */}
          <div className="card p-5">
            <SectionHeading icon={<Target size={16} />}>
              Top opportunities
            </SectionHeading>
            {topOpportunities.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {topOpportunities.map((opp, i) => (
                  <li key={i} className="flex gap-2 text-sm text-chalk-300">
                    <span className="mt-0.5 text-teal-300">→</span>
                    <span>{opp}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                No clear opportunities surfaced yet — use the call to explore.
              </p>
            )}
          </div>

          {/* 4. Technology maturity */}
          <div className="card p-5">
            <SectionHeading icon={<Gauge size={16} />}>
              Technology maturity
            </SectionHeading>
            <p className="mt-3 text-sm leading-relaxed text-chalk-300">
              {p.maturity.summary}
            </p>
            {p.maturity.priorityDimensions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {p.maturity.priorityDimensions.map((d, i) => (
                  <Chip key={i}>{d}</Chip>
                ))}
              </div>
            )}
            {p.maturity.dimensions.length > 0 && (
              <details className="mt-4 border-t border-white/[0.06] pt-3">
                <summary className="cursor-pointer text-xs text-chalk-400 hover:text-chalk-100">
                  Where each capability sits today
                </summary>
                <ul className="mt-3 space-y-2">
                  {p.maturity.dimensions.map((d, i) => (
                    <li key={i} className="text-sm text-chalk-300">
                      <span className="text-chalk-100">{d.dimension}</span>
                      <span className="text-chalk-500"> · now: {d.current}</span>
                      <span className="text-azure-300"> → {d.nextStep}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* 5. Growth signals */}
          <div className="card p-5">
            <SectionHeading icon={<TrendingUp size={16} />}>
              Growth signals
            </SectionHeading>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-emerald-300/60"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, p.improvement.dimensions.growthSignals),
                    )}%`,
                  }}
                />
              </div>
              <span className="text-xs text-emerald-300">
                {p.improvement.dimensions.growthSignals}/100
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {growthSentences.map((s, i) => (
                <p key={i} className="text-sm leading-relaxed text-chalk-300">
                  {s}
                </p>
              ))}
            </div>
          </div>

          {/* 8. Potential root constraints */}
          <div className="card p-5">
            <SectionHeading icon={<GitBranch size={16} />}>
              Potential root constraints
            </SectionHeading>
            {p.opportunityGraph.rootCauses.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {p.opportunityGraph.rootCauses.map((rc, i) => (
                  <li key={i} className="flex gap-2 text-sm text-chalk-300">
                    <span className="mt-0.5 text-amber-300">•</span>
                    <span>{rc}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                No root constraints identified — a good sign, worth confirming.
              </p>
            )}
            {p.opportunityGraph.highLeverage && (
              <p className="mt-3 border-t border-white/[0.06] pt-3 text-sm text-chalk-400">
                <span className="text-teal-300">Highest leverage:</span>{" "}
                {p.opportunityGraph.highLeverage.domain} —{" "}
                {p.opportunityGraph.highLeverage.rationale}
              </p>
            )}
          </div>

          {/* 9. Business evolution preview */}
          <div className="card p-5">
            <SectionHeading icon={<Sprout size={16} />}>
              Business evolution preview
            </SectionHeading>
            <p className="mt-3 text-sm leading-relaxed text-chalk-300">
              {p.evolution.narrative}
            </p>
            {immediateOpportunities.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-3">
                <p className="label">Where to start</p>
                {immediateOpportunities.map((o) => (
                  <div key={o.id}>
                    <p className="text-sm font-medium text-chalk-100">
                      {o.title}
                    </p>
                    <p className="mt-0.5 text-sm text-chalk-400">
                      {o.rationale}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 10. Operator notes */}
          <div className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <SectionHeading icon={<CalendarClock size={16} />}>
                Operator notes
              </SectionHeading>
              <Link href={`/leads/${id}/meeting`} className="inline-flex items-center gap-1 text-xs text-teal-300 hover:text-chalk-100">
                <Radio size={13} /> Start the live meeting →
              </Link>
            </div>
            {meeting ? (
              <form
                action={updateMeetingNotesAction.bind(null, meeting.id, lead.id)}
                className="mt-3 space-y-3"
              >
                <div>
                  <label className="label mb-1 block" htmlFor="notes">
                    Call notes
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={4}
                    defaultValue={meeting.notes}
                    placeholder="What you heard, in their words…"
                    className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-chalk-100 placeholder:text-chalk-600 focus:border-white/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="label mb-1 block" htmlFor="nextStep">
                    Next step
                  </label>
                  <input
                    id="nextStep"
                    name="nextStep"
                    defaultValue={meeting.nextStep}
                    placeholder="The single agreed-upon next step"
                    className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-chalk-100 placeholder:text-chalk-600 focus:border-white/20 focus:outline-none"
                  />
                </div>
                <button type="submit" className="btn-secondary">
                  Save notes
                </button>
              </form>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                Book a discovery call to capture notes here.{" "}
                <Link
                  href={`/leads/${id}/conversation`}
                  className="text-azure-300 hover:text-chalk-100"
                >
                  Open the Conversation tab →
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* ── Sidebar: questions, validation, checklist ───────────────────── */}
        <div className="space-y-6">
          {/* 6. Discovery questions */}
          <div className="card p-5">
            <SectionHeading icon={<HelpCircle size={16} />}>
              Discovery questions
            </SectionHeading>
            {discoveryQuestions.length > 0 ? (
              <ol className="mt-3 space-y-2.5">
                {discoveryQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-chalk-300">
                    <span className="mt-0.5 shrink-0 text-xs text-chalk-500">
                      {i + 1}.
                    </span>
                    <span>{q}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                No prepared questions yet — lead with curiosity.
              </p>
            )}
          </div>

          {/* 7. Evidence requiring validation */}
          <div className="card p-5">
            <SectionHeading icon={<ShieldQuestion size={16} />}>
              Evidence requiring validation
            </SectionHeading>
            {p.snapshot.hypothesesToValidate.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {p.snapshot.hypothesesToValidate.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm text-chalk-300">
                    <Circle size={12} className="mt-1 shrink-0 text-chalk-600" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-chalk-500">
                Nothing flagged for validation — still worth confirming assumptions.
              </p>
            )}
            <p className="mt-3 text-xs text-chalk-500">
              Confirm or correct these live — they are inferences from public
              evidence, not facts.
            </p>
          </div>

          {/* 11. Meeting checklist (static, consultative) */}
          <div className="card p-5">
            <SectionHeading icon={<ListChecks size={16} />}>
              Pre-call checklist
            </SectionHeading>
            <ul className="mt-3 space-y-2">
              {staticChecklist.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-chalk-400">
                  <Circle size={12} className="mt-1 shrink-0 text-chalk-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

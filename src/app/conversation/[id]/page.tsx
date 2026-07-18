// Phase 1 — True Conversation Mode. Rendered OUTSIDE the app shell (its own route,
// no sidebar / nav / pipeline / commercial widgets) so nothing competes for the
// operator's attention during a live client conversation. Auth is still enforced by
// the global middleware. Full-screen, calm, focus-only.
import { notFound } from "next/navigation";
import { getLead, getBusinessIntelligence, meetingsForLead, findingsForLead } from "@/lib/repo";
import { ConversationMode } from "@/components/lead/ConversationMode";

export const dynamic = "force-dynamic";

export default async function ConversationRoute({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [bi, meetings, findings] = await Promise.all([
    getBusinessIntelligence(lead.id),
    meetingsForLead(lead.id),
    findingsForLead(lead.id),
  ]);
  const p = bi?.profile;

  const meeting =
    meetings.find((m) => m.outcome === "pending") ??
    [...meetings].sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt))[0] ??
    null;

  const questions = meeting?.discoveryQuestions?.length ? meeting.discoveryQuestions : p?.briefing.bestDiscoveryQuestions ?? p?.snapshot.discoveryQuestions ?? [];
  const strengths = p?.snapshot.observedStrengths?.length ? p.snapshot.observedStrengths : lead.strengths;
  const opportunities = p?.briefing.strongestOpportunities?.length ? p.briefing.strongestOpportunities : (p?.evolution?.opportunities ?? []).map((o) => o.title);
  const observations = findings.filter((f) => f.approved).map((f) => f.observation);
  const summaryLine = p?.briefing.whyItMatters ?? lead.opportunitySummary ?? null;
  const maturity = p ? `${p.maturity.overall} · improvement ${p.improvement.score}/100 · evidence ${p.evidenceConfidence}%` : null;
  const friction = p?.snapshot.visibleFriction?.map((f) => f.observation) ?? [];
  const hypotheses = p?.snapshot.hypothesesToValidate ?? [];

  return (
    <main className="min-h-screen bg-ink-950 px-4 py-6 md:px-8 md:py-10">
      <ConversationMode
        leadId={lead.id}
        leadName={lead.businessName}
        meetingId={meeting?.id ?? null}
        summary={summaryLine}
        maturity={maturity}
        questions={questions}
        observations={observations}
        strengths={strengths}
        friction={friction}
        hypotheses={hypotheses}
        opportunities={opportunities}
        initialNotes={meeting?.notes ?? ""}
      />
    </main>
  );
}

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getLead,
  contactsForLead,
  findingsForLead,
  screenshotsForLead,
  deliverablesForLead,
  videosForLead,
  outreachForLead,
  meetingsForLead,
  proposalsForLead,
  agreementsForLead,
  paymentsForLead,
  getSettings,
  daysInStage,
  previewsForLead,
  versionsOf,
  sharesForPreview,
  plansForLead,
  inboundForLead,
  getBusinessIntelligence,
  emailSendsForLead,
} from "@/lib/repo";
import { collectTimeline } from "@/lib/acquisition/timeline";
import { ConceptPreviewPanel } from "@/components/lead/ConceptPreviewPanel";
import { AcquisitionPanel } from "@/components/lead/AcquisitionPanel";
import { AcquisitionTimeline } from "@/components/lead/AcquisitionTimeline";
import { OwnershipPanel } from "@/components/lead/OwnershipPanel";
import { buildLeadTimeline } from "@/lib/operators/timeline";
import { listOperators, tasksForLead, auditForTarget } from "@/lib/repo";
import { TierBadge, ScorePill, SourceTag, ConfidenceBadge } from "@/components/ui";
import { LeadActions } from "@/components/lead/LeadActions";
import { ScorePanel } from "@/components/lead/ScorePanel";
import { FindingsEditor } from "@/components/lead/FindingsEditor";
import { DeliverablePanel } from "@/components/lead/DeliverablePanel";
import { VideoPanel } from "@/components/lead/VideoPanel";
import { OutreachPanel } from "@/components/lead/OutreachPanel";
import { MeetingProposalPanel } from "@/components/lead/MeetingProposalPanel";
import { AgreementPanel } from "@/components/lead/AgreementPanel";
import { agreementSendingEnabled } from "@/lib/esign/gate";
import { getEsignProvider } from "@/lib/esign/provider";
import { stripeConfigured } from "@/lib/payments/stripe";
import { IntelligencePanel } from "@/components/lead/IntelligencePanel";
import { BusinessUnderstanding } from "@/components/lead/BusinessUnderstanding";
import { EvolutionTimeline } from "@/components/lead/EvolutionTimeline";
import { LeadSubNav } from "@/components/lead/LeadSubNav";
import { JourneyBadge } from "@/components/JourneyBadge";
import { journeyPhaseOf } from "@/lib/journey";
import { buildOutreachKit } from "@/lib/outreach/kit";
import { deriveOutreachState } from "@/lib/outreach/state";
import type { OutreachKit } from "@/lib/outreach/types";
import { NextBestActionCard } from "@/components/lead/NextBestActionCard";
import { OutreachKitPanel } from "@/components/lead/OutreachKitPanel";
import { determineContactStrategy, buildCallBrief, buildCallScript, findInstagram } from "@/lib/outreach/contact-strategy";
import { ContactStrategyPanel } from "@/components/lead/ContactStrategyPanel";
import { CallWorkspace } from "@/components/lead/CallWorkspace";
import { WebsiteLink } from "@/components/WebsiteLink";
import { PhoneCopyButton } from "@/components/PhoneCopyButton";
import { ContactRouteMissingWorkspace } from "@/components/lead/ContactRouteMissingWorkspace";
import { deriveCallLeadState } from "@/lib/outreach/call-state";
import { formatRange, joinMeta, formatLocation, deslug } from "@/lib/utils";
import { ArrowLeft, Globe, Phone, Mail, MapPin, Star, ExternalLink, Compass, ChevronDown } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params, searchParams }: { params: { id: string }; searchParams: { ids?: string; kind?: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  // Batch/queue context (optional) — carried in the URL when the operator arrived via
  // a batch so the outcome card can continue the loop. Absent for direct/Businesses entry.
  const batchIds = (searchParams.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const continuation = { ids: batchIds.length ? batchIds : undefined, kind: searchParams.kind || undefined };

  const [contacts, findings, screenshots, deliverables, videos, outreach, meetings, proposals, settings, agreements, payments] = await Promise.all([
    contactsForLead(lead.id),
    findingsForLead(lead.id),
    screenshotsForLead(lead.id),
    deliverablesForLead(lead.id),
    videosForLead(lead.id),
    outreachForLead(lead.id),
    meetingsForLead(lead.id),
    proposalsForLead(lead.id),
    getSettings(),
    agreementsForLead(lead.id),
    paymentsForLead(lead.id),
  ]);

  const previews = (await previewsForLead(lead.id)).filter((p) => p.status !== "Archived");
  const activePreview = previews.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  const previewVersions = activePreview ? await versionsOf(activePreview.id) : [];
  const previewVersion = activePreview?.currentVersionId ? previewVersions.find((v) => v.id === activePreview.currentVersionId) ?? null : null;
  const previewShares = activePreview ? await sharesForPreview(activePreview.id) : [];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://outreach.artifexlabs.tech";
  const acquisitionPlans = await plansForLead(lead.id);
  const inbound = await inboundForLead(lead.id);
  const businessIntelligence = await getBusinessIntelligence(lead.id);
  const timeline = collectTimeline({ lead, findings, deliverables, videos, shares: previewShares, meetings, proposals, plans: acquisitionPlans, outreach, inbound });

  // Ownership + the complete operational history. Read from records that already
  // exist, so a reassignment never truncates the story.
  const [operators, leadAudit, leadTasks, leadSends] = await Promise.all([
    listOperators(), auditForTarget("lead", lead.id), tasksForLead(lead.id), emailSendsForLead(lead.id),
  ]);
  const owner = operators.find((o) => o.id === lead.assignedTo) ?? null;
  const teamTimeline = buildLeadTimeline({ audit: leadAudit, tasks: leadTasks, emailSends: leadSends, inbound, meetings, operators });

  // Outreach Experience v2 — the momentum kit. Defensive: never break the page.
  let outreachKit: OutreachKit | null = null;
  try {
    const intel = businessIntelligence?.profile ?? null;
    const profile = intel?.businessProfile ?? null;
    const improvement = intel?.improvement ?? null;
    if (profile) {
      const draft = buildOutreachKit({ lead, profile, settings, contacts, improvement });
      const emailSends = await emailSendsForLead(lead.id);
      const state = deriveOutreachState({
        now: new Date().toISOString(),
        lead,
        deliverables,
        videos,
        emailSends,
        meetings,
        inbound,
        videoRecommended: draft.videoRecommended,
        confidenceHigh: draft.confidence.overall >= 70,
      });
      outreachKit = buildOutreachKit({ lead, profile, settings, contacts, improvement, outreachState: state });
    }
  } catch {
    outreachKit = null;
  }

  // ── Decision context — the four questions this Work Surface must answer at a glance:
  // who is this · why are we contacting them · what stood out · what do I do next.
  const briefing = businessIntelligence?.profile?.briefing ?? null;
  const why = lead.recommendationReason?.trim() || briefing?.whyItMatters || lead.opportunitySummary || "Worth a thoughtful touch.";
  const stoodOut = (briefing?.strongestOpportunities ?? []).slice(0, 3);
  const approvedFindings = findings.filter((f) => f.approved).length;

  // Contact strategy — the best first touch. Only surfaced when it isn't plain
  // email-first, so the common case stays uncluttered.
  const dmEmail = outreachKit?.decisionMaker.primary?.directEmail ?? outreachKit?.decisionMaker.primary?.officeEmail ?? null;
  const contactStrategy = determineContactStrategy(lead, { decisionMakerEmail: dmEmail });
  const wantsBrief = contactStrategy.kind === "call-first" || contactStrategy.kind === "instagram-dm-first";
  const contactBrief = wantsBrief ? buildCallBrief(lead, { strongestObservation: stoodOut[0] ?? null }) : null;

  // The Call First workspace is chosen by PERMISSION, not by whether some email
  // address exists. An address inferred from a collected contact is channel
  // availability, not permission to send — so it must not flip the lead into the
  // send flow. Only a permitted send route (lead.publicEmail — set by a pre-existing
  // public inbox or by an explicit asked-to-send outcome) leaves the call workflow.
  const callStrategy = determineContactStrategy(lead);
  const isCallFirst = !lead.publicEmail && callStrategy.kind === "call-first";
  // A lead with no verified, actionable channel is not ready for ANY outreach — the
  // only performable action is finding a contact route. This is checked before the
  // call workspace so we never render a call for a business we have no number for.
  const isNoChannel = callStrategy.kind === "no-channel";

  // Work expands, reference collapses: the section the *current* next action needs is
  // open; everything else waits behind a summary. This is what keeps the page a Work
  // Surface instead of a document — the operator never hunts for the next action.
  // A call-first lead is different: the call IS the whole surface, so nothing in the
  // reference stack auto-opens (it all lives under "More about this lead", collapsed).
  const hotKind = outreachKit?.nextAction.kind;
  const hot = isCallFirst || isNoChannel
    ? null
    : hotKind === "prepare-review" ? "deliverable"
    : hotKind === "record-video" ? "video"
    : hotKind === "call" || hotKind === "schedule-discovery" ? "outreach-kit"
    : null;

  // The full lifecycle — Business Technology Review, video, outreach kit, intelligence,
  // pipeline, contacts, management. It's the same set of sections in every layout; for
  // a call-first lead it's folded behind one "More about this lead" disclosure so it
  // never competes with the call.
  const referenceSections = (
    <>
      {/* Business Technology Review — hero target for "prepare-review" */}
      <Disclosure id="deliverable" title="Business Technology Review" hint={deliverables.length ? `${deliverables.length} version${deliverables.length > 1 ? "s" : ""}` : "not generated"} defaultOpen={hot === "deliverable"}>
        <DeliverablePanel lead={lead} deliverables={deliverables} findingsCount={approvedFindings} />
      </Disclosure>

      {/* Personal video — hero target for "record-video" */}
      <Disclosure id="video" title="Personal video" hint={videos.length ? `${videos.length} recorded` : "none yet"} defaultOpen={hot === "video"}>
        <VideoPanel lead={lead} videos={videos} screenshots={screenshots} />
      </Disclosure>

      {/* Outreach kit & history — hero target for "call" / "schedule-discovery" */}
      <Disclosure id="outreach-kit" title="Outreach kit & history" hint="email · follow-up · phone · discovery" defaultOpen={hot === "outreach-kit"}>
        {outreachKit && <OutreachKitPanel kit={outreachKit} />}
        <OutreachPanel lead={lead} outreach={outreach} contacts={contacts} settings={settings} hasVideo={videos.some((v) => v.videoUrl)} hasBrief={deliverables.some((d) => d.status !== "draft")} />
      </Disclosure>

      {/* Understand the business */}
      <Disclosure id="understand" title="Understand the business" hint="intelligence · opportunity · findings">
        <BusinessUnderstanding lead={lead} bi={businessIntelligence ?? null} />
        <IntelligencePanel bi={businessIntelligence ?? null} leadId={lead.id} />
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-chalk-100">Opportunity assessment</h2>
          {lead.opportunitySummary ? (
            <p className="text-sm leading-relaxed text-chalk-300">{lead.opportunitySummary}</p>
          ) : (
            <p className="text-sm text-chalk-500">Run website analysis to generate an assessment.</p>
          )}
          {lead.recommendedService && (
            <div className="mt-4 rounded-xl border border-azure-500/20 bg-azure-500/[0.04] p-3">
              <p className="label mb-1">Likely engagement direction</p>
              <p className="text-sm font-medium text-chalk-100">{lead.recommendedService}</p>
              <p className="mt-1 text-xs text-chalk-400">
                Investment range (internal only): {formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}
              </p>
              {lead.recommendationReason && <p className="mt-2 text-sm text-chalk-300">{lead.recommendationReason}</p>}
            </div>
          )}
        </div>
        <div id="findings" className="card p-5">
          <FindingsEditor leadId={lead.id} findings={findings} screenshots={screenshots} />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-chalk-100">Evolution timeline</h2>
          <EvolutionTimeline evolution={businessIntelligence?.profile.evolution ?? null} />
        </div>
      </Disclosure>

      {/* Pipeline & delivery */}
      <Disclosure id="pipeline" title="Pipeline & delivery" hint="strategy · concept · meeting · agreement">
        <OwnershipPanel
          owner={owner}
          operators={operators}
          leadId={lead.id}
          assignedAt={lead.assignedAt}
          assignmentReason={lead.assignmentReason}
          lastOperatorActivityAt={lead.lastOperatorActivityAt}
          events={teamTimeline}
        />
        <AcquisitionPanel lead={lead} plans={acquisitionPlans} />
        <AcquisitionTimeline events={timeline} />
        <ConceptPreviewPanel leadId={lead.id} tier={lead.tier} preview={activePreview} version={previewVersion} shares={previewShares} findings={findings} appUrl={appUrl} />
        <div id="meeting">
          <MeetingProposalPanel lead={lead} meetings={meetings} proposals={proposals} />
        </div>
        <div id="agreement">
          <AgreementPanel
            lead={lead}
            proposals={proposals}
            agreements={agreements}
            payments={payments}
            sendingEnabled={agreementSendingEnabled()}
            esignConfigured={getEsignProvider().canSend}
            stripeConfigured={stripeConfigured()}
          />
        </div>
      </Disclosure>

      {/* Contacts, score & reference */}
      <Disclosure id="reference" title="Contacts, score & reference" hint={contacts.length ? `${contacts.length} contact${contacts.length > 1 ? "s" : ""}` : "no contacts yet"}>
        <div className="card p-5">
          <p className="label mb-2">Decision-makers</p>
          {contacts.length === 0 ? (
            <p className="text-xs text-chalk-500">None identified yet. Never invent a person or title.</p>
          ) : (
            <div className="space-y-2">
              {contacts.map((c) => (
                <div key={c.id} className="rounded-lg border border-white/[0.06] p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-chalk-100">{c.name}</p>
                    <ConfidenceBadge confidence={c.confidence} />
                  </div>
                  <p className="text-xs text-chalk-500">{c.title}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <SourceTag source={c.source} />
                    {c.optedOut && <span className="text-[10px] text-red-300">Opted out</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <dl className="mt-4 space-y-2 border-t border-white/[0.06] pt-3 text-sm">
            <Row label="Google Place ID" value={lead.googlePlaceId ?? "—"} mono />
            <Row label="Source" value={lead.source} />
            <Row label="Locations" value={lead.locationsCount?.toString() ?? "Unknown"} />
            <Row label="Contact form" value={lead.contactFormUrl ? "Found" : "Not found"} />
            <Row label="Status" value={lead.businessStatus ?? "—"} />
          </dl>
        </div>
        <ScorePanel lead={lead} />
      </Disclosure>

      {/* Manage & go deeper — workflow chrome and other surfaces, entered intentionally. */}
      <Disclosure id="manage" title="Manage & go deeper" hint="stage · disqualify · other views">
        <LeadActions lead={lead} hasFindings={findings.length > 0} />
        <div className="flex flex-wrap gap-2">
          <Link href={`/leads/${lead.id}/discovery`} className="btn-secondary text-xs"><Compass size={13} /> Prepare discovery</Link>
          <Link href={`/conversation/${lead.id}`} className="btn-secondary text-xs">Conversation mode</Link>
          <Link href={`/leads/${lead.id}/relationship`} className="btn-secondary text-xs">Relationship view</Link>
        </div>
        <LeadSubNav id={lead.id} />
      </Disclosure>
    </>
  );

  // ── Call First workspace ──────────────────────────────────────────────────────
  // A dedicated, calm operator console: identity, the call, the script, the outcome.
  // No NextBestActionCard (the call is the one action), no email material up front
  // (there's no verified email yet). The whole lifecycle waits, collapsed, below.
  // ── Contact Route Missing workspace ───────────────────────────────────────────
  // No verified channel exists. One action only: find a real way to contact them.
  // No call button, no script, no call outcomes, no email — none of those are
  // performable. The lifecycle waits, collapsed, below.
  if (isNoChannel) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100">
          <ArrowLeft size={15} /> Back to Today
        </Link>

        <ContactRouteMissingWorkspace lead={lead} reason={callStrategy.reason} continuation={continuation} />

        <details className="group scroll-mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 hover:border-white/[0.12]">
            <ChevronDown size={16} className="shrink-0 text-chalk-500 transition-transform group-open:rotate-180" />
            <span className="text-sm font-semibold text-chalk-100">More about this business</span>
            <span className="ml-auto truncate text-xs text-chalk-500">research · findings · scores · pipeline</span>
          </summary>
          <div className="mt-4 space-y-5">{referenceSections}</div>
        </details>
      </div>
    );
  }

  if (isCallFirst) {
    const script = buildCallScript(lead, { strongestObservation: stoodOut[0] ?? null });
    const callState = deriveCallLeadState(lead);
    const history = (lead.note ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    // An email already collected on a call (lives on a conversation contact) while the
    // lead still has no send route — enables the one-tap outcome correction.
    const collectedEmail = contacts
      .filter((c) => c.source === "conversation" && c.verified && !!c.email)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.email ?? null;
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100">
          <ArrowLeft size={15} /> Back to Today
        </Link>

        {/* The one workspace responsible for the current action. */}
        <CallWorkspace lead={lead} script={script} reason={callStrategy.reason} state={callState} continuation={continuation} collectedEmail={collectedEmail} />

        {/* More about this business — the full lifecycle & intelligence, collapsed. */}
        <details className="group scroll-mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 hover:border-white/[0.12]">
            <ChevronDown size={16} className="shrink-0 text-chalk-500 transition-transform group-open:rotate-180" />
            <span className="text-sm font-semibold text-chalk-100">More about this business</span>
            <span className="ml-auto truncate text-xs text-chalk-500">review · findings · video · pipeline · contacts</span>
          </summary>
          <div className="mt-4 space-y-5">{referenceSections}</div>
        </details>

        {/* Lead history — the running call log, collapsed. */}
        {history.length > 0 && (
          <details className="group scroll-mt-4">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 hover:border-white/[0.12]">
              <ChevronDown size={16} className="shrink-0 text-chalk-500 transition-transform group-open:rotate-180" />
              <span className="text-sm font-semibold text-chalk-100">Lead history</span>
              <span className="ml-auto truncate text-xs text-chalk-500">{history.length} entr{history.length > 1 ? "ies" : "y"}</span>
            </summary>
            <div className="mt-4 card p-5">
              <ul className="space-y-2">
                {history.map((line, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-chalk-300">{line}</li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100">
        <ArrowLeft size={15} /> Back to Today
      </Link>

      {/* The one decision — always the loudest thing on the page. */}
      {outreachKit && <NextBestActionCard action={outreachKit.nextAction} leadId={lead.id} />}

      {/* At a glance — who · why · what stood out. Everything needed to trust the action
          above, and nothing that competes with it. */}
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-chalk-50">{lead.businessName}</h1>
              <TierBadge tier={lead.tier} />
              <JourneyBadge phase={journeyPhaseOf(lead)} showMotion />
            </div>
            <p className="mt-1 text-sm text-chalk-400">
              {joinMeta(deslug(lead.industry), formatLocation(lead.city, lead.state))}
            </p>
          </div>
          <div className="shrink-0 sm:text-right">
            <ScorePill score={lead.leadScore} />
            <p className="mt-1 text-xs text-chalk-500">{daysInStage(lead)}d in stage</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-chalk-400">
          {lead.website && <WebsiteLink url={lead.website} domain={lead.websiteDomain} businessName={lead.businessName} />}
          {lead.phone && (
            <span className="inline-flex items-center gap-0.5">
              <Phone size={14} aria-hidden /> {lead.phone}
              <PhoneCopyButton phone={lead.phone} businessName={lead.businessName} className="ml-0.5" />
            </span>
          )}
          {lead.publicEmail && <span className="inline-flex items-center gap-1"><Mail size={14} /> {lead.publicEmail}</span>}
          {lead.rating != null && <span className="inline-flex items-center gap-1"><Star size={14} className="text-amber-400" /> {lead.rating} ({lead.reviewCount})</span>}
          <span className="inline-flex items-center gap-1"><MapPin size={14} /> {lead.address}</span>
        </div>

        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Why we're reaching out</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-300">{why}</p>
        </div>

        {stoodOut.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What stood out</p>
            <ul className="mt-1 space-y-1">
              {stoodOut.map((o, i) => <li key={i} className="flex gap-2 text-[13px] text-chalk-300"><span className="mt-0.5 text-amber-300">→</span><span>{o}</span></li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Primary contact strategy — only when this business shouldn't begin with email. */}
      {contactStrategy.kind !== "email-first" && (
        <ContactStrategyPanel leadId={lead.id} strategy={contactStrategy} brief={contactBrief} phone={lead.phone} contactFormUrl={lead.contactFormUrl} instagramUrl={findInstagram(lead.socialLinks)} continuation={continuation} />
      )}

      {/* ── Everything else, on demand. Reference never competes with the decision. ─────
          The section the current action needs opens itself; the rest stay collapsed. */}
      {referenceSections}
    </div>
  );
}

// A reference section — collapsed by default so it never competes with the decision.
// `defaultOpen` lets the current next action reveal exactly the panel it needs.
function Disclosure({ id, title, hint, defaultOpen, children }: { id: string; title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details id={id} open={defaultOpen} className="group scroll-mt-4">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 hover:border-white/[0.12]">
        <ChevronDown size={16} className="shrink-0 text-chalk-500 transition-transform group-open:rotate-180" />
        <span className="text-sm font-semibold text-chalk-100">{title}</span>
        {hint && <span className="ml-auto truncate text-xs text-chalk-500">{hint}</span>}
      </summary>
      <div className="mt-4 space-y-6">{children}</div>
    </details>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-chalk-500">{label}</dt>
      <dd className={`text-right text-xs ${mono ? "font-mono" : ""} text-chalk-300`}>{value}</dd>
    </div>
  );
}

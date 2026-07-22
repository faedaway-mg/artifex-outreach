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
import { formatRange, joinMeta, formatLocation, deslug } from "@/lib/utils";
import { ArrowLeft, Globe, Phone, Mail, MapPin, Star, ExternalLink, Compass } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

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

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100">
        <ArrowLeft size={15} /> Back to Today
      </Link>

      {/* Next best action — the one thing to do now */}
      {outreachKit && <NextBestActionCard action={outreachKit.nextAction} leadId={lead.id} />}

      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-chalk-50">{lead.businessName}</h1>
              <TierBadge tier={lead.tier} />
              <JourneyBadge phase={journeyPhaseOf(lead)} showMotion />
            </div>
            <p className="mt-1 text-sm text-chalk-400">
              {joinMeta(deslug(lead.industry), formatLocation(lead.city, lead.state))}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-chalk-400">
              {lead.website && (
                <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-azure-300">
                  <Globe size={14} /> {lead.websiteDomain} <ExternalLink size={11} />
                </a>
              )}
              {lead.phone && <span className="inline-flex items-center gap-1"><Phone size={14} /> {lead.phone}</span>}
              {lead.publicEmail && <span className="inline-flex items-center gap-1"><Mail size={14} /> {lead.publicEmail}</span>}
              {lead.rating != null && <span className="inline-flex items-center gap-1"><Star size={14} className="text-amber-400" /> {lead.rating} ({lead.reviewCount})</span>}
              <span className="inline-flex items-center gap-1"><MapPin size={14} /> {lead.address}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <ScorePill score={lead.leadScore} />
            <p className="mt-1 text-xs text-chalk-500">{daysInStage(lead)}d in stage</p>
          </div>
        </div>
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <LeadActions lead={lead} hasFindings={findings.length > 0} />
        </div>
      </div>

      <LeadSubNav id={lead.id} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-1">
          {/* Snapshot / contacts */}
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-chalk-100">Contacts &amp; facts</h2>
            <div>
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
            </div>
            <details className="mt-4 border-t border-white/[0.06] pt-3">
              <summary className="cursor-pointer text-xs text-chalk-500">Reference details</summary>
              <dl className="mt-2 space-y-2 text-sm">
                <Row label="Google Place ID" value={lead.googlePlaceId ?? "—"} mono />
                <Row label="Source" value={lead.source} />
                <Row label="Locations" value={lead.locationsCount?.toString() ?? "Unknown"} />
                <Row label="Contact form" value={lead.contactFormUrl ? "Found" : "Not found"} />
                <Row label="Status" value={lead.businessStatus ?? "—"} />
              </dl>
            </details>
          </div>

          {/* Score breakdown */}
          <ScorePanel lead={lead} />
        </div>

        {/* Main column — understanding first, engagement second */}
        <div className="space-y-6 lg:col-span-2">
          {/* Understand the business before anything else */}
          <BusinessUnderstanding lead={lead} bi={businessIntelligence ?? null} />

          {/* Prepare-to-consult quick actions */}
          <div className="flex flex-wrap gap-2">
            <Link href={`/leads/${lead.id}/discovery`} className="btn-secondary text-xs"><Compass size={13} /> Prepare discovery</Link>
            <Link href={`/conversation/${lead.id}`} className="btn-secondary text-xs">Conversation mode</Link>
            <Link href={`/leads/${lead.id}/relationship`} className="btn-secondary text-xs">Relationship view</Link>
          </div>

          {/* Business Intelligence — the deeper briefing */}
          <IntelligencePanel bi={businessIntelligence ?? null} leadId={lead.id} />

          {/* Evolution timeline — the long-term arc */}
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-chalk-100">Evolution timeline</h2>
            <EvolutionTimeline evolution={businessIntelligence?.profile.evolution ?? null} />
          </div>

          {/* AI opportunity summary */}
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

          {/* Key opportunities / findings */}
          <div id="findings" className="card p-5">
            <FindingsEditor leadId={lead.id} findings={findings} screenshots={screenshots} />
          </div>

          {/* ── Engagement & delivery — only after understanding ────────────── */}
          <div className="flex items-center gap-3 pt-2">
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-chalk-600">Engagement &amp; delivery</span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {/* Deliverable */}
          <div id="deliverable">
            <DeliverablePanel lead={lead} deliverables={deliverables} findingsCount={findings.filter((f) => f.approved).length} />
          </div>

          {/* Video */}
          <div id="video">
            <VideoPanel lead={lead} videos={videos} screenshots={screenshots} />
          </div>

          {/* Outreach kit (v2) — email, follow-up, video, phone guide, discovery, confidence */}
          {outreachKit && <OutreachKitPanel kit={outreachKit} />}

          {/* Outreach */}
          <div id="outreach">
            <OutreachPanel lead={lead} outreach={outreach} contacts={contacts} settings={settings} hasVideo={videos.some((v) => v.videoUrl)} hasBrief={deliverables.some((d) => d.status !== "draft")} />
          </div>

          {/* Acquisition strategy */}
          <AcquisitionPanel lead={lead} plans={acquisitionPlans} />

          {/* Acquisition timeline */}
          <AcquisitionTimeline events={timeline} />

          {/* Concept Website Preview */}
          <ConceptPreviewPanel leadId={lead.id} tier={lead.tier} preview={activePreview} version={previewVersion} shares={previewShares} findings={findings} appUrl={appUrl} />

          {/* Meeting + proposal */}
          <div id="meeting">
            <MeetingProposalPanel lead={lead} meetings={meetings} proposals={proposals} />
          </div>

          {/* Client agreement lifecycle */}
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
        </div>
      </div>
    </div>
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

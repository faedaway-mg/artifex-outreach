import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, User2, Mail, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import { getLead, getBusinessIntelligence, getSettings, contactsForLead, isSuppressed, emailSendsForLead, memoryForLead } from "@/lib/repo";
import { buildOutreachKit } from "@/lib/outreach/kit";
import { memoryReferences } from "@/lib/reasoning";
import { renderPersonalEmailHtml, renderPersonalEmailText } from "@/lib/outreach/email-render";
import { readingSeconds } from "@/lib/outreach/voice-engine";
import { scoreEmailQuality } from "@/lib/outreach/quality";
import { deslug } from "@/lib/utils";
import { SendIntroForm } from "@/components/lead/SendIntroForm";
import { EmailQualityPanel } from "@/components/lead/EmailQualityPanel";
import { determineContactStrategy, buildCallBrief, findInstagram } from "@/lib/outreach/contact-strategy";
import { ContactStrategyPanel } from "@/components/lead/ContactStrategyPanel";

export const dynamic = "force-dynamic";

export default async function SendPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [stored, settings, contacts, memory] = await Promise.all([getBusinessIntelligence(lead.id), getSettings(), contactsForLead(lead.id), memoryForLead(lead.id)]);
  const profile = stored?.profile?.businessProfile ?? null;
  // Continuity: ground the follow-up in what we've actually confirmed we learned.
  const memoryLines = memoryReferences(memory).map((r) => r.sentence);
  const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });

  if (!profile) {
    return (
      <div className="space-y-4">
        <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100"><ArrowLeft size={15} /> Back to {lead.businessName}</Link>
        <div className="card p-6 text-sm text-chalk-400">No Business Technology Review exists yet — generate it before reviewing the introduction.</div>
      </div>
    );
  }

  const kit = buildOutreachKit({ lead, profile, settings, contacts, memoryLines });
  const dm = kit.decisionMaker;
  const recipient = dm.primary?.directEmail || dm.primary?.officeEmail || lead.publicEmail;
  const isDirect = !!dm.primary?.directEmail && recipient === dm.primary.directEmail;

  // No email route → don't dead-end on a giant email nobody can receive. Show the
  // contact strategy (usually call-first): how to open the relationship + capture.
  if (!recipient) {
    const strategy = determineContactStrategy(lead, { decisionMakerEmail: null });
    const wantsBrief = strategy.kind === "call-first" || strategy.kind === "instagram-dm-first";
    const brief = wantsBrief ? buildCallBrief(lead, { strongestObservation: stored?.profile?.briefing?.strongestOpportunities?.[0] ?? null }) : null;
    return (
      <div className="space-y-5">
        <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100"><ArrowLeft size={15} /> Back to {lead.businessName}</Link>
        <div>
          <h1 className="text-xl font-semibold text-chalk-50">How to reach {lead.businessName}</h1>
          <p className="mt-1 text-sm text-chalk-500">No public email was found — so this doesn't start with one. Here's the right first touch.</p>
        </div>
        <ContactStrategyPanel leadId={lead.id} strategy={strategy} brief={brief} phone={lead.phone} contactFormUrl={lead.contactFormUrl} instagramUrl={findInstagram(lead.socialLinks)} />
      </div>
    );
  }

  // Intro until the ledger shows one was accepted; then this becomes the follow-up.
  const introSent = (await emailSendsForLead(lead.id)).some((s) => !!s.sentAt);
  const mode: "intro" | "followup" = introSent ? "followup" : "intro";
  const email = mode === "followup" ? kit.followUp : kit.email;

  const html = renderPersonalEmailHtml({ email, settings, unsubscribeUrl: "https://outreach.artifexlabs.tech/api/comms/unsubscribe" });
  const text = renderPersonalEmailText({ email, settings });

  // Decision-first summary — the same read the batch loop shows, so the operator answers
  // "would I send this?" without reading a giant email. The exact rendered message is
  // documentation, one tap away.
  const why = lead.recommendationReason?.trim() || stored?.profile?.briefing?.whyItMatters || "Worth a thoughtful touch today.";
  const observations = (stored?.profile?.briefing?.strongestOpportunities ?? []).slice(0, 2);
  const openingSentence = email.paragraphs[1] ?? email.paragraphs[0] ?? email.subject;
  const secs = Math.round(readingSeconds(email.body));
  const readingLabel = secs < 60 ? `~${Math.max(5, secs)}s read` : `~${Math.round(secs / 60)} min read`;

  const warnings: string[] = [];
  if (!recipient) warnings.push("No email address on file — the send will be blocked until a route is found.");
  if (!dm.identified) warnings.push("Decision maker not confidently identified — this goes to the office address.");
  if (mode === "intro" && kit.videoRecommended) warnings.push("A personal video is recommended for this high-value lead — attach it below, or send without it.");

  return (
    <div className="space-y-5">
      <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100"><ArrowLeft size={15} /> Back to {lead.businessName}</Link>

      <div>
        <h1 className="text-xl font-semibold text-chalk-50">Review &amp; send the {mode === "followup" ? "follow-up" : "introduction"}</h1>
        <p className="mt-1 text-sm text-chalk-500">Exactly what {lead.businessName} will receive. Nothing sends until you approve it.</p>
      </div>

      {suppressed && (
        <div className="flex items-center gap-2 rounded-xl border border-coral-400/30 bg-coral-400/[0.06] p-3 text-sm text-coral-200">
          <ShieldAlert size={16} /> This business is on the suppression list. The pipeline will refuse to send.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Left column: the decision first, then its supporting context (ES-010 order). */}
        <div className="space-y-4">
        {/* Decision-first: who, why, what stood out, and a one-line read of the message.
            The exact rendered email lives behind "See the exact email" — documentation,
            not the first thing you read. */}
        <div className="card p-5">
          <p className="text-[12px] text-chalk-500">{mode === "followup" ? "Follow up with" : "Approve the email to"}</p>
          <h2 className="mt-0.5 text-[1.35rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{lead.businessName}</h2>
          <p className="mt-0.5 text-[12.5px] text-chalk-500">{[deslug(lead.industry), dm.primary?.name].filter(Boolean).join(" · ")}</p>

          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Why we're reaching out</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-300">{why}</p>
          </div>

          {observations.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What stood out</p>
              <ul className="mt-1 space-y-1">
                {observations.map((o, i) => <li key={i} className="flex gap-2 text-[13px] text-chalk-300"><span className="mt-0.5 text-amber-300">→</span><span>{o}</span></li>)}
              </ul>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[13px] font-medium text-chalk-100">{email.subject}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-chalk-400">“{openingSentence}”</p>
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-chalk-600"><Clock size={11} /> {readingLabel} · founder voice, low-pressure</p>
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11.5px] text-amber-300/90 hover:text-amber-300">
                <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> See the exact email
              </summary>
              <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-white">
                <iframe srcDoc={html} title="Email preview" className="h-[520px] w-full" />
              </div>
              <details className="mt-3 text-sm text-chalk-400">
                <summary className="cursor-pointer text-chalk-300">Plaintext fallback (and images-blocked view)</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[12px] text-chalk-400">{text}</pre>
              </details>
            </details>
          </div>
        </div>

        {/* Would I send this? — decision support BELOW the summary (ES-010: context
            follows the decision, never precedes it). */}
        <EmailQualityPanel quality={scoreEmailQuality(email, { lead, profile, observationCount: mode === "followup" ? 0 : undefined })} mode={mode} />
        </div>

        {/* Recipient + warnings + send */}
        <div className="space-y-4">
          <div className="card p-4 text-sm">
            <p className="flex items-center gap-2 text-chalk-200"><User2 size={14} className="text-azure-300" /> Recipient</p>
            <div className="mt-2 space-y-1 text-[13px] text-chalk-400">
              <p className="text-chalk-100">{dm.primary?.name ?? lead.businessName}</p>
              <p className="inline-flex items-center gap-1.5"><Mail size={13} /> {recipient ?? "— no address —"} <span className="text-[11px] text-chalk-600">({isDirect ? "direct" : "office"})</span></p>
              <p className="text-[12px] text-chalk-500">Decision-maker confidence: {dm.confidence}/100 — {dm.identified ? dm.primary?.role : "not confidently identified"}</p>
              <p className="text-[12px] text-chalk-600">This starts a new thread (the provider does not thread follow-ups).</p>
            </div>
            <div className="mt-3 border-t border-white/[0.06] pt-2">
              <p className="text-[12px] text-chalk-500">Subject</p>
              <p className="text-chalk-200">{email.subject}</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-chalk-600">
                {email.subjectAlternatives.map((a) => <li key={a}>· {a}</li>)}
              </ul>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="card border-amber-400/20 bg-amber-400/[0.03] p-4">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-amber-200"><AlertTriangle size={13} /> Before you send</p>
              <ul className="mt-1.5 space-y-1 text-[12px] text-chalk-400">
                {warnings.map((w) => <li key={w}>· {w}</li>)}
              </ul>
            </div>
          )}

          <div className="card p-4">
            <SendIntroForm leadId={lead.id} mode={mode} hasVideoRecommended={mode === "intro" && kit.videoRecommended} />
          </div>
        </div>
      </div>
    </div>
  );
}

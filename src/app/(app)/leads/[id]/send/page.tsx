import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, User2, Mail, AlertTriangle } from "lucide-react";
import { getLead, getBusinessIntelligence, getSettings, contactsForLead, isSuppressed, emailSendsForLead, memoryForLead } from "@/lib/repo";
import { buildOutreachKit } from "@/lib/outreach/kit";
import { memoryReferences } from "@/lib/reasoning";
import { renderEmailHtml, renderEmailText } from "@/lib/outreach/email-render";
import { scoreEmailQuality } from "@/lib/outreach/quality";
import { SendIntroForm } from "@/components/lead/SendIntroForm";
import { EmailQualityPanel } from "@/components/lead/EmailQualityPanel";

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

  // Intro until the ledger shows one was accepted; then this becomes the follow-up.
  const introSent = (await emailSendsForLead(lead.id)).some((s) => !!s.sentAt);
  const mode: "intro" | "followup" = introSent ? "followup" : "intro";
  const email = mode === "followup" ? kit.followUp : kit.email;

  const html = renderEmailHtml({ email, settings, unsubscribeUrl: "https://outreach.artifexlabs.tech/api/comms/unsubscribe" });
  const text = renderEmailText({ email, settings });

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

      {/* Communication quality — decision support so Jordan can answer "would I send this?" */}
      <EmailQualityPanel quality={scoreEmailQuality(email, { lead, profile, observationCount: mode === "followup" ? 0 : undefined })} mode={mode} />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Rendered email */}
        <div className="card p-4">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-chalk-600">Rendered email (HTML)</p>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white">
            <iframe srcDoc={html} title="Email preview" className="h-[520px] w-full" />
          </div>
          <details className="mt-3 text-sm text-chalk-400">
            <summary className="cursor-pointer text-chalk-300">Plaintext fallback (and images-blocked view)</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[12px] text-chalk-400">{text}</pre>
          </details>
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

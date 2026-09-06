import { FileText, Mail, ShieldCheck, AlertTriangle, Clock } from "lucide-react";
import type { ScheduledDetail } from "@/lib/outreach/scheduled-detail";
import { ACCOUNTING_TZ } from "@/lib/outreach/sending-window";
import { OperatorVideoPreview } from "@/components/content-studio/OperatorVideoPreview";

// Package-aware Scheduled detail card (mandate 22). Shows the EXACT frozen content the binding will send,
// resolved by package type. It NEVER shows a missing-video warning for EMAIL_ONLY / EMAIL_PDF — only when
// a video package genuinely lacks its video (then the item is quarantined → Needs Attention).
const TYPE_LABEL: Record<ScheduledDetail["packageType"], string> = {
  EMAIL_ONLY: "Email only",
  EMAIL_PDF: "Email + Quick Review PDF",
  EMAIL_VIDEO: "Email + PDF + video",
  VIDEO_FOLLOW_UP: "Follow-up + video",
};

export function ScheduledPackageCard({ detail }: { detail: ScheduledDetail }) {
  const d = detail;
  const when = new Date(d.scheduledAt).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (d.quarantined) {
    return (
      <div data-scheduled-detail data-package-type={d.packageType} data-scheduled-quarantined className="rounded-2xl border border-coral-400/30 bg-coral-400/[0.05] p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral-300" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-chalk-50">Needs attention — {d.business}</div>
            <p className="mt-1 text-[13px] text-chalk-300">
              This scheduled item declares a <strong>{TYPE_LABEL[d.packageType]}</strong> package but is missing required content
              {d.missing.length ? `: ${d.missing.join(", ")}` : ""}{d.validator.ok ? "" : ` — ${d.validator.reason}`}. It will not be sent and consumes no capacity.
            </p>
            <p className="mt-1 text-[12px] text-chalk-500">Recipient {d.recipient} · scheduled {when} PT · revision {d.revisionId.slice(0, 12)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-scheduled-detail data-package-type={d.packageType} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-chalk-50">{d.business}</div>
          <div className="truncate text-[12.5px] text-chalk-400" data-scheduled-recipient>{d.recipient}</div>
        </div>
        <span className="shrink-0 rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[11px] text-teal-200" data-scheduled-typelabel>{TYPE_LABEL[d.packageType]}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-chalk-400">
        <span className="inline-flex items-center gap-1"><Clock size={12} /> <span data-scheduled-when>{when} PT</span></span>
        <span>revision <span className="text-chalk-300" data-scheduled-revision>{d.revisionId.slice(0, 12)}</span></span>
        <span className={`inline-flex items-center gap-1 ${d.validator.ok ? "text-teal-300" : "text-coral-300"}`}><ShieldCheck size={12} /> {d.validator.ok ? "validated for dispatch" : `invalid: ${d.validator.reason}`}</span>
      </div>

      {/* Email — always present. The exact frozen subject + body that will send. */}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3" data-scheduled-email>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-chalk-500"><Mail size={12} /> Email</div>
        <div className="mt-1 truncate text-[13px] font-medium text-chalk-100" data-scheduled-subject>{d.subject || "—"}</div>
        {d.bodyText ? (
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug text-chalk-400" data-scheduled-body>{d.bodyText}</p>
        ) : (
          <p className="mt-1 text-[12px] italic text-chalk-500" data-scheduled-body>Body is composed from the frozen revision at send.</p>
        )}
      </div>

      {/* PDF — only when this package type attaches one. */}
      {d.pdf.required && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {d.pdf.present && d.pdf.href ? (
            <a href={d.pdf.href} target="_blank" rel="noreferrer" data-scheduled-pdf className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12.5px] text-chalk-200 hover:bg-white/[0.05]"><FileText size={13} /> Quick Review PDF</a>
          ) : (
            <span className="text-[12px] text-coral-300">PDF missing</span>
          )}
        </div>
      )}

      {/* Video — only for video packages. The operator previews the CANONICAL current video via the
          authenticated operator route (never the expiring recipient share); recipient-share status is shown
          separately below. */}
      {d.video.required && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-scheduled-video>
          {d.currentVideo.available ? (
            <OperatorVideoPreview leadId={d.leadId} available={d.currentVideo.available} reason={d.currentVideo.reason}
              revisionId={d.currentVideo.revisionId} source={d.currentVideo.source} triggerLabel="Video" />
          ) : (
            <span className="text-[12px] text-coral-300">Video missing</span>
          )}
          <span className="text-[11.5px] text-chalk-500">
            recipient link: {d.currentVideo.recipientShare.state === "active" ? "active" : d.currentVideo.recipientShare.state === "revoked" ? "revoked" : "not yet issued"}
          </span>
        </div>
      )}

      {d.evidenceSummary.length > 0 && (
        <div className="mt-3" data-scheduled-evidence>
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">Evidence</div>
          <ul className="mt-1 list-disc pl-4 text-[12.5px] text-chalk-400">
            {d.evidenceSummary.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-chalk-500" data-scheduled-compliance>
        <ShieldCheck size={12} className="text-teal-300" /> CAN-SPAM footer + one-click unsubscribe are applied by the compliant transport at send.
      </div>
    </div>
  );
}

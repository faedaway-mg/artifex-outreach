"use client";
import Link from "next/link";
import { FileText, Video, Mail, ArrowRight } from "lucide-react";
import { ApproveScheduleButton } from "./ApproveScheduleButton";

export interface ReadyApproveProps {
  leadId: string; business: string; recipient: string; state: string; packageVersion: number | null;
  subject: string | null; bodyText: string | null; shareHref: string | null; hasVideo: boolean; pdfHref: string | null;
}

// A single Ready-to-Approve decision card. Shows ONLY the current canonical package (email + PDF + video +
// share + revision) and the ONE canonical approve+schedule action. No second send path; no stale artifacts.
export function ReadyApproveCard(p: ReadyApproveProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-chalk-50">{p.business}</div>
          <div className="truncate text-[12.5px] text-chalk-400">{p.recipient} · Ready to approve{p.packageVersion ? ` · v${p.packageVersion}` : ""}</div>
        </div>
        <span className="shrink-0 rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[11px] text-teal-200">{p.state}</span>
      </div>

      {/* Email preview */}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-chalk-500"><Mail size={12} /> Email</div>
        <div className="mt-1 truncate text-[13px] font-medium text-chalk-100">{p.subject ?? "—"}</div>
        {p.bodyText && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-snug text-chalk-400">{p.bodyText}</p>}
      </div>

      {/* Artifact links (current package only) */}
      <div className="mt-2 flex flex-wrap gap-2">
        {p.pdfHref && <a href={p.pdfHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12.5px] text-chalk-200 transition-colors hover:bg-white/[0.05]"><FileText size={13} /> Quick Review PDF</a>}
        {p.hasVideo && p.shareHref && <a href={p.shareHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12.5px] text-chalk-200 transition-colors hover:bg-white/[0.05]"><Video size={13} /> Video</a>}
        <Link href={`/company/${p.leadId}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] text-chalk-400 transition-colors hover:text-chalk-200">Open full package <ArrowRight size={12} /></Link>
      </div>

      {/* The ONE canonical action — shared with the Full Package view (same domain operation). */}
      <ApproveScheduleButton leadId={p.leadId} className="mt-3" />
    </div>
  );
}

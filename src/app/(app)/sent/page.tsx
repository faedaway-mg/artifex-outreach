import Link from "next/link";
import { listAudit, allEmailSends, listLeads } from "@/lib/repo";
import { receiptsFromAudit } from "@/lib/comms/receipt";
import { Mail, CheckCircle2, CalendarClock, AlertTriangle, Clock } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { currentAllocation } from "@/lib/outreach/allocation-state";
import { ACCOUNTING_TZ } from "@/lib/outreach/sending-window";
import type { EmailSend, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Provider-backed state only (mandate part 5): Provider accepted / Delivered / Bounced / Replied.
function providerState(s: EmailSend | undefined, replied: boolean): { text: string; tone: string } {
  if (replied) return { text: "Replied", tone: "text-emerald-300" };
  if (!s) return { text: "Provider accepted", tone: "text-azure-300" };
  if (s.bouncedAt || s.status === "bounced") return { text: "Bounced", tone: "text-coral-300" };
  if (s.complainedAt) return { text: "Complaint", tone: "text-coral-300" };
  if (s.deliveredAt || s.status === "delivered") return { text: "Delivered", tone: "text-teal-300" };
  return { text: "Provider accepted", tone: "text-azure-300" };
}

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "sent", label: "Sent" },
  { key: "attention", label: "Needs attention" },
] as const;

export default async function ActivityPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = (["upcoming", "sent", "attention"].includes(searchParams?.tab ?? "") ? searchParams!.tab : "upcoming") as "upcoming" | "sent" | "attention";
  const [audit, sends, leads, snap, alloc] = await Promise.all([listAudit(2000), allEmailSends(), listLeads(), buildCompanySnapshot(new Date()), currentAllocation(new Date())]);
  const receipts = receiptsFromAudit(audit);
  const sendById = new Map<string, EmailSend>(sends.map((s) => [s.id, s]));
  const leadById = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  const repliedLeads = new Set(snap.replies.map((r) => r.leadId));
  const nextSched = [...snap.scheduled].sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))[0];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="eyebrow mb-1">Outreach</p>
        <h1 className="text-2xl font-semibold text-chalk-50">Activity</h1>
      </div>

      {/* Concise top summary only — next send, scheduled, sent today, remaining capacity. No allocation lecture. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Next send" value={nextSched ? fmtTime(nextSched.scheduledAt).replace(", ", " ") : "—"} tone="text-azure-300" small />
        <Stat label="Scheduled" value={String(snap.counts.scheduled)} tone="text-azure-300" />
        <Stat label="Sent today" value={String(snap.counts.sentToday)} tone="text-teal-300" />
        <Stat label="Remaining today" value={String(alloc.remainingTotal)} tone="text-chalk-200" />
      </div>

      <div className="flex gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <Link key={t.key} href={`/sent?tab=${t.key}`} className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === t.key ? "border-azure-400 text-chalk-100" : "border-transparent text-chalk-500 hover:text-chalk-300"}`}>{t.label}</Link>
        ))}
      </div>

      {tab === "upcoming" && (
        snap.scheduled.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing upcoming." hint="Scheduled messages appear here with their future send time." /> : (
          <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
            {[...snap.scheduled].sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1)).map((s) => (
              <li key={s.leadId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0"><div className="truncate text-[13px] text-chalk-100">{leadById.get(s.leadId)?.businessName ?? s.leadId}</div><div className="truncate text-[11.5px] text-chalk-500">{s.recipient}</div></div>
                <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-azure-300"><Clock size={11} /> {fmtTime(s.scheduledAt)} PT</span>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "sent" && (
        receipts.length === 0 ? <EmptyState icon={Mail} title="No emails sent yet." hint="Provider-accepted emails appear here with delivery state." /> : (
          <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
            {receipts.slice(0, 100).map((r) => {
              const st = providerState(sendById.get(r.sendId), repliedLeads.has(r.leadId));
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0"><div className="truncate text-[13px] text-chalk-100">{r.businessName}</div><div className="truncate text-[11.5px] text-chalk-500">{r.toAddr} · {fmtTime(r.sentAt)} PT</div></div>
                  <span className={`flex shrink-0 items-center gap-1 text-[11.5px] ${st.tone}`}><CheckCircle2 size={11} /> {st.text}</span>
                </li>
              );
            })}
          </ul>
        )
      )}

      {tab === "attention" && (
        snap.needsAttention.length === 0 ? <EmptyState icon={AlertTriangle} title="Nothing needs attention." hint="Genuine automation failures appear here." /> : (
          <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
            {snap.needsAttention.map((r) => (
              <li key={r.leadId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0"><div className="truncate text-[13px] text-chalk-100">{r.business}</div><div className="truncate text-[11.5px] text-chalk-500">{r.failedAction ?? "Video render"} failed{r.failReason ? ` · ${r.failReason}` : ""}</div></div>
                <span className="shrink-0 text-[11px] text-chalk-500">{r.retryAvailable ? "retryable" : "terminal"}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className={`${small ? "text-[13px]" : "text-lg"} font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10.5px] uppercase tracking-wide text-chalk-500">{label}</div>
    </div>
  );
}

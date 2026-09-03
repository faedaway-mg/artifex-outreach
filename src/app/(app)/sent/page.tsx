import Link from "next/link";
import { listAudit, allEmailSends, listLeads } from "@/lib/repo";
import { receiptsFromAudit } from "@/lib/comms/receipt";
import { Mail, Paperclip, CheckCircle2, ExternalLink, CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { currentAllocation } from "@/lib/outreach/allocation-state";
import { listScheduledBindings } from "@/lib/outreach/scheduled-batch";
import { ACCOUNTING_TZ } from "@/lib/outreach/sending-window";
import type { EmailSend, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

// Truthful delivery label from what the ledger actually knows (never claim "delivered" unless known).
function statusLabel(s: EmailSend | undefined): { text: string; tone: string } {
  if (!s) return { text: "Sent", tone: "text-teal-300" };
  if (s.bouncedAt) return { text: "Bounced", tone: "text-coral-300" };
  if (s.complainedAt) return { text: "Complaint", tone: "text-coral-300" };
  if (s.deliveredAt) return { text: "Delivered", tone: "text-teal-300" };
  if (s.openedAt) return { text: "Opened", tone: "text-emerald-300" };
  if (s.status === "failed") return { text: "Failed", tone: "text-coral-300" };
  return { text: "Sent / accepted", tone: "text-teal-300" };
}

export default async function SentPage() {
  const [audit, sends, leads, alloc, scheduled] = await Promise.all([listAudit(2000), allEmailSends(), listLeads(), currentAllocation(new Date()), listScheduledBindings()]);
  const receipts = receiptsFromAudit(audit);
  const sendById = new Map<string, EmailSend>(sends.map((s) => [s.id, s]));
  const leadById = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  const schedSorted = [...scheduled].sort((a, b) => (a.binding.scheduledAt < b.binding.scheduledAt ? -1 : 1));

  // Group by calendar day (newest first) so "who did I email today" is the top group.
  const groups: { key: string; label: string; items: typeof receipts }[] = [];
  for (const r of receipts) {
    const k = dayKey(r.sentAt);
    let g = groups.find((x) => x.key === k);
    if (!g) { g = { key: k, label: fmtDay(r.sentAt), items: [] }; groups.push(g); }
    g.items.push(r);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Outreach</p>
        <h1 className="text-2xl font-semibold text-chalk-50">Sent &amp; Scheduled</h1>
        <p className="mt-1 text-sm text-chalk-400">Every approved email that left Artifex, plus what’s scheduled to send — and today’s daily-cap allocation.</p>
      </div>

      {/* Daily-cap allocation (mandate 1) — the 10/10 reserve with cross-transfer, today's split. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-chalk-200">Today’s send allocation</h2>
          <span className="text-[11px] text-chalk-500">cap {alloc.cap}/LA-day · reserve {alloc.reserveFirst} first · {alloc.reserveFollow} follow-up</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"><div className="text-lg font-semibold tabular-nums text-teal-300">{alloc.firstTarget}</div><div className="text-[10.5px] uppercase tracking-wide text-chalk-500">First-touch today</div></div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"><div className="text-lg font-semibold tabular-nums text-azure-300">{alloc.followTarget}</div><div className="text-[10.5px] uppercase tracking-wide text-chalk-500">Follow-ups today</div></div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"><div className="text-lg font-semibold tabular-nums text-chalk-200">{alloc.sentFirstToday + alloc.sentFollowToday}</div><div className="text-[10.5px] uppercase tracking-wide text-chalk-500">Sent so far</div></div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"><div className="text-lg font-semibold tabular-nums text-chalk-200">{alloc.remainingTotal}</div><div className="text-[10.5px] uppercase tracking-wide text-chalk-500">Remaining</div></div>
        </div>
        <p className="mt-2 text-[11.5px] text-chalk-500">Demand now: {alloc.firstDemand} first-touch ready · {alloc.followDemand} follow-ups due. Unused reserve from either group transfers to the other, never exceeding {alloc.cap}.</p>
      </div>

      {schedSorted.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-chalk-500"><CalendarClock size={13} className="text-azure-300" /> Scheduled · {schedSorted.length}</h2>
          <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
            {schedSorted.map((s) => (
              <li key={s.leadId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0"><div className="truncate text-[13px] text-chalk-100">{leadById.get(s.leadId)?.businessName ?? s.leadId}</div><div className="truncate text-[11.5px] text-chalk-500">{s.binding.recipient} · Quick Review PDF + video link</div></div>
                <span className="shrink-0 text-[11.5px] text-azure-300">{new Date(s.binding.scheduledAt).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} PT</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {receipts.length === 0 ? (
        <EmptyState icon={Mail} title="No emails sent yet." hint="Approved Business Technology Review emails will appear here with a full receipt." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-chalk-500">{g.label} · {g.items.length}</h2>
              <div className="space-y-2">
                {g.items.map((r) => {
                  const st = statusLabel(sendById.get(r.sendId));
                  const lead = leadById.get(r.leadId);
                  return (
                    <details key={r.id} className="card group p-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-chalk-50">{r.businessName}</p>
                          <p className="truncate text-[12.5px] text-chalk-400">{r.subject}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-chalk-500">
                            <span>To {r.toAddr}</span>
                            {r.attachmentFilename && <span className="inline-flex items-center gap-1 text-chalk-400"><Paperclip size={11} /> Review attached</span>}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[12px] tabular-nums text-chalk-300">{fmtTime(r.sentAt)}</p>
                          <p className={`inline-flex items-center gap-1 text-[11px] ${st.tone}`}><CheckCircle2 size={11} /> {st.text}</p>
                        </div>
                      </summary>
                      {/* The receipt — the EXACT payload dispatched. Not a regenerable draft. */}
                      <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Subject sent</p>
                          <p className="mt-0.5 text-[13px] text-chalk-200">{r.subject}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Body sent (exact)</p>
                          <pre className="mt-0.5 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-chalk-300">{r.bodyText}</pre>
                        </div>
                        {r.attachmentFilename && (
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Review attached</p>
                            <p className="mt-0.5 text-[13px] text-chalk-300">{r.attachmentFilename} <span className="text-chalk-600">· sha256 {r.attachmentSha256?.slice(0, 12)}…</span></p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-chalk-500">
                          <span>Sent {new Date(r.sentAt).toLocaleString()}</span>
                          {r.providerMessageId && <span>Message-ID {r.providerMessageId}</span>}
                          {lead?.nextFollowUpAt && <span className="text-amber-300/80">Follow-up {new Date(lead.nextFollowUpAt).toLocaleDateString()}</span>}
                          <Link href={`/leads/${r.leadId}`} className="inline-flex items-center gap-1 text-azure-300 hover:text-azure-200">Open business <ExternalLink size={11} /></Link>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

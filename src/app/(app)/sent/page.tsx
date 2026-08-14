import Link from "next/link";
import { listAudit, allEmailSends, listLeads } from "@/lib/repo";
import { receiptsFromAudit } from "@/lib/comms/receipt";
import { Mail, Paperclip, CheckCircle2, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/ui";
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
  const [audit, sends, leads] = await Promise.all([listAudit(2000), allEmailSends(), listLeads()]);
  const receipts = receiptsFromAudit(audit);
  const sendById = new Map<string, EmailSend>(sends.map((s) => [s.id, s]));
  const leadById = new Map<string, Lead>(leads.map((l) => [l.id, l]));

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
        <h1 className="text-2xl font-semibold text-chalk-50">Sent emails</h1>
        <p className="mt-1 text-sm text-chalk-400">Every approved email that left Artifex — the exact record of what was sent, to whom, and when.</p>
      </div>

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

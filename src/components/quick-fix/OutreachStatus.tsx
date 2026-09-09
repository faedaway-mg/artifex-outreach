"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH STATE MACHINE (Parts B/K) — renders `outreachState` as ONE unmistakable
// canonical status and the DELIBERATE, DISTINCT actions for that state:
//   NEEDS_REVIEW      → primary "APPROVE OFFER" (helper: "does not send anything")
//   APPROVED_NOT_SENT → primary "SEND EMAIL" + secondary "SCHEDULE EMAIL"
//   SCHEDULED         → date/time/tz + Reschedule / Cancel
//   SENT              → sent timestamp/mailbox/recipient (read-only)
//   PURCHASED         → "OPEN FULFILLMENT"
//
// APPROVE NEVER sends or schedules. SEND and SCHEDULE are separate explicit calls to
// their own gated endpoints. This component only CALLS endpoints — it cannot itself
// send: the /api/revenue/send endpoint is the sole (gated) send path and may return
// "not sent, outbound gated". Subject selection posts /api/revenue/subject.
// ─────────────────────────────────────────────────────────────────────────────

type OutreachState = "NEEDS_REVIEW" | "APPROVED_NOT_SENT" | "SCHEDULED" | "SENT" | "PURCHASED";

interface Lifecycle {
  offerId: string;
  outreachState: OutreachState;
  subject: { selected: string | null; alternatives: string[]; family: string | null; frozen: boolean };
  scheduledAt: string | null;
  scheduledTz: string | null;
  sentAt: string | null;
  sentMailbox: string | null;
  sentRecipient: string | null;
  canApprove: boolean;
  canSend: boolean;
  canSchedule: boolean;
}

const BADGE: Record<OutreachState, { text: string; cls: string }> = {
  NEEDS_REVIEW: { text: "NEEDS REVIEW", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  APPROVED_NOT_SENT: { text: "APPROVED · NOT SENT", cls: "bg-azure-500/15 text-azure-300 ring-azure-500/30" },
  SCHEDULED: { text: "SCHEDULED", cls: "bg-azure-500/15 text-azure-300 ring-azure-500/30" },
  SENT: { text: "SENT", cls: "bg-teal-500/15 text-teal-300 ring-teal-500/30" },
  PURCHASED: { text: "PURCHASED", cls: "bg-teal-500/20 text-teal-200 ring-teal-500/40" },
};

const btnPrimary = "inline-flex w-full items-center justify-center rounded-xl bg-azure-500 px-5 py-3 text-[15px] font-semibold text-ink-975 hover:bg-azure-400 disabled:opacity-50";
const btnSecondary = "inline-flex w-full items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-[14px] font-medium text-chalk-200 hover:bg-white/5 disabled:opacity-50";
const btnGhost = "inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-chalk-300 hover:bg-white/5 disabled:opacity-50";

export function OutreachStatus({ lifecycle }: { lifecycle: Lifecycle }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [when, setWhen] = useState("");
  const [tz, setTz] = useState("America/Los_Angeles");
  const lc = lifecycle;

  async function call(endpoint: string, body: Record<string, unknown>, action: string) {
    setBusy(action); setNote(null);
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      // The send endpoint may return a gated "not sent" — surface it honestly.
      if (j && j.sent === false && j.reason) setNote(String(j.reason));
      else if (j && j.ok === false) setNote(String(j.error ?? j.reason ?? "Request could not be completed."));
      else setNote(null);
      router.refresh();
    } catch { setNote("Request failed."); }
    finally { setBusy(null); }
  }

  const badge = BADGE[lc.outreachState];

  return (
    <div className="space-y-3">
      {/* ONE canonical status badge */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wide ring-1 ${badge.cls}`}>{badge.text}</span>
        {lc.subject.frozen && lc.outreachState !== "NEEDS_REVIEW" && (
          <span className="text-[11px] text-chalk-500">subject frozen</span>
        )}
      </div>

      {/* Subject: selected + tappable alternatives (POST /api/revenue/subject) */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <div className="text-[11px] uppercase tracking-wide text-chalk-500">Subject line{lc.subject.frozen ? " · frozen" : ""}</div>
        <div className="mt-1 text-[13.5px] font-medium text-chalk-100">{lc.subject.selected ?? "— no subject —"}</div>
        {lc.subject.alternatives.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lc.subject.alternatives.map((alt) => (
              <button
                key={alt}
                disabled={lc.subject.frozen || busy != null}
                onClick={() => call("/api/revenue/subject", { offerId: lc.offerId, subject: alt }, `subject:${alt}`)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] ${alt === lc.subject.selected ? "bg-azure-500/20 text-azure-200" : "border border-white/10 text-chalk-300 hover:bg-white/5"} disabled:opacity-40`}
              >
                {alt}
              </button>
            ))}
          </div>
        )}
        {lc.subject.frozen ? (
          <div className="mt-1.5 text-[11px] text-chalk-500">Frozen at approval — editing is closed for this offer.</div>
        ) : (
          <div className="mt-1.5 text-[11px] text-chalk-500">You can change the subject before approving.</div>
        )}
      </div>

      {/* State-specific PRIMARY action(s) */}
      {lc.outreachState === "NEEDS_REVIEW" && (
        <div className="space-y-1.5">
          <button disabled={!lc.canApprove || busy != null} onClick={() => call("/api/revenue/approve", { offerId: lc.offerId }, "approve")} className={btnPrimary}>
            {busy === "approve" ? "Approving…" : "APPROVE OFFER"}
          </button>
          <p className="text-center text-[12px] text-chalk-500">Approval does not send anything.</p>
        </div>
      )}

      {lc.outreachState === "APPROVED_NOT_SENT" && (
        <div className="space-y-2">
          <button disabled={!lc.canSend || busy != null} onClick={() => call("/api/revenue/send", { offerId: lc.offerId }, "send")} className={btnPrimary}>
            {busy === "send" ? "Sending…" : "SEND EMAIL"}
          </button>
          {!showSchedule ? (
            <button disabled={!lc.canSchedule || busy != null} onClick={() => setShowSchedule(true)} className={btnSecondary}>SCHEDULE EMAIL</button>
          ) : (
            <div className="rounded-xl border border-white/10 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-chalk-500">Schedule send</div>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-chalk-100" />
              <input value={tz} onChange={(e) => setTz(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-chalk-100" placeholder="Timezone" />
              <div className="flex gap-2">
                <button disabled={!when || busy != null} onClick={() => call("/api/revenue/schedule", { offerId: lc.offerId, scheduledAt: new Date(when).toISOString(), tz }, "schedule")} className={btnSecondary}>
                  {busy === "schedule" ? "Scheduling…" : "Confirm schedule"}
                </button>
                <button onClick={() => setShowSchedule(false)} className={btnGhost}>Cancel</button>
              </div>
            </div>
          )}
          <p className="text-center text-[12px] text-chalk-500">Send and Schedule are separate, deliberate actions.</p>
        </div>
      )}

      {lc.outreachState === "SCHEDULED" && (
        <div className="space-y-2">
          <div className="rounded-xl border border-azure-500/25 bg-azure-500/5 p-3 text-[13px] text-chalk-200">
            Scheduled for <span className="font-semibold text-chalk-50">{lc.scheduledAt ?? "—"}</span>
            {lc.scheduledTz ? <span className="text-chalk-400"> ({lc.scheduledTz})</span> : null}
          </div>
          <div className="flex gap-2">
            <button disabled={busy != null} onClick={() => setShowSchedule((v) => !v)} className={btnSecondary}>Reschedule</button>
            <button disabled={busy != null} onClick={() => call("/api/revenue/schedule", { offerId: lc.offerId, cancel: true }, "cancel")} className={btnSecondary}>
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
          {showSchedule && (
            <div className="rounded-xl border border-white/10 p-3 space-y-2">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-chalk-100" />
              <input value={tz} onChange={(e) => setTz(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-chalk-100" />
              <button disabled={!when || busy != null} onClick={() => call("/api/revenue/schedule", { offerId: lc.offerId, scheduledAt: new Date(when).toISOString(), tz, reschedule: true }, "reschedule")} className={btnSecondary}>
                {busy === "reschedule" ? "Rescheduling…" : "Confirm new time"}
              </button>
            </div>
          )}
        </div>
      )}

      {lc.outreachState === "SENT" && (
        <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 p-3 text-[13px] text-chalk-200 space-y-0.5">
          <div>Sent <span className="font-semibold text-chalk-50">{lc.sentAt ?? "—"}</span></div>
          {lc.sentMailbox && <div className="text-[12px] text-chalk-400">from {lc.sentMailbox}</div>}
          {lc.sentRecipient && <div className="text-[12px] text-chalk-400">to {lc.sentRecipient}</div>}
        </div>
      )}

      {lc.outreachState === "PURCHASED" && (
        <a href={`/revenue/fulfillment/${lc.offerId}`} className={btnPrimary}>OPEN FULFILLMENT →</a>
      )}

      {note && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-200">{note}</p>}
    </div>
  );
}

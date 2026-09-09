"use client";
import { useState } from "react";
import type { OpportunityWorkspace as WorkspaceModel } from "@/lib/quick-fix/operator-views";
import { OutreachStatus } from "./OutreachStatus";
import { EmailPreview } from "./EmailPreview";
import { CustomerReceivesManifest } from "./CustomerReceivesManifest";
import { OfferPageView } from "./OfferPageView";
import { PersuasionPreview } from "./PersuasionPreview";
import { RunBreakbotButton } from "./RunBreakbotButton";
import type { PersuasionFlowView } from "@/lib/quick-fix/operator-views";

// ─────────────────────────────────────────────────────────────────────────────
// OPPORTUNITY WORKSPACE (Parts A / J / O) — the MOBILE-FIRST operator command center
// for one opportunity. The FIRST SCREEN answers, on one iPhone screen, WHO · [Open
// Website ↗] · STATUS · what we found · what we're selling + price · evidence presence
// · PRIMARY NEXT ACTION. No debug/log clutter; the 10-step funnel is never dominant.
// Tabs: Overview / Evidence / Video / PDF / Email / Offer / Activity. Read-only
// surface — the only mutation path is the gated OutreachStatus action buttons.
// ─────────────────────────────────────────────────────────────────────────────

const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

type Tab = "overview" | "preview" | "breakbot" | "evidence" | "video" | "pdf" | "email" | "offer" | "activity";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "preview", label: "Preview" },
  { key: "breakbot", label: "Breakbot QA" },
  { key: "evidence", label: "Evidence" },
  { key: "video", label: "Video" },
  { key: "pdf", label: "PDF" },
  { key: "email", label: "Email" },
  { key: "offer", label: "Offer" },
  { key: "activity", label: "Activity" },
];

const STATUS_CLS: Record<string, string> = {
  READY: "text-teal-300", MISSING: "text-chalk-500", STALE: "text-amber-300", UNVERIFIED: "text-amber-300", NOT_APPLICABLE: "text-chalk-500",
};

function AssetChip({ label, status }: { label: string; status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px]">
      <span className={`h-1.5 w-1.5 rounded-full ${status === "READY" ? "bg-teal-400" : status === "STALE" || status === "UNVERIFIED" ? "bg-amber-400" : "bg-chalk-600"}`} />
      <span className="text-chalk-300">{label}</span>
      <span className={STATUS_CLS[status] ?? "text-chalk-500"}>{status}</span>
    </span>
  );
}

export function OpportunityWorkspace({ w, persuasion, initialTab }: { w: WorkspaceModel; persuasion?: PersuasionFlowView | null; initialTab?: string }) {
  const validTab = TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(validTab);
  const ev = w.evidence;
  const shots = ev.screenshots;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* ── FIRST SCREEN (Part A/O): everything the operator needs in one glance ── */}
      <section className="card p-4 space-y-3">
        {/* WHO + Open Website */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">Opportunity</div>
            <h1 className="truncate text-[20px] font-semibold text-chalk-50">{w.company}</h1>
          </div>
          {w.websiteUrl ? (
            <a
              href={w.websiteUrl.startsWith("http") ? w.websiteUrl : `https://${w.websiteUrl}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-xl bg-azure-500/15 px-3 py-2 text-[13px] font-medium text-azure-200 hover:bg-azure-500/25"
            >
              Open Website ↗
            </a>
          ) : (
            <span className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-[12px] text-chalk-500">No website on file</span>
          )}
        </div>

        {/* Canonical status + the deliberate action(s) for this state */}
        <OutreachStatus lifecycle={w.lifecycle} />

        {/* What we found · what we're selling + price */}
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2.5">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">What we found</div>
            <p className="mt-0.5 text-[13.5px] text-chalk-200">{w.whatWeFound || "—"}</p>
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-chalk-500">What we're selling</div>
              <p className="mt-0.5 truncate text-[13.5px] text-chalk-100">{w.offerName}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[18px] font-bold text-chalk-50">{usd(w.priceCents)}</div>
              <div className="text-[11px] text-chalk-500">{w.band ?? (w.quickFixEligible ? "" : "conversation")}</div>
            </div>
          </div>
        </div>

        {/* Evidence presence roll-up (screenshots / video / PDF) */}
        <div className="flex flex-wrap gap-1.5">
          <AssetChip label="Screenshots" status={ev.screenshotStatus} />
          <AssetChip label="Personalized video" status={ev.personalizedVideo.status} />
          <AssetChip label="Evergreen video" status={ev.evergreenVideo.status} />
          <AssetChip label="Diagnostic PDF" status={ev.diagnosticPdf.status} />
        </div>
      </section>

      {/* ── Tabs (Part J) ── */}
      <div className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-white/8 bg-ink-975/80 px-1 py-1 backdrop-blur">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] ${tab === t.key ? "bg-white/10 text-chalk-100" : "text-chalk-400 hover:bg-white/5"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab bodies ── */}
      {tab === "overview" && (
        <div className="space-y-3">
          <div className="card p-4 text-[13px] text-chalk-300 space-y-1.5">
            <div><span className="text-chalk-500">Confidence</span> <span className="text-chalk-100">{w.confidence.toFixed(2)}</span> · <span className="text-chalk-500">grade</span> <span className="text-chalk-100">{w.evidenceGrade}</span></div>
            <div className="text-chalk-300">{w.whatWeSell}</div>
          </div>
          <CustomerReceivesManifest rows={w.customerReceives} />
        </div>
      )}

      {tab === "preview" && (
        persuasion ? (
          <PersuasionPreview flow={persuasion} />
        ) : (
          <div className="card p-4 text-[13px] text-chalk-500">Persuasion preview is unavailable for this opportunity.</div>
        )
      )}

      {tab === "breakbot" && (
        <div className="space-y-3">
          <div className="card p-4 text-[12.5px] text-chalk-400">
            Adversarial pre-flight QA over the WHOLE assembled customer journey for this
            offer (email · evidence · PDF · video · offer page · checkout · approval ·
            fulfillment). Read-only — it never approves, sends, or charges.
          </div>
          <RunBreakbotButton offerId={w.offerId} />
        </div>
      )}

      {tab === "evidence" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shots.map((s) => (
              <figure key={s.id} className="card overflow-hidden p-0">
                {s.status === "READY" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.imageRoute} alt={s.pageLabel} className="w-full bg-white/5" />
                ) : (
                  <div className="flex h-40 items-center justify-center text-[12px] text-chalk-500">No {s.viewport} screenshot ({s.status})</div>
                )}
                <figcaption className="p-2.5 text-[11.5px] text-chalk-400">{s.pageLabel} · <span className={STATUS_CLS[s.status]}>{s.status}</span></figcaption>
              </figure>
            ))}
          </div>
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">Findings</div>
            {ev.findings.length === 0 ? (
              <p className="mt-1 text-[13px] text-chalk-500">No evidence-backed findings.</p>
            ) : (
              <ul className="mt-2 space-y-2.5">
                {ev.findings.map((f) => (
                  <li key={f.id} className="text-[13px]">
                    <div className="text-chalk-100">{f.plain}</div>
                    <div className="mt-0.5 text-[11.5px] text-chalk-500">{f.whyItMatters} · {f.confidenceLabel} ({f.confidenceScore.toFixed(2)})</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "video" && (
        <div className="space-y-3">
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">Personalized walkthrough</div>
            <div className="mt-1 text-[13px] text-amber-300">{ev.personalizedVideo.status}</div>
            <p className="mt-1 text-[12px] text-chalk-500">{ev.personalizedVideo.detail}</p>
          </div>
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">Evergreen explainer (shared, labelled)</div>
            <div className={`mt-1 text-[13px] ${STATUS_CLS[ev.evergreenVideo.status]}`}>{ev.evergreenVideo.status}</div>
            {ev.evergreenVideo.url ? (
              <video src={ev.evergreenVideo.url} controls className="mt-2 w-full rounded-lg" />
            ) : (
              <p className="mt-1 text-[12px] text-chalk-500">{ev.evergreenVideo.detail}</p>
            )}
          </div>
        </div>
      )}

      {tab === "pdf" && (
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">Diagnostic PDF</div>
          <div className={`mt-1 text-[13px] ${STATUS_CLS[ev.diagnosticPdf.status]}`}>{ev.diagnosticPdf.status}</div>
          {ev.diagnosticPdf.url ? (
            <a href={ev.diagnosticPdf.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[13px] text-azure-300 hover:text-azure-200">Open PDF ↗</a>
          ) : (
            <p className="mt-1 text-[12px] text-chalk-500">{ev.diagnosticPdf.detail}</p>
          )}
        </div>
      )}

      {tab === "email" && (
        <EmailPreview
          header={w.email.header}
          bodyHtml={w.email.bodyHtml}
          bodyText={w.email.bodyText}
          primaryCta={w.email.primaryCta}
          safe={w.email.safe}
          links={w.email.links}
          attachments={w.email.attachments}
          customerReceives={w.customerReceives}
        />
      )}

      {tab === "offer" && (
        <div className="-mx-4 overflow-hidden rounded-xl border border-white/8">
          <OfferPageView model={w.offerPage} token={w.offerId} preview />
        </div>
      )}

      {tab === "activity" && (
        <div className="card p-4 text-[13px] text-chalk-400">
          Opportunity-scoped activity.{" "}
          <a href="/revenue/activity" className="text-azure-300 hover:text-azure-200">Open the full Activity feed →</a>
        </div>
      )}
    </div>
  );
}

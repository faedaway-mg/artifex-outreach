// ─────────────────────────────────────────────────────────────────────────────
// PERSUASION PREVIEW (Part T) — the operator-facing preview of the evidence-first
// persuasion SEQUENCE for one opportunity, rendered from persuasionFlowView(offerId).
// It answers, at a glance, the ONE question the operator must settle before approving:
// "does the prospect understand the PROBLEM before the PRICE?" — by laying out the
// four surfaces the prospect moves through (EMAIL → OFFER → PDF → VIDEO) plus the
// assessOfferReadiness verdict. Presentational only: no state, no fetch, no mutation.
// Nothing here can send or charge.
// ─────────────────────────────────────────────────────────────────────────────
import type { PersuasionFlowView } from "@/lib/quick-fix/operator-views";

function Ok({ ok, yes = "yes", no = "no" }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${ok ? "text-teal-300" : "text-amber-300"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-teal-400" : "bg-amber-400"}`} />
      {ok ? yes : no}
    </span>
  );
}

const STATUS_CLS: Record<string, string> = {
  READY: "text-teal-300", ATTACHED: "text-teal-300", LINKED: "text-azure-300",
  MISSING: "text-chalk-500", STALE: "text-amber-300", UNVERIFIED: "text-amber-300", NOT_APPLICABLE: "text-chalk-500",
};

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-chalk-500">{label}</span>
      <span className="min-w-0 text-right text-[12.5px] text-chalk-200">{children}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-chalk-400">{title}</div>
      {children}
    </section>
  );
}

export function PersuasionPreview({ flow }: { flow: PersuasionFlowView }) {
  const r = flow.readiness;
  const blockers = r.issues.filter((i) => i.severity === "BLOCKER");
  const warnings = r.issues.filter((i) => i.severity === "WARNING");

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* ── VERDICT: the one question, answered ── */}
      <section className={`rounded-xl border p-4 ${flow.understandsProblemBeforePrice ? "border-teal-500/30 bg-teal-500/[0.06]" : "border-amber-500/30 bg-amber-500/[0.06]"}`}>
        <div className="text-[11px] uppercase tracking-wide text-chalk-500">Preview · before you approve</div>
        <h2 className="mt-0.5 text-[15px] font-semibold text-chalk-50">
          Does the prospect understand the problem before the price?
        </h2>
        <div className="mt-2 flex items-center gap-2">
          <span className={`text-[13px] font-bold ${flow.understandsProblemBeforePrice ? "text-teal-300" : "text-amber-300"}`}>
            {flow.understandsProblemBeforePrice ? "YES — evidence-first, no blockers" : "NOT YET — blockers present"}
          </span>
        </div>
        {blockers.length > 0 && (
          <ul className="mt-2 space-y-1">
            {blockers.map((i, n) => (
              <li key={n} className="text-[12px] text-amber-200">
                <span className="font-semibold">{i.surface}</span> — expected {i.expected}; saw {i.observed}
              </li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <div className="mt-2 text-[11.5px] text-chalk-500">{warnings.length} warning(s): {warnings.map((w) => w.surface).join(", ")}</div>
        )}
      </section>

      {/* ── EMAIL ── */}
      <Card title="1 · Email (the click-earner)">
        <Line label="Subject">{flow.email.subject}</Line>
        <div className="py-1">
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">First line</div>
          <p className="mt-0.5 text-[12.5px] text-chalk-200">{flow.email.firstLine}</p>
          <div className="mt-1"><Ok ok={flow.email.firstLineMatchesOpener} yes="matches the evidence opener" no="does NOT match the evidence opener" /></div>
        </div>
        <Line label="PDF">
          <span className={STATUS_CLS[flow.email.pdfAttachment] ?? "text-chalk-400"}>{flow.email.pdfAttachment}</span>
          {flow.email.pdfReason ? <span className="text-chalk-500"> · {flow.email.pdfReason}</span> : null}
        </Line>
        <Line label="Video link">{flow.email.videoLink ?? <span className="text-chalk-500">none (personalized MISSING)</span>}</Line>
        <Line label="Offer link">{flow.email.offerLink}</Line>
        <Line label="No price in body"><Ok ok={flow.email.noPriceInBody} /></Line>
        <Line label="No raw URL in body"><Ok ok={flow.email.noRawUrlInBody} /></Line>
        <Line label="Fabrication-safe"><Ok ok={flow.email.safe} /></Line>
      </Card>

      {/* ── OFFER PAGE ── */}
      <Card title="2 · Offer page (value before price)">
        <div className="py-1">
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">Hero</div>
          <p className="mt-0.5 text-[13px] text-chalk-100">{flow.offer.heroTitle}</p>
          <p className="text-[12px] text-chalk-500">{flow.offer.heroSubline}</p>
          <div className="mt-1"><Ok ok={flow.offer.heroLeadsWithExperience} yes="leads with experience, not price/SKU" no="does not lead with experience" /></div>
        </div>
        <ol className="mt-1 space-y-1">
          {flow.offer.beats.map((b, n) => (
            <li key={b.key} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="text-chalk-300"><span className="text-chalk-600">{n + 1}.</span> {b.label}</span>
              <Ok ok={b.present} yes="present" no="absent" />
            </li>
          ))}
        </ol>
        <div className="mt-2 border-t border-white/8 pt-2">
          <Line label="Price">{flow.offer.priceLabel || "—"}</Line>
          <Line label="Opens with evidence (chk #6)"><Ok ok={flow.offer.opensWithEvidence} /></Line>
          <Line label="Price visible before purchase (chk #10)"><Ok ok={flow.offer.priceVisibleBeforePurchase} /></Line>
        </div>
      </Card>

      {/* ── PDF ── */}
      <Card title="3 · Diagnostic PDF (evidence-first → price-last)">
        <Line label="Filename">{flow.pdf.filename}</Line>
        <Line label="Renderable"><Ok ok={flow.pdf.renderable} /></Line>
        <div className="py-1">
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">§1 opener</div>
          <p className="mt-0.5 text-[12.5px] text-chalk-200">{flow.pdf.opener}</p>
        </div>
        <Line label="§FINAL price">{flow.pdf.priceLabel}</Line>
        <Line label="Evidence first, price last"><Ok ok={flow.pdf.evidenceFirstPriceLast} /></Line>
      </Card>

      {/* ── VIDEO ── */}
      <Card title="4 · Personalized video (honest MISSING)">
        <Line label="Personalized"><span className={STATUS_CLS[flow.video.personalizedStatus] ?? "text-chalk-400"}>{flow.video.personalizedStatus}</span></Line>
        <p className="text-[11.5px] text-chalk-500">{flow.video.personalizedDetail}</p>
        <Line label="Would-be framing">{flow.video.framing}</Line>
        <Line label="Attempt supported"><Ok ok={flow.video.attemptSupported} yes="attempted-use ok" no="observational only" /></Line>
        <Line label="Evergreen (separate)"><span className={STATUS_CLS[flow.video.evergreenStatus] ?? "text-chalk-400"}>{flow.video.evergreenStatus}</span></Line>
      </Card>

      <div className="px-1 text-[11px] text-chalk-600">
        policy {flow.persuasionPolicyVersion} · evidence {flow.evidenceVersion} · read-only preview — no send, no charge
      </div>
    </div>
  );
}

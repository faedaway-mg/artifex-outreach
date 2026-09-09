import Link from "next/link";
import type { JourneyView, JourneyStep } from "@/lib/quick-fix/operator-views";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER JOURNEY PREVIEW — a read-only, NO-SEND, NO-CHARGE stitch of the EXACT
// frozen artifacts a prospect moves through, in real order:
//   INBOX → EMAIL → PDF → OFFER HERO → WEBSITE EVIDENCE → PERSONALIZED VIDEO →
//   REPAIR → PACKAGE → PROTECTIONS → PRICE → EVERGREEN → CHECKOUT.
// The personalized diagnostic video is placed BEFORE the evergreen explainer and the
// evergreen video is NEVER substituted into the personalized slot. This component only
// PRESENTS the journeyView model — it initiates no send and no charge.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CLASS: Record<string, string> = {
  READY: "bg-teal-400/12 text-teal-200 ring-1 ring-teal-400/25",
  MISSING: "bg-white/[0.06] text-chalk-400 ring-1 ring-white/10",
  STALE: "bg-amber-400/12 text-amber-200 ring-1 ring-amber-400/25",
  UNVERIFIED: "bg-amber-400/12 text-amber-200 ring-1 ring-amber-400/25",
  NOT_APPLICABLE: "bg-white/[0.04] text-chalk-500 ring-1 ring-white/5",
};

// The small step-nav the mandate asks for (Inbox · Email · PDF · Offer · Video · Price · Checkout).
const NAV: Array<{ label: string; anchor: string }> = [
  { label: "Inbox", anchor: "j-INBOX" },
  { label: "Email", anchor: "j-EMAIL" },
  { label: "PDF", anchor: "j-PDF" },
  { label: "Offer", anchor: "j-OFFER_HERO" },
  { label: "Video", anchor: "j-PERSONALIZED_VIDEO" },
  { label: "Price", anchor: "j-PRICE" },
  { label: "Checkout", anchor: "j-CHECKOUT" },
];

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${STATUS_CLASS[status] ?? STATUS_CLASS.MISSING}`}>
      {status}
    </span>
  );
}

function StepCard({ step, index }: { step: JourneyStep; index: number }) {
  return (
    <section id={`j-${step.kind}`} className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-500">Step {index + 1} · {step.navLabel}</p>
          <h3 className="mt-1 text-[15px] font-semibold text-chalk-50">{step.title}</h3>
        </div>
        <StatusBadge status={step.status} />
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-chalk-300">{step.detail}</p>
    </section>
  );
}

export function CustomerJourneyPreview({ j }: { j: JourneyView }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-center text-[12.5px] font-medium text-amber-200">
        OPERATOR JOURNEY PREVIEW — no email is sent and no charge is made.
      </div>

      <header className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h1 className="text-[18px] font-bold text-chalk-50">{j.company}</h1>
        <p className="mt-1 text-[12.5px] text-chalk-400">
          The exact artifacts a customer moves through — {j.quickFixEligible ? "quick-fix eligible" : "conversation offer"}.
        </p>
        {/* Step-nav — Inbox · Email · PDF · Offer · Video · Price · Checkout. */}
        <nav className="mt-3 flex flex-wrap gap-1.5">
          {NAV.map((n) => (
            <a key={n.anchor} href={`#${n.anchor}`} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-chalk-300 hover:bg-white/10 hover:text-chalk-100">
              {n.label}
            </a>
          ))}
        </nav>
        {/* The personalized-before-evergreen invariant, surfaced honestly. */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11.5px] text-chalk-400">
          <span className={j.personalizedBeforeEvergreen ? "text-teal-300" : "text-coral-300"}>
            {j.personalizedBeforeEvergreen ? "✓" : "✕"}
          </span>
          Personalized diagnostic video precedes the evergreen explainer, and the evergreen is never substituted into the personalized slot.
        </div>
      </header>

      {/* The rendered email exactly as composed (not sent). */}
      <section id="j-EMAIL-body" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-500">Email — rendered (not sent)</p>
        <div className="mt-2 text-[13px] text-chalk-200">
          <div><span className="text-chalk-500">From:</span> {j.inbox.fromName} &lt;{j.inbox.fromEmail}&gt;</div>
          <div><span className="text-chalk-500">To:</span> {j.inbox.to ?? "—"}</div>
          <div><span className="text-chalk-500">Subject:</span> {j.inbox.subject}</div>
          <div className="text-chalk-500">Attachments: {j.email.attachments}</div>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-975/40 p-3 text-[12px] text-chalk-400">{j.email.bodyText}</pre>
      </section>

      {/* The stitched, ordered journey steps — the real customer sequence. */}
      <div className="space-y-3">
        {j.steps.map((step, i) => <StepCard key={step.kind} step={step} index={i} />)}
      </div>

      {/* Convenience links to the underlying frozen artifacts (read-only). */}
      <div className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12.5px]">
        <Link href={`/offer/${j.email.offerPath.replace(/^\/offer\//, "")}`} className="text-azure-300 underline underline-offset-2 hover:text-azure-200">
          Open offer page ↗
        </Link>
        {j.pdf.route && (
          <a href={j.pdf.route} target="_blank" rel="noopener noreferrer" className="text-azure-300 underline underline-offset-2 hover:text-azure-200">
            View diagnostic PDF ↗
          </a>
        )}
        <Link href={`/revenue/opportunity/${j.offerId}`} className="text-chalk-400 underline underline-offset-2 hover:text-chalk-200">
          Opportunity workspace
        </Link>
      </div>
    </div>
  );
}

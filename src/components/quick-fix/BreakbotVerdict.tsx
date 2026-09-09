"use client";
import { useState } from "react";
import type { BreakbotVerdict, Issue, Severity } from "@/lib/breakbot/quickcash-preflight";

// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT VERDICT CARD (operator-facing QA gate) — mobile-first. Answers, at a
// glance: "✓ N passed · ⚠ W warnings · ✕ B blockers → READY TO APPROVE / NOT READY".
// Tap "View issues" to expand each finding: surface · expected · observed · fix, with
// a deep-link to the relevant journey surface (Email/Evidence/Video/PDF/Offer/Checkout/
// Fulfillment/Operator). Raw JSON is tucked into a secondary debug disclosure only.
//
// Breakbot NEVER approves/sends — this is a QA GATE, not an action. A READY verdict
// means "the assembled experience is clean to APPROVE", never "approved" or "sent".
// ─────────────────────────────────────────────────────────────────────────────

// Map a Breakbot issue surface to the journey area it lives on + a deep link. The link
// is a tab hint on the opportunity workspace when we know the offer, else null. We never
// fabricate a target — an unmapped surface shows the finding without a link.
type Area = "Email" | "Evidence" | "Video" | "PDF" | "Offer" | "Checkout" | "Fulfillment" | "Operator" | "Approval";

function areaForSurface(surface: string): Area {
  const s = surface.toLowerCase();
  if (s.startsWith("email") || s.startsWith("rawurl") || s.startsWith("subject") || s.startsWith("customerlanguage")) return "Email";
  if (s.startsWith("video")) return "Video";
  if (s.startsWith("pdf")) return "PDF";
  if (s.startsWith("checkout")) return "Checkout";
  if (s.startsWith("approval")) return "Approval";
  if (s.startsWith("fulfillment")) return "Fulfillment";
  if (s.startsWith("operator") || s.startsWith("revenue")) return "Operator";
  if (s.startsWith("evidence") || s.startsWith("manifest") || s.startsWith("attempteduse")) return "Evidence";
  if (s.startsWith("openingframe") || s.startsWith("price") || s.startsWith("package") || s.startsWith("protections")) return "Offer";
  return "Offer";
}

// The opportunity-workspace tab the operator should open to fix a given area.
const AREA_TAB: Record<Area, string | null> = {
  Email: "email",
  Evidence: "evidence",
  Video: "video",
  PDF: "pdf",
  Offer: "offer",
  Checkout: "offer",
  Fulfillment: null,
  Operator: "overview",
  Approval: "overview",
};

const SEV_CLS: Record<Severity, string> = {
  BLOCKER: "text-rose-300",
  WARNING: "text-amber-300",
  INFO: "text-chalk-400",
};
const SEV_DOT: Record<Severity, string> = {
  BLOCKER: "bg-rose-400",
  WARNING: "bg-amber-400",
  INFO: "bg-chalk-600",
};

function IssueRow({ issue, offerId }: { issue: Issue; offerId?: string | null }) {
  const area = areaForSurface(issue.surface);
  const tab = AREA_TAB[area];
  const deepLink = offerId && tab ? `/revenue/opportunity/${offerId}?tab=${tab}#${encodeURIComponent(issue.surface)}` : null;
  return (
    <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[issue.severity]}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${SEV_CLS[issue.severity]}`}>{issue.severity}</span>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10.5px] text-chalk-400">{area}</span>
        <span className="ml-auto truncate text-[10.5px] text-chalk-500">{issue.surface}</span>
      </div>
      <dl className="mt-2 space-y-1.5 text-[12.5px]">
        <div><dt className="inline text-chalk-500">Expected: </dt><dd className="inline text-chalk-200">{issue.expected}</dd></div>
        <div><dt className="inline text-chalk-500">Observed: </dt><dd className="inline text-chalk-200">{issue.observed}</dd></div>
        <div><dt className="inline text-chalk-500">Fix: </dt><dd className="inline text-chalk-100">{issue.fix}</dd></div>
      </dl>
      {deepLink ? (
        <a href={deepLink} className="mt-2 inline-flex text-[12px] text-azure-300 hover:text-azure-200">Open {area} →</a>
      ) : (
        <span className="mt-2 inline-flex text-[11.5px] text-chalk-600">{area} surface</span>
      )}
    </li>
  );
}

export function BreakbotVerdictCard({
  verdict,
  offerId,
  title = "Breakbot pre-flight",
}: {
  verdict: BreakbotVerdict;
  offerId?: string | null;
  title?: string;
}) {
  const [showIssues, setShowIssues] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const { counts } = verdict;
  const ready = verdict.overall === "READY";
  // Sort issues so blockers come first, then warnings, then info.
  const order: Record<Severity, number> = { BLOCKER: 0, WARNING: 1, INFO: 2 };
  const issues = [...verdict.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const hasIssues = issues.length > 0;

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
            <span className="text-teal-300">✓ {counts.passed} passed</span>
            <span className="text-amber-300">⚠ {counts.warnings} warnings</span>
            <span className="text-rose-300">✕ {counts.blockers} blockers</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
              ready ? "bg-teal-500/15 text-teal-200" : "bg-rose-500/15 text-rose-200"
            }`}
          >
            {ready ? "READY TO APPROVE" : "NOT READY"}
          </span>
        </div>
      </div>

      {/* QA-gate honesty: a pass is a green light to APPROVE, never an approval/send. */}
      <p className="text-[11.5px] text-chalk-500">
        Breakbot is a QA gate. It reads the assembled experience and reports — it never approves, sends, or charges.
      </p>

      {hasIssues && (
        <button
          onClick={() => setShowIssues((v) => !v)}
          className="w-full rounded-lg border border-white/10 px-3 py-2 text-[12.5px] text-chalk-200 hover:bg-white/5"
        >
          {showIssues ? "Hide issues" : `View issues (${issues.length})`}
        </button>
      )}

      {showIssues && hasIssues && (
        <ul className="space-y-2">
          {issues.map((issue, i) => (
            <IssueRow key={`${issue.surface}-${i}`} issue={issue} offerId={offerId} />
          ))}
        </ul>
      )}

      {ready && !hasIssues && (
        <p className="text-[12.5px] text-teal-300">No issues found — the assembled journey is clean to approve.</p>
      )}

      {/* Secondary debug disclosure — raw JSON only, never the primary surface. */}
      <details className="text-[11.5px]" open={showJson} onToggle={(e) => setShowJson((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-chalk-600 hover:text-chalk-400">Debug: raw verdict JSON</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-2.5 text-[11px] leading-relaxed text-chalk-400">
          {JSON.stringify(verdict, null, 2)}
        </pre>
      </details>
    </section>
  );
}

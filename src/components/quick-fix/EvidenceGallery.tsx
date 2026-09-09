import { Camera, ExternalLink, AlertCircle } from "lucide-react";
import type { EvidencePackage, EvidenceScreenshot, EvidenceFinding } from "@/lib/quick-fix/evidence-package";

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE FROM YOUR WEBSITE — the personalized-proof section that leads the
// customer narrative. It renders ONLY real, stored screenshots of the customer's
// own live site (status === "READY"); it NEVER fabricates an image or shows a
// placeholder. When no real screenshot exists (screenshotStatus !== "READY"), the
// caller falls back to the existing text evidence card instead of this gallery.
//
// Everything shown here is labeled OBSERVED evidence — visually and semantically
// distinct from the conceptual before/after example elsewhere on the page. Copy is
// written for a non-technical owner: we surface each finding's plain-language
// restatement (`plain`), never the technical observation.
// ─────────────────────────────────────────────────────────────────────────────

function ObservedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-azure-500/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-azure-200 ring-1 ring-azure-400/25">
      <Camera size={12} /> Observed on your site
    </span>
  );
}

// The customer-facing issue line for a screenshot: prefer a finding explicitly linked
// to THIS screenshot (by screenshotId), else fall back to the strongest finding's
// plain-language text. Never uses the technical `observation`.
function issueForShot(shot: EvidenceScreenshot, findings: EvidenceFinding[]): string | null {
  const linked = findings.find((f) => f.screenshotId === shot.id && f.plain.trim().length > 0);
  if (linked) return linked.plain;
  const top = findings.find((f) => f.plain.trim().length > 0);
  return top ? top.plain : null;
}

function ScreenshotCard({ shot, issue }: { shot: EvidenceScreenshot; issue: string | null }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-azure-400/20 bg-white/[0.03]">
      <div className="relative bg-ink-975">
        {/* Real captured image of the customer's own live site, via the app image route. */}
        <img
          src={shot.imageRoute}
          alt={shot.pageLabel}
          loading="lazy"
          className="block max-h-[420px] w-full object-cover object-top"
        />
        <div className="absolute left-3 top-3">
          <ObservedBadge />
        </div>
      </div>
      <figcaption className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-chalk-100">{shot.pageLabel}</p>
          {shot.sourceUrl && (
            <a
              href={shot.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-azure-300 underline underline-offset-2 hover:text-azure-200"
            >
              View page <ExternalLink size={12} />
            </a>
          )}
        </div>
        {issue && (
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-chalk-200">
            <AlertCircle size={14} className="mt-0.5 flex-none text-coral-300" />
            <span>{issue}</span>
          </p>
        )}
      </figcaption>
    </figure>
  );
}

export function EvidenceGallery({ evidence }: { evidence: EvidencePackage }) {
  const ready = evidence.screenshots.filter((s) => s.status === "READY");
  if (ready.length === 0) return null; // caller decides the text-evidence fallback

  // Prefer the strongest 1–3 up front; anything beyond goes behind "View all evidence".
  const primary = ready.slice(0, 3);
  const rest = ready.slice(3);

  return (
    <section aria-label="Evidence from your website">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-azure-300">Evidence from your website</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-300">
        These are real screenshots we captured of your own live site — not mock-ups. Here is what we saw.
      </p>

      {/* Mobile: a horizontal snap row (swipeable, no giant wall). Desktop: a grid. */}
      <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible">
        {primary.map((shot) => (
          <div key={shot.id} className="w-[85%] flex-none snap-start sm:w-auto">
            <ScreenshotCard shot={shot} issue={issueForShot(shot, evidence.findings)} />
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <details className="group mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-chalk-300 [&::-webkit-details-marker]:hidden">
            <span>View all evidence ({ready.length})</span>
            <ExternalLink size={13} className="text-chalk-500" />
          </summary>
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
            {rest.map((shot) => (
              <ScreenshotCard key={shot.id} shot={shot} issue={issueForShot(shot, evidence.findings)} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

import Link from "next/link";
import { EvergreenManager } from "@/components/quick-fix/EvergreenManager";
import { CANONICAL_EXPLAINER_SCRIPT } from "@/lib/quick-fix/evergreen-asset";
import { resolveExplainerLibrary, type ResolvedExplainer } from "@/lib/quick-fix/explainer-library";
import * as store from "@/lib/quick-fix/store";

export const dynamic = "force-dynamic";

// §29: the PRIMARY admin display resolves from the SAME canonical explainer registry the
// customer offer page uses (resolveExplainerLibrary → Matt-bound > legacy-Lucas > MISSING),
// so this surface can never disagree with what a customer actually sees. The old
// single-asset EvergreenAssetVersion drafts (including the superseded "Hey, I'm Jordan"
// script) are demoted to a clearly-labelled HISTORY section and can never look active.

function sourceLabel(e: ResolvedExplainer): string {
  if (e.source === "matt-bound") return "Matt (current)";
  if (e.source === "legacy-lucas") return "Lucas visual master";
  return "MISSING";
}

// A superseded/legacy draft never displays as active. The old operator-authored
// script-only drafts (the "I'm Jordan" first-person drafts) are legacy by construction.
function isLegacyDraft(v: { script?: string | null; assetUrl?: string | null; status?: string }): boolean {
  const script = (v.script ?? "").toLowerCase();
  if (/\bi['’]m jordan\b|hey,? i['’]m\b/.test(script)) return true;
  if (!v.assetUrl) return true; // script-only draft, never customer-facing
  return v.status !== "active";
}

export default async function TrustAssetPage() {
  const versions = await store.getEvergreen();
  const canonical = await resolveExplainerLibrary();
  const legacyDrafts = versions.filter(isLegacyDraft);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Evergreen Trust Explainers</h1>
        <p className="mt-1 text-[13px] text-chalk-400">The canonical per-scope explainers customers actually see. Resolved from the same registry as the offer page — Matt-bound wins, else the approved Lucas visual master, else MISSING (which HOLDS the offer).</p>
      </div>

      {/* ── ACTIVE CANONICAL ASSETS (what the offer page uses) ─────────────────────── */}
      <div className="space-y-2" data-testid="evergreen-canonical">
        <div className="text-[11px] uppercase text-chalk-500">Active canonical assets · {canonical.filter((e) => e.source !== "missing").length}/{canonical.length} bound</div>
        {canonical.map((e) => (
          <div key={e.scope} className="card p-4" data-testid={`evergreen-scope-${e.scope}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-chalk-100">{e.title}</div>
                <div className="mt-0.5 text-[11.5px] text-chalk-500">{e.scope} · {sourceLabel(e)}{e.orientation ? ` · ${e.orientation}` : ""}{e.durationSeconds ? ` · ${Math.round(e.durationSeconds)}s` : ""}</div>
              </div>
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${e.source === "missing" ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                {e.source === "missing" ? "MISSING · offer HOLD" : "ACTIVE"}
              </span>
            </div>
            {e.servedMp4Url ? (
              <div className="mt-2 flex items-center gap-3 text-[11.5px] text-chalk-500">
                <a href={e.servedMp4Url} className="text-azure-300 hover:text-azure-200" target="_blank" rel="noreferrer">▶ Preview</a>
                {e.updatedAt ? <span>updated {new Date(e.updatedAt).toLocaleDateString()}</span> : null}
                {e.captionsVerified ? <span>· captions verified</span> : null}
                {e.visualMaster ? <span>· master {e.visualMaster}</span> : null}
              </div>
            ) : null}
          </div>
        ))}
        <p className="text-[11.5px] text-chalk-500">Full QA (timeline + narration-completeness) lives in the <Link href="/launch/explainers" className="text-azure-300 hover:text-azure-200">Explainer QA Gallery</Link>.</p>
      </div>

      {/* ── LEGACY / SUPERSEDED DRAFTS (history — never shown to customers) ─────────── */}
      {legacyDrafts.length > 0 ? (
        <details className="card p-4" data-testid="evergreen-legacy">
          <summary className="cursor-pointer text-[12px] font-medium text-chalk-400">Legacy / superseded drafts · {legacyDrafts.length} (history — never shown to customers)</summary>
          <p className="mt-2 text-[11.5px] text-chalk-500">These are old single-asset script-only drafts kept for history. They are SUPERSEDED and never resolve onto an offer page.</p>
          <div className="mt-2 space-y-1.5">
            {legacyDrafts.map((v) => (
              <div key={v.version} className="text-[11.5px] text-chalk-500">
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-chalk-400">SUPERSEDED</span> v{v.version} · {v.status}{v.assetUrl ? "" : " · script only"}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <EvergreenManager versions={versions} />

      <div className="card p-4">
        <div className="text-[11px] uppercase text-chalk-500">Canonical script (operationally true — no fake claims)</div>
        <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-chalk-400">{CANONICAL_EXPLAINER_SCRIPT}</p>
        <p className="mt-2 text-[11.5px] text-chalk-500">Company voice, never first-person operator. Rendering uses the standard Content Studio pipeline; attach the rendered MP4 and activate.</p>
      </div>
    </div>
  );
}

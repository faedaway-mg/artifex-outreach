import Link from "next/link";
import { EvergreenManager } from "@/components/quick-fix/EvergreenManager";
import { CANONICAL_EXPLAINER_SCRIPT, selectActiveEvergreen } from "@/lib/quick-fix/evergreen-asset";
import * as store from "@/lib/quick-fix/store";

export const dynamic = "force-dynamic";

// The evergreen trust asset lives in its own management surface — clearly separated
// from prospect diagnostics and content-marketing videos. It is ONE reusable, non-
// personalized, versioned asset shown on every offer page.
export default async function TrustAssetPage() {
  const versions = await store.getEvergreen();
  const active = selectActiveEvergreen(versions);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Evergreen Trust Video</h1>
        <p className="mt-1 text-[13px] text-chalk-400">ARTIFEX_QUICK_FIX_EXPLAINER — one reusable, non-lead-specific asset shown on every offer page. Swapping the active version never regenerates a single offer.</p>
      </div>

      <div className="card p-4">
        <div className="text-[11px] uppercase text-chalk-500">Active on offer pages</div>
        <div className="mt-1 text-[13px] text-chalk-200">{active ? `v${active.version} · ${active.status}${active.assetUrl ? " · render attached" : " · script only (no render yet)"}` : "none — offer pages show the script only"}</div>
      </div>

      <EvergreenManager versions={versions} />

      <div className="card p-4">
        <div className="text-[11px] uppercase text-chalk-500">Canonical script (operationally true — no fake claims)</div>
        <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-chalk-400">{CANONICAL_EXPLAINER_SCRIPT}</p>
        <p className="mt-2 text-[11.5px] text-chalk-500">Rendering a video uses the standard Content Studio pipeline, which requires a manual voiceover upload (no external TTS). Attach the rendered MP4 URL above, then Activate.</p>
      </div>
    </div>
  );
}

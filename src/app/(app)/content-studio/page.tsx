import Link from "next/link";
import { ZeroTouchStudio } from "@/components/content-studio/ZeroTouchStudio";
import { loadStudioPageData } from "@/lib/content-studio/studio-page-data";

export const dynamic = "force-dynamic";

// Server component: load the snapshot and hand the client ONLY public-safe fields (no absolute private
// filesystem paths for uploads or render outputs). The two-tab workspace split is built by the shared
// loadStudioPageData() so the index and the dedicated /content-studio/[purpose]/[leadId] pages agree.
export default async function ContentStudioPage({ searchParams }: { searchParams?: { piece?: string; lead?: string; section?: string; from?: string; type?: string } }) {
  const { items, videosToCreate, workerHealth, workspaces } = await loadStudioPageData();
  // Deep-link from Today (section F): ?lead=<id> maps to the stable project id client-<id>; ?piece=<id>
  // selects an exact piece; ?from=today renders a Back-to-Today control preserving Today's state.
  const deepLink = {
    piece: searchParams?.piece ?? null,
    lead: searchParams?.lead ?? null,
    section: searchParams?.section ?? null,
    from: searchParams?.from ?? null,
  };
  const activeType: "proposal" | "content" = searchParams?.type === "content" ? "content" : "proposal";
  return (
    <>
      {/* Offer / trust assets are a SEPARATE asset class from prospect diagnostics and
          content marketing. The evergreen Quick-Fix explainer is managed on its own surface. */}
      <div className="mx-auto mb-3 flex max-w-container items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5">
        <span className="text-[12.5px] text-chalk-400">Offer / trust assets (evergreen Quick-Fix explainer) are managed separately.</span>
        <Link href="/revenue/trust-asset" className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-chalk-200 hover:bg-white/5">Trust asset →</Link>
      </div>
      {/* Normal view = zero-touch (brief → Generate → finished video). The full workspace
          machinery lives behind Advanced. A deep-link (from Today / an exact piece) opens
          Advanced directly so existing navigation is preserved. */}
      <ZeroTouchStudio
        items={items}
        startAdvanced={Boolean(deepLink.piece || deepLink.lead || deepLink.from)}
        advancedProps={{ initialItems: items, deepLink, videosToCreate, workerHealth, workspaces: workspaces(activeType) }}
      />
    </>
  );
}

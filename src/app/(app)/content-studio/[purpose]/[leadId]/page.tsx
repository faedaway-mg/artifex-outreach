import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
import type { StudioItem } from "@/components/content-studio/types";
import { loadStudioPageData, orderedCardIds } from "@/lib/content-studio/studio-page-data";

export const dynamic = "force-dynamic";

// DEDICATED FULL-PAGE COMPANY WORKSPACE (mandate 26 §2). The mobile Content Studio is a list/index only;
// tapping a company card lands HERE — a focused, full-page workspace for exactly one video, with a clear
// Back control to the originating tab and Prev/Next across that tab's canonical ordering. Survives refresh
// and direct deep-link (the URL is the source of truth). Reuses the exact focused ContentStudioClient UI
// so narration/expand/regenerate/accept/create-improved-version behave identically to everywhere else.
export default async function ContentStudioCompanyPage({
  params, searchParams,
}: { params: { purpose: string; leadId: string }; searchParams?: { from?: string } }) {
  const purpose: "proposal" | "content" = params.purpose === "content" ? "content" : "proposal";
  const slug = decodeURIComponent(params.leadId);

  const { items, videosToCreate, workerHealth, split } = await loadStudioPageData();

  // Resolve the piece from the routing key: a proposal key is a leadId (→ client-<leadId>); a content key is
  // the piece id directly. Accept either form so both clean proposal URLs and content URLs deep-link.
  const pieceId = items.some((it) => it.piece.id === `client-${slug}`) ? `client-${slug}` : slug;
  const item: StudioItem | undefined = items.find((it) => it.piece.id === pieceId);
  if (!item) notFound();

  const title = (item.piece as any).businessName || (item.piece as any).title || "This video";

  // Prev/Next across the SAME tab's canonical ordering (group order → card order). Back returns to the exact
  // originating list (the ?from origin, which carries ?type=), falling back to the tab index.
  const order = orderedCardIds(split, purpose);
  const idx = order.indexOf(item.piece.id);
  const backHref = searchParams?.from ? decodeURIComponent(searchParams.from) : `/content-studio?type=${purpose}`;
  const linkTo = (id: string) => `/content-studio/${purpose}/${encodeURIComponent(id)}?from=${encodeURIComponent(backHref)}`;
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const pos = idx >= 0 ? `${idx + 1} of ${order.length}` : "";
  const advanceHref = next ? linkTo(next) : backHref;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Focused rail — Back to the originating tab, company name + position, Prev/Next across the tab. Disabled
          edges are inert spans (no clickable target). Nothing is hidden beneath the mobile bottom nav: this is
          a /content-studio/* deep route, which Shell renders in focus mode (no bottom nav). */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href={backHref} aria-label="Back to list" data-cs-back className="rounded-lg border border-white/10 p-2 text-chalk-400 hover:text-chalk-100"><X size={16} /></Link>
        <div className="min-w-0 text-center">
          <div className="truncate text-sm font-semibold text-chalk-50">{title}</div>
          <div className="text-[11px] text-chalk-500" data-cs-position>{pos ? `${pos} · ` : ""}{purpose === "content" ? "Content videos" : "Proposal videos"}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {prev ? (
            <Link href={linkTo(prev)} aria-label="Previous video" data-cs-prev className="rounded-lg border border-white/10 p-2 text-chalk-300 hover:text-chalk-100"><ChevronLeft size={16} /></Link>
          ) : (
            <span aria-label="Previous video" aria-disabled="true" data-cs-prev data-cs-nav-disabled className="rounded-lg border border-white/10 p-2 text-chalk-700 opacity-40 cursor-not-allowed"><ChevronLeft size={16} /></span>
          )}
          {next ? (
            <Link href={linkTo(next)} aria-label="Next video" data-cs-next className="rounded-lg border border-white/10 p-2 text-chalk-300 hover:text-chalk-100"><ChevronRight size={16} /></Link>
          ) : (
            <span aria-label="Next video" aria-disabled="true" data-cs-next data-cs-nav-disabled className="rounded-lg border border-white/10 p-2 text-chalk-700 opacity-40 cursor-not-allowed"><ChevronRight size={16} /></span>
          )}
        </div>
      </div>

      <ContentStudioClient
        initialItems={[item]}
        deepLink={{ piece: item.piece.id, lead: (item.piece as any).businessId ?? null, section: "client", from: searchParams?.from ?? null }}
        videosToCreate={videosToCreate}
        workerHealth={workerHealth}
        advanceHref={advanceHref}
      />
    </div>
  );
}

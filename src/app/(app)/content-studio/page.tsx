import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
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
  return <ContentStudioClient initialItems={items} deepLink={deepLink} videosToCreate={videosToCreate} workerHealth={workerHealth} workspaces={workspaces(activeType)} />;
}

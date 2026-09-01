import { studioSnapshot } from "@/lib/content-studio/store";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
import type { StudioItem, SafeJob } from "@/components/content-studio/types";

export const dynamic = "force-dynamic";

// Server component: load the snapshot and hand the client ONLY public-safe fields (no absolute private
// filesystem paths for uploads or render outputs).
export default async function ContentStudioPage({ searchParams }: { searchParams?: { piece?: string; lead?: string; section?: string; from?: string } }) {
  const raw = await studioSnapshot();
  const items: StudioItem[] = raw.map(({ piece, jobs, uploads, postedAt, provenance }) => ({
    piece,
    postedAt,
    provenance,
    uploads: uploads.map((u) => ({ name: u.name, bytes: u.bytes, durationSeconds: u.durationSeconds, uploadedAt: u.uploadedAt, kind: u.kind })),
    jobs: jobs.map(sanitizeJob),
  }));
  // Deep-link from Today (section F): ?lead=<id> maps to the stable project id client-<id>; ?piece=<id>
  // selects an exact piece; ?from=today renders a Back-to-Today control preserving Today's state.
  const deepLink = {
    piece: searchParams?.piece ?? null,
    lead: searchParams?.lead ?? null,
    section: searchParams?.section ?? null,
    from: searchParams?.from ?? null,
  };
  return <ContentStudioClient initialItems={items} deepLink={deepLink} />;
}

function sanitizeJob(j: any): SafeJob {
  return {
    id: j.id, pieceId: j.pieceId, inputVersion: j.inputVersion, status: j.status,
    progress: j.progress, stage: j.stage, mode: j.mode, audioKind: j.audioKind, audioLabel: j.audioLabel,
    outputRel: j.outputRel, thumbRel: j.thumbRel, error: j.error,
    createdAt: j.createdAt, finishedAt: j.finishedAt,
  };
}

import { studioSnapshot } from "@/lib/content-studio/store";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
import type { StudioItem, SafeJob } from "@/components/content-studio/types";

export const dynamic = "force-dynamic";

// Server component: load the snapshot and hand the client ONLY public-safe fields (no absolute private
// filesystem paths for uploads or render outputs).
export default async function ContentStudioPage() {
  const raw = await studioSnapshot();
  const items: StudioItem[] = raw.map(({ piece, jobs, uploads, postedAt }) => ({
    piece,
    postedAt,
    uploads: uploads.map((u) => ({ name: u.name, bytes: u.bytes, durationSeconds: u.durationSeconds, uploadedAt: u.uploadedAt })),
    jobs: jobs.map(sanitizeJob),
  }));
  return <ContentStudioClient initialItems={items} />;
}

function sanitizeJob(j: any): SafeJob {
  return {
    id: j.id, pieceId: j.pieceId, inputVersion: j.inputVersion, status: j.status,
    progress: j.progress, stage: j.stage, mode: j.mode, audioLabel: j.audioLabel,
    outputRel: j.outputRel, thumbRel: j.thumbRel, error: j.error,
    createdAt: j.createdAt, finishedAt: j.finishedAt,
  };
}

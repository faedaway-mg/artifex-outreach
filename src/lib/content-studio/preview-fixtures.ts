// Deterministic demo content for the READ-ONLY Content Studio preview (TRACK 1 visibility build). These
// are FIXTURES — no server state, no jobs, no storage. They exercise the real Social Content (Field Notes)
// list/detail and the key states (posting-ready, review-&-approve, not-generated) so the interfaces render
// faithfully on desktop and iPhone. Thumbnails + the sample video are real committed public assets; the
// preview badge makes clear that rendering is not connected.
import type { StudioItem } from "@/components/content-studio/types";

const thumb = (id: string) => `/content/thumbnails/field-note-${id}-thumbnail.png`;
const SAMPLE_MP4 = "/content/field-note-001/field-note-001-v4.mp4"; // real committed sample (demo only)

export const PREVIEW_ITEMS: StudioItem[] = [
  {
    piece: {
      id: "001", title: "The status update nobody reads.",
      concept: "Why the weekly update quietly stopped working — and what replaced it.",
      narration: [
        "Every team writes a status update.",
        "Almost nobody reads them.",
        "The information is real — the format is dead.",
        "What people actually want is the one decision that changed.",
      ],
      captionIG: "The weekly status update is dead. Here's what replaced it. #buildinpublic",
      captionLI: "Most status updates optimize for coverage, not decisions. Flip it.",
      sceneBasename: "scene-001.html", renderable: true, targetSeconds: 32,
      thumbRel: thumb("001"), recommendedRel: SAMPLE_MP4, hasThumbnailFirst: true,
    },
    postedAt: null,
    provenance: { audioKind: "approved-master", approved: true, approvalStale: false, postingAllowed: true },
    uploads: [],
    jobs: [{
      id: "demo_job_001", pieceId: "001", inputVersion: "sdemo0001", status: "ready", progress: 1,
      stage: "Ready", mode: "reuse-approved-audio", audioKind: "approved-master", audioLabel: "approved master",
      outputRel: SAMPLE_MP4, thumbRel: thumb("001"), error: null,
      createdAt: "2026-08-01T18:00:00.000Z", finishedAt: "2026-08-01T18:04:00.000Z",
    }],
  },
  {
    piece: {
      id: "002", title: "You don't have a writing problem.",
      concept: "The real reason the doc took three days — and it wasn't the words.",
      narration: [
        "You think it took three days because you're a slow writer.",
        "It took three days because you hadn't decided yet.",
        "Writing is just thinking with a paper trail.",
      ],
      captionIG: "You don't have a writing problem. You have a deciding problem.",
      captionLI: "Slow docs are usually undecided docs. Decide first, then it writes itself.",
      sceneBasename: "scene-002.html", renderable: true, targetSeconds: 28,
      thumbRel: thumb("002"), recommendedRel: SAMPLE_MP4, hasThumbnailFirst: true,
    },
    postedAt: null,
    provenance: { audioKind: "uploaded", approved: false, approvalStale: false, postingAllowed: false },
    uploads: [{ name: "vo-002-take3.mp3", bytes: 812_544, durationSeconds: 27.4, uploadedAt: "2026-08-20T15:12:00.000Z", kind: "uploaded" }],
    jobs: [{
      id: "demo_job_002", pieceId: "002", inputVersion: "sdemo0002", status: "ready", progress: 1,
      stage: "Ready", mode: "uploaded-vo", audioKind: "uploaded", audioLabel: "vo-002-take3.mp3",
      outputRel: SAMPLE_MP4, thumbRel: thumb("002"), error: null,
      createdAt: "2026-08-20T15:14:00.000Z", finishedAt: "2026-08-20T15:18:00.000Z",
    }],
  },
  {
    piece: {
      id: "004", title: "The meeting that should have been a decision.",
      concept: "Most recurring meetings are a decision nobody's willing to make out loud.",
      narration: [
        "This meeting exists because a decision is overdue.",
        "Everyone knows it. Nobody says it.",
        "Cancel the meeting. Make the call.",
      ],
      captionIG: "The meeting that should have been a decision.",
      captionLI: "A recurring meeting is often a decision on autopilot avoidance.",
      sceneBasename: "scene-004.html", renderable: true, targetSeconds: 30,
      thumbRel: thumb("004"), recommendedRel: null, hasThumbnailFirst: false,
    },
    postedAt: null,
    provenance: { audioKind: null, approved: false, approvalStale: false, postingAllowed: false },
    uploads: [],
    jobs: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO + MEDIA ACTION MANIFEST (mandate 23). The canonical, machine-checkable registry of every
// interactive Content Studio / media control. Breakbot/CI fails if a Studio/media control ships without a
// registered action ID + acceptance scenario here (see studio-manifest.test.ts + the media journeys).
// ─────────────────────────────────────────────────────────────────────────────
export interface StudioActionSpec {
  id: string;
  surface: string;
  precondition: string;
  goal: string;
  expectedUi: string;
  expectedPersisted: string;
  queueCount: string;
  audit: string;
  sideEffect: "none" | "render" | "provider";  // render/provider side-effect allowance
  deterministicTest: string;
  syntheticJourney: string;
  domMarker: string | null;
}

export const STUDIO_ACTIONS: StudioActionSpec[] = [
  { id: "studio.open", surface: "/company/[leadId]", precondition: "a company with video work", goal: "open the video workspace", expectedUi: "Full Package / studio view", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: null },
  { id: "studio.filter-needs-narration", surface: "/queue/voiceover", precondition: "Today", goal: "see companies needing narration", expectedUi: "needs-narration list; count==list", queueCount: "count equals list", expectedPersisted: "none", audit: "none", sideEffect: "none", deterministicTest: "breakbot-scheduled-journey", syntheticJourney: "media-goal", domMarker: "[data-queue-list]" },
  { id: "studio.filter-rendering", surface: "/queue/rendering", precondition: "Today", goal: "see rendering companies", expectedUi: "rendering list; count==list", queueCount: "count equals list", expectedPersisted: "none", audit: "none", sideEffect: "none", deterministicTest: "breakbot-scheduled-journey", syntheticJourney: "media-goal", domMarker: "[data-queue-list]" },
  { id: "studio.open-company", surface: "/company/[leadId]", precondition: "queue open", goal: "open a company's video", expectedUi: "package-aware detail", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-fullpackage-video]" },
  { id: "studio.preview-video", surface: "/company/[leadId]", precondition: "canonical video available", goal: "preview the current video (incl. pre-narration base)", expectedUi: "operator player opens with a video element", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-open]" },
  { id: "studio.preview-video-element", surface: "player", precondition: "preview open", goal: "watch the canonical video", expectedUi: "video element streams operator route", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-video]" },
  { id: "studio.close-preview", surface: "player", precondition: "preview open", goal: "close the player (X)", expectedUi: "player closes; focus returns; no state change", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-close]" },
  { id: "studio.back-preview", surface: "player", precondition: "preview open", goal: "go back from the player", expectedUi: "player closes to the workspace", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-back]" },
  { id: "studio.escape-preview", surface: "player", precondition: "preview open", goal: "close with Escape (desktop)", expectedUi: "player closes", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: null },
  { id: "studio.download", surface: "player", precondition: "canonical video available", goal: "download the completed video", expectedUi: "Blob download (no raw nav); correct filename", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-download]" },
  { id: "studio.upload-narration", surface: "/company/[leadId]", precondition: "needs narration", goal: "upload a voiceover", expectedUi: "upload accepted; company moves to Rendering", expectedPersisted: "upload + queued render job", queueCount: "needs-narration → rendering", audit: "none", sideEffect: "render", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: null },
  { id: "studio.observe-rendering", surface: "/company/[leadId]", precondition: "render queued/running", goal: "observe honest render status", expectedUi: "queued/rendering state; terminal failure never spins", expectedPersisted: "job status truth", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: null },
  { id: "studio.retry-failed-render", surface: "/company/[leadId]", precondition: "render failed (retryable)", goal: "retry a failed render", expectedUi: "retry offered; not an endless spinner", expectedPersisted: "re-queued job", queueCount: "unchanged", audit: "none", sideEffect: "render", deterministicTest: "render-lifecycle.test", syntheticJourney: "media-goal", domMarker: null },
  { id: "studio.preview-completed", surface: "/company/[leadId]", precondition: "render ready", goal: "preview the finished canonical video", expectedUi: "operator player shows the ready artifact", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-open]" },
  { id: "studio.reject", surface: "/company/[leadId]", precondition: "any", goal: "reject / stop future outreach", expectedUi: "reason panel → confirm; leaves pipeline", expectedPersisted: "pipelineStage Rejected", queueCount: "count decremented", audit: "lead.rejected", sideEffect: "none", deterministicTest: "breakbot-reject-journey", syntheticJourney: "media-goal", domMarker: "[data-reject-control]" },
  { id: "studio.return-today", surface: "/company/[leadId]", precondition: "detail open", goal: "return to Today", expectedUi: "Today loads", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-nav-close]" },
  { id: "studio.missing-artifact", surface: "/company/[leadId]", precondition: "video artifact missing", goal: "understand the video is unavailable", expectedUi: "preview offered as unavailable + reason (not a broken player)", expectedPersisted: "none", queueCount: "unchanged", audit: "none", sideEffect: "none", deterministicTest: "breakbot-media-journey", syntheticJourney: "media-goal", domMarker: "[data-operator-preview-unavailable]" },
];

export function studioActionIds(): string[] { return STUDIO_ACTIONS.map((a) => a.id); }

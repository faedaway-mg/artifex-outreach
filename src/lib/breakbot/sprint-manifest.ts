// NARRATION SPRINT ACTION MANIFEST (mandate 28). Canonical registry of every Sprint control + server
// mutation. CI fails for an unregistered visible control, a registered marker no longer rendered, or a
// mutation missing its side-effect / provider-zero assertion.
export interface SprintActionSpec {
  id: string;
  surface: string;
  goal: string;
  persisted: string;          // persisted-state effect ("none" for read-only)
  audit: string;
  queueCount: string;
  provider: "none";           // the Sprint NEVER contacts an email provider
  deterministicTest: string;
  domMarker: string | null;
}

export const SPRINT_ACTIONS: SprintActionSpec[] = [
  { id: "sprint.start", surface: "/content-studio/outreach-reviews/sprint", goal: "start a narration sprint", persisted: "creates a session", audit: "none", queueCount: "readyCount unchanged", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-start]" },
  { id: "sprint.batch", surface: "sprint landing", goal: "choose batch size (10/25/50/all)", persisted: "session order sized", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-batch]" },
  { id: "sprint.screen", surface: "sprint/[sessionId]/[leadId]", goal: "one business per screen", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-screen]" },
  { id: "sprint.why", surface: "sprint screen", goal: "understand why this business qualified", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-why]" },
  { id: "sprint.recipient", surface: "sprint screen", goal: "see verified recipient status", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-recipient]" },
  { id: "sprint.copy", surface: "sprint screen", goal: "copy the exact current narration", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-copy]" },
  { id: "sprint.upload", surface: "sprint screen", goal: "upload the recording", persisted: "audio artifact + ONE render job bound to the revision/input version", audit: "append-only upload event", queueCount: "item complete → advance", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-upload]" },
  { id: "sprint.transcript", surface: "sprint screen", goal: "see the recording verification result", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-transcript]" },
  { id: "sprint.stay", surface: "sprint screen", goal: "stay instead of auto-advancing", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-stay]" },
  { id: "sprint.next", surface: "sprint screen", goal: "advance now to the next business", persisted: "none", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-next]" },
  { id: "sprint.skip", surface: "sprint screen", goal: "skip for now (session-local, stays eligible)", persisted: "session skip; lead unchanged globally", audit: "none", queueCount: "remaining unchanged", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-skip]" },
  { id: "sprint.attention", surface: "sprint screen", goal: "report an evidence problem → Needs Attention", persisted: "removed from READY_FOR_NARRATION", audit: "none", queueCount: "remaining decremented", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-attention]" },
  { id: "sprint.reject", surface: "sprint screen", goal: "canonically reject (stop future outreach)", persisted: "pipelineStage Rejected (exactly once)", audit: "lead.rejected", queueCount: "remaining decremented", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-reject]" },
  { id: "sprint.progress", surface: "sprint screen", goal: "see position + progress", persisted: "none", audit: "none", queueCount: "completed/skipped/rejected/attention/remaining", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-progress]" },
  { id: "sprint.exit", surface: "sprint screen", goal: "exit the sprint (resumable)", persisted: "session exitedAt; position preserved", audit: "none", queueCount: "n/a", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-exit]" },
  { id: "sprint.summary", surface: "sprint end", goal: "truthful final summary", persisted: "none", audit: "none", queueCount: "final counts", provider: "none", deterministicTest: "breakbot-sprint-journey", domMarker: "[data-sprint-summary]" },
];

export function sprintActionIds(): string[] { return SPRINT_ACTIONS.map((a) => a.id); }

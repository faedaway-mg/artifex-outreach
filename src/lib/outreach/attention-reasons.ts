// Pure, client-safe Needs Attention reason model (mandate 24). Kept free of server imports so the client
// AttentionCard can import the reason codes + valid-action map without pulling in the server snapshot module.
export type NeedsAttentionReason =
  | "prior-sent-video-undelivered"  // prior email sent; completed video not delivered → prepare follow-up / hold
  | "missing-evidence"
  | "invalid-content"               // placeholder/test content
  | "missing-recipient"
  | "missing-narration"
  | "failed-render-retryable"
  | "failed-render-terminal"
  | "missing-artifact"
  | "stale-package"
  | "invalid-share"
  | "lineage-conflict"
  | "suppression-or-rejection"
  | "unknown";

// Each reason maps to the EXACT set of safe recovery actions the UI may offer for it.
export const NEEDS_ATTENTION_ACTIONS: Record<NeedsAttentionReason, string[]> = {
  "prior-sent-video-undelivered": ["prepare-video-follow-up", "hold", "reject"],
  "missing-evidence": ["reject"],
  "invalid-content": ["reject"],
  "missing-recipient": ["reject"],
  "missing-narration": ["reject"],
  "failed-render-retryable": ["retry-render", "hold", "reject"],
  "failed-render-terminal": ["hold", "reject"],
  "missing-artifact": ["hold", "reject"],
  "stale-package": ["hold", "reject"],
  "invalid-share": ["hold", "reject"],
  "lineage-conflict": ["hold", "reject"],
  "suppression-or-rejection": [],
  "unknown": ["hold", "reject"],
};

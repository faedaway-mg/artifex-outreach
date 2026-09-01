// ─────────────────────────────────────────────────────────────────────────────
// Canonical Today ↔ Content Studio client-video routing (sections F/G).
//
// A client video's Content Studio project id is DETERMINISTIC from the business's lead id
// (client-<leadId>) — the same key the client/prepare route registers. Today and Content
// Studio therefore agree on identity WITHOUT business-name matching, and a Today task deep-
// links to its exact project. The obsolete /work/video recording carousel redirects here.
// ─────────────────────────────────────────────────────────────────────────────

/** The stable Content Studio piece id for a business's client review video. Never name-based. */
export function clientVideoPieceId(leadId: string): string {
  return `client-${leadId}`;
}

/** Inverse: recover the lead id from a client piece id (or null if it isn't a client piece). */
export function leadIdFromClientPiece(pieceId: string): string | null {
  return pieceId.startsWith("client-") ? pieceId.slice("client-".length) : null;
}

/**
 * Where the retired video work path sends the operator: the Content Studio Client Videos section.
 * A single scoped lead deep-links to its exact project; otherwise the list opens. `from=today`
 * preserves an origin so Back returns to Today. This is the ONLY destination — the carousel is gone.
 */
export function videoWorkRedirect(ids: string[]): string {
  const qp = new URLSearchParams({ section: "client", from: "today" });
  const clean = ids.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 1) qp.set("lead", clean[0]);
  return `/content-studio?${qp.toString()}`;
}

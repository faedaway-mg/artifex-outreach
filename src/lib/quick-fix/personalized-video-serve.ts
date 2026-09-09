// ─────────────────────────────────────────────────────────────────────────────
// PERSONALIZED VIDEO — SERVE RESOLVER. The single gate the customer-facing served
// routes (mp4 / poster / captions) go through. It:
//   • resolves the offer by share token OR stable offerId,
//   • enforces the SAME access model as the offer page (operator session, OR the
//     offer's own unrevoked share token AND an approved offer),
//   • recomputes readiness against the CURRENT evidence/narration/render so a STALE
//     or superseded render is NEVER served as current,
//   • requires a DURABLE ArtifactStore key (a local-only render can never be served).
// It exposes only the resolved record + durable keys — never a raw storage URL, a
// filesystem path, or any secret.
// ─────────────────────────────────────────────────────────────────────────────
import * as store from "./store";
import { buildEvidencePackage } from "./evidence-package";
import { evidenceVersion } from "./evidence-truth";
import {
  personalizedVideoReadiness,
  PV_NARRATION_VERSION,
  PV_RENDER_VERSION,
  type PersonalizedDiagnosticVideoRecord,
  type PersonalizedVideoStatus,
} from "./personalized-video";

export interface PersonalizedVideoServeResolution {
  ok: boolean;
  httpStatus: number;
  reason: string;
  status: PersonalizedVideoStatus | null;
  record: PersonalizedDiagnosticVideoRecord | null;
  offerId: string | null;
}

/**
 * Resolve whether an offer's personalized video may be served for `seg`, and return
 * the READY record when it may. `operator` short-circuits the customer gate (operator
 * preview). Never serves anything that is not READY + durable + bound to current truth.
 */
export async function resolvePersonalizedVideoForServe(
  seg: string,
  opts: { operator: boolean },
): Promise<PersonalizedVideoServeResolution> {
  const byToken = await store.getOfferByShareToken(seg);
  const offer = byToken ?? (await store.getOffer(seg));
  if (!offer) {
    return { ok: false, httpStatus: 404, reason: "offer-not-found", status: null, record: null, offerId: null };
  }

  if (!opts.operator) {
    // Customer path: must be the offer's own (unrevoked) share token AND approved.
    const viaShareToken = !!byToken && !byToken.shareRevoked;
    const approved = offer.approvalStatus === "approved";
    if (!viaShareToken || !approved) {
      return { ok: false, httpStatus: 404, reason: "not-public", status: null, record: null, offerId: offer.offerId };
    }
  }

  const record = await store.getPersonalizedVideo(offer.offerId);
  if (!record) {
    return { ok: false, httpStatus: 404, reason: "no-record", status: "NOT_GENERATED", record: null, offerId: offer.offerId };
  }

  const pkg = await buildEvidencePackage(offer);
  const status = personalizedVideoReadiness(record, {
    offerVersion: offer.offerVersion,
    evidenceVersion: evidenceVersion(pkg),
    narrationVersion: PV_NARRATION_VERSION,
    renderVersion: PV_RENDER_VERSION,
  });

  if (status !== "READY") {
    // 409 Conflict: an asset exists but is not the current coherent render.
    return { ok: false, httpStatus: 409, reason: `not-ready:${status}`, status, record, offerId: offer.offerId };
  }

  return { ok: true, httpStatus: 200, reason: "ready", status, record, offerId: offer.offerId };
}

import { describe, it, expect } from "vitest";
import { buildCard, buildExplainerGallery } from "./explainer-gallery";
import type { ResolvedExplainer } from "../quick-fix/explainer-library";
import type { MediaQaSnapshot, ExplainerReview } from "./explainer-qa-store";

function resolved(over: Partial<ResolvedExplainer> = {}): ResolvedExplainer {
  return {
    scope: "cta-conversion", title: "Conversion", source: "matt-bound", voice: "matt",
    servedMp4Url: "/api/quick-fix/trust-video/cta-conversion", posterUrl: "/poster", captionsUrl: null, captionsVerified: false,
    orientation: "landscape", width: 1920, height: 1080, durationSeconds: 70.9, audioSeconds: 65.8,
    visualMaster: "cta-conversion-v2", voiceoverId: "vo_x", assetRevision: "matt:key1:t1", updatedAt: "t1",
    ...over,
  };
}
function snap(over: Partial<MediaQaSnapshot> = {}): MediaQaSnapshot {
  return {
    scope: "cta-conversion", assetRevision: "matt:key1:t1", status: "PASS", aliveThroughPct: 100,
    orientation: "landscape", aspectRatio: "16:9", durationSeconds: 70.9, findings: [], timeline: [],
    probedAt: "t1", source: "local", ...over,
  };
}
function review(over: Partial<ExplainerReview> = {}): ExplainerReview {
  return { scope: "cta-conversion", assetRevision: "matt:key1:t1", verdict: "reviewed", actor: "op", reviewedAt: "t1", ...over };
}

describe("explainer gallery card status", () => {
  it("PASS media + valid review → PASS, no longer needs review", () => {
    const c = buildCard(resolved({ captionsVerified: true }), snap(), review());
    expect(c.status).toBe("PASS");
    expect(c.needsHumanReview).toBe(false);
    expect(c.humanReview?.valid).toBe(true);
  });

  it("PASS media without a review → needs human review", () => {
    const c = buildCard(resolved({ captionsVerified: true }), snap(), null);
    expect(c.status).toBe("PASS");
    expect(c.needsHumanReview).toBe(true);
  });

  it("a human 'reviewed' can NEVER override a Breakbot BLOCKED (§30)", () => {
    const c = buildCard(resolved(), snap({ status: "BLOCKED", findings: [{ kind: "media.blankTimeline", severity: "BLOCKER", detail: "blank after 5%" }] }), review());
    expect(c.status).toBe("BLOCKED");
    // review is present but the badge stays BLOCKED
    expect(c.humanReview?.verdict).toBe("reviewed");
  });

  it("a review made against an OLD revision does not count (resets on asset change)", () => {
    const c = buildCard(resolved({ assetRevision: "matt:key2:t2" }), snap({ assetRevision: "matt:key2:t2" }), review({ assetRevision: "matt:key1:t1" }));
    expect(c.humanReview?.valid).toBe(false);
    expect(c.needsHumanReview).toBe(true);
  });

  it("a media snapshot from an OLD revision reads STALE, not PASS", () => {
    const c = buildCard(resolved({ assetRevision: "matt:key2:t2", captionsVerified: true }), snap({ assetRevision: "matt:key1:t1" }), null);
    expect(c.status).toBe("STALE");
    expect(c.mediaState).toBe("STALE");
  });

  it("a MISSING scope is retained with MISSING status, never dropped (§9)", () => {
    const c = buildCard(resolved({ source: "missing", servedMp4Url: null, orientation: null, assetRevision: null }), null, null);
    expect(c.status).toBe("MISSING");
  });

  it("no snapshot for a present asset → NOT_RUN", () => {
    const c = buildCard(resolved({ captionsVerified: true }), null, null);
    expect(c.status).toBe("NOT_RUN");
    expect(c.mediaState).toBe("NOT_RUN");
  });

  it("unverified captions downgrade an otherwise-PASS card to WARNING", () => {
    const c = buildCard(resolved({ captionsVerified: false }), snap(), null);
    expect(c.status).toBe("WARNING");
  });
});

describe("explainer gallery summary + coverage", () => {
  it("counts statuses and marks coverage incomplete when any scope is missing/blocked/stale", () => {
    const rs: ResolvedExplainer[] = [
      resolved({ scope: "cta-conversion", assetRevision: "a1", captionsVerified: true }),
      resolved({ scope: "accessibility", source: "missing", servedMp4Url: null, orientation: null, assetRevision: null }),
    ];
    const model = buildExplainerGallery(rs, { "cta-conversion": snap({ scope: "cta-conversion", assetRevision: "a1" }) }, {});
    expect(model.summary.total).toBe(2);
    expect(model.summary.missing).toBe(1);
    expect(model.coverageComplete).toBe(false);
  });

  it("coverage complete only when every scope is present + healthy", () => {
    const rs = [resolved({ scope: "cta-conversion", assetRevision: "a1", captionsVerified: true })];
    const model = buildExplainerGallery(rs, { "cta-conversion": snap({ scope: "cta-conversion", assetRevision: "a1" }) }, { "cta-conversion": review({ scope: "cta-conversion", assetRevision: "a1" }) });
    expect(model.coverageComplete).toBe(true);
    expect(model.summary.reviewed).toBe(1);
  });
});

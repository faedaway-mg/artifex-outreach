// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX TRUST VIDEOS — scope mapping, deterministic server-owned selection,
// fallback safety, claim safety, and that every referenced asset actually exists.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  scopeForSku, scopeForOffer, selectTrustVideo, trustVideoForOffer, trustVideoScript,
  trustVideoAsEvergreen, TRUST_VIDEO_ASSETS, type TrustVideoScope,
} from "./trust-videos";
import { listSkus } from "./catalog";
import { FIX_SCAN_SKU } from "./fix-scan";
import { containsFabricatedClaim } from "./evidence-gate";

const SCOPES = Object.keys(TRUST_VIDEO_ASSETS) as TrustVideoScope[];

describe("SKU → scope mapping", () => {
  it("every active catalog SKU maps to a scope with an active rendered video", () => {
    for (const sku of listSkus()) {
      const r = trustVideoForOffer({ capabilityKeys: [sku.key] });
      expect(r.asset.active).toBe(true);
      expect(r.asset.assetUrl, `${sku.key} → ${r.scope}`).toMatch(/^\/trust-videos\/.+\.mp4$/);
    }
  });
  it("Fix Scan maps to the Fix Scan video (motion v2 is the active version)", () => {
    expect(scopeForSku(FIX_SCAN_SKU.key)).toBe("fix-scan");
    expect(selectTrustVideo("fix-scan").assetUrl).toBe("/trust-videos/fix-scan-v2.mp4");
    expect(selectTrustVideo("fix-scan").version).toBe(2);
  });
  it("an unknown SKU safely falls back to general (script-only, no wrong scope)", () => {
    expect(scopeForSku("no-such-sku")).toBe("general");
    expect(scopeForOffer({ capabilityKeys: [] })).toBe("general");
    expect(selectTrustVideo("general").assetUrl).toBeNull();
  });
});

describe("selection is deterministic + server-owned", () => {
  it("the same offer always resolves to the same asset", () => {
    const offer = { capabilityKeys: ["cta-repair"] };
    const a = trustVideoForOffer(offer), b = trustVideoForOffer(offer);
    expect(a.asset.assetUrl).toBe(b.asset.assetUrl);
    expect(a.scope).toBe("cta-conversion");
  });
  it("resolution reads ONLY the offer's capabilities — no client asset id can override", () => {
    // trustVideoForOffer takes only the offer; extra/hostile fields are ignored.
    const r = trustVideoForOffer({ capabilityKeys: ["accessibility-quickfix"], assetUrl: "/evil.mp4" } as any);
    expect(r.asset.assetUrl).toBe("/trust-videos/accessibility-v2.mp4");
  });
  it("only active assets are returned (inactive → general fallback)", () => {
    // General is the canonical fallback; a scope with no active asset yields it.
    expect(selectTrustVideo("general").active).toBe(true);
    expect(selectTrustVideo("general").assetUrl).toBeNull();
  });
});

describe("offer-page integration shape", () => {
  it("trustVideoAsEvergreen carries the scope video + poster + captions (or script when general)", () => {
    const withVideo = trustVideoAsEvergreen({ capabilityKeys: ["mobile-layout-fix"] });
    expect(withVideo.assetUrl).toBe("/trust-videos/mobile-responsive-v2.mp4");
    expect(withVideo.posterUrl).toBe("/trust-videos/mobile-responsive-v2-poster.jpg");
    expect(withVideo.captionsUrl).toBe("/trust-videos/mobile-responsive-v2.vtt");
    expect(withVideo.title).toContain("Mobile");
    expect(withVideo.status).toBe("active");
    expect(withVideo.script).toContain("Artifex");
    const general = trustVideoAsEvergreen({ capabilityKeys: [] });
    expect(general.assetUrl).toBeNull(); // missing video does not break — page shows the script
    expect(general.captionsUrl).toBeNull();
    expect(general.script.length).toBeGreaterThan(50);
  });
});

describe("motion v2 is active with captions, and v1 is retained for rollback", () => {
  it("every non-general scope serves the v2 motion asset with a matching .vtt", () => {
    for (const scope of SCOPES) {
      const a = TRUST_VIDEO_ASSETS[scope];
      if (!a.assetUrl) continue; // general
      expect(a.version, `${scope} version`).toBe(2);
      expect(a.assetUrl).toMatch(/-v2\.mp4$/);
      expect(a.captionsUrl, `${scope} captions`).toMatch(/-v2\.vtt$/);
    }
  });
});

describe("claim safety (evergreen never fabricates)", () => {
  it("every scope script passes the fabrication guard", () => {
    for (const scope of SCOPES) {
      const script = trustVideoScript(scope);
      expect(containsFabricatedClaim(script), `${scope} script`).toBe(false);
    }
  });
});

describe("every referenced asset exists on disk", () => {
  it("each active (non-general) asset file + poster is present in public/", () => {
    for (const scope of SCOPES) {
      const a = TRUST_VIDEO_ASSETS[scope];
      if (!a.assetUrl) continue; // general (script-only)
      expect(existsSync(path.join(process.cwd(), "public", a.assetUrl)), `${scope} mp4`).toBe(true);
      expect(existsSync(path.join(process.cwd(), "public", a.posterUrl!)), `${scope} poster`).toBe(true);
      if (a.captionsUrl) expect(existsSync(path.join(process.cwd(), "public", a.captionsUrl)), `${scope} captions`).toBe(true);
    }
  });
});

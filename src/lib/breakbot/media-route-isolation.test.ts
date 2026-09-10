import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// EXECUTABLE regression for the escaped defect "media-route-login-redirect" (§11/§29):
// the customer-facing trust-video + personalized-video media routes MUST stay in the
// middleware public allowlist, or the offer page's videos 307→/login and cannot play.
// This asserts the allowlist patterns are present in the middleware; removing either
// pattern (the recurrence) fails this test and blocks the release.
const MIDDLEWARE = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

describe("media-route isolation (§11 escaped-defect regression)", () => {
  it("keeps the trust-video media route public", () => {
    expect(MIDDLEWARE).toContain('pathname.startsWith("/api/quick-fix/trust-video/")');
  });

  it("keeps the personalized-video media route public (capability enforced in-handler)", () => {
    // The personalized-video allowlist is a scoped regex ending in the `(?:\/|$)` boundary —
    // this substring uniquely identifies that allowlist entry and is robust to reformatting.
    expect(MIDDLEWARE).toContain("personalized-video(?:");
  });

  it("keeps the public offer + trust-videos static asset paths public", () => {
    expect(MIDDLEWARE).toContain('pathname.startsWith("/offer/")');
    expect(MIDDLEWARE).toContain('pathname.startsWith("/trust-videos/")');
  });
});

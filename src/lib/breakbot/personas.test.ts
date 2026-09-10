import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PERSONAS, JOURNEYS, journeyRoutes, MOBILE_WIDTHS, type JourneyAction } from "./personas";

// Enumerate every real Next.js page route, normalising route groups `(x)` away and
// dynamic `[param]` → `:param`, so a journey route can be checked against reality.
function appRoutes(): Set<string> {
  const APP = join(process.cwd(), "src/app");
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry === "page.tsx") {
        const rel = relative(APP, dir);
        const parts = rel.split("/").filter((p) => p && !(p.startsWith("(") && p.endsWith(")")));
        const norm = parts.map((p) => (p.startsWith("[") && p.endsWith("]") ? `:${p.slice(1, -1)}` : p));
        routes.add("/" + norm.join("/") === "/" ? "/" : "/" + norm.join("/"));
      }
    }
  };
  walk(APP);
  routes.add("/"); // the (app) index
  return routes;
}

const SAFE_ACTIONS: JourneyAction[] = ["navigate", "click", "type", "scroll", "playMedia", "back", "openDrawer", "expectVisible", "expectText", "expectAbsent", "expectMediaHealthy"];

describe("synthetic personas + journeys (§3–§13)", () => {
  it("every journey references a defined persona", () => {
    for (const j of JOURNEYS) expect(PERSONAS[j.persona], `journey ${j.id} → unknown persona ${j.persona}`).toBeDefined();
  });

  it("all six mandate personas exist", () => {
    for (const id of ["operator", "prospect", "quick-fix-customer", "social-content-creator", "fulfillment-operator", "mobile-user"]) {
      expect(PERSONAS[id as keyof typeof PERSONAS], `missing persona ${id}`).toBeDefined();
    }
  });

  it("every journey navigate-route resolves to a real app page", () => {
    const routes = appRoutes();
    for (const r of journeyRoutes()) {
      // Normalise a journey's `:param` route against the discovered `:param` routes.
      expect(routes.has(r), `journey route ${r} does not resolve to a real page`).toBe(true);
    }
  });

  it("every journey is structurally side-effect-free (only safe actions)", () => {
    for (const j of JOURNEYS) {
      expect(j.sideEffectFree).toBe(true);
      for (const s of j.steps) expect(SAFE_ACTIONS.includes(s.action), `journey ${j.id} uses unsafe action ${s.action}`).toBe(true);
    }
  });

  it("the Content Studio journey asserts the hidden machinery is absent (§10)", () => {
    const cs = JOURNEYS.find((j) => j.id === "content-studio-zero-touch")!;
    const absent = cs.steps.filter((s) => s.action === "expectAbsent").map((s) => s.target);
    for (const control of ["narration-script-editor", "copy-narration", "upload-voiceover", "generate-voiceover-button", "generate-video-button"]) {
      expect(absent, `Content Studio journey should assert ${control} absent`).toContain(control);
    }
  });

  it("the prospect journey plays BOTH videos and requires them healthy through the full runtime (§5/§6)", () => {
    const p = JOURNEYS.find((j) => j.id === "prospect-offer-experience")!;
    const healthy = p.steps.filter((s) => s.action === "expectMediaHealthy").map((s) => s.target);
    expect(healthy).toContain("personalized-video");
    expect(healthy).toContain("trust-video");
  });

  it("mobile journeys cover the mandate breakpoints and critical surfaces (§13)", () => {
    expect([...MOBILE_WIDTHS]).toEqual([320, 375, 390, 430]);
    const mobile = JOURNEYS.filter((j) => j.viewport === "mobile");
    const surfaces = mobile.map((j) => j.entryRoute);
    expect(surfaces).toContain("/offer/:offerId");
    expect(surfaces).toContain("/offer/:offerId/portal");
    expect(surfaces).toContain("/content-studio");
    expect(surfaces).toContain("/launch/explainers");
  });

  it("three customer-portal scenarios exist (§11 A/B/C)", () => {
    for (const id of ["portal-simple-success", "portal-waiting-for-access", "portal-scope-complication"]) {
      expect(JOURNEYS.find((j) => j.id === id), `missing portal journey ${id}`).toBeDefined();
    }
  });
});

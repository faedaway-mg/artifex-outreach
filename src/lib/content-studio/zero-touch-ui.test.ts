import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIDDEN_MACHINERY_CONTROLS } from "./zero-touch";

// EXECUTABLE regression for the escaped defect "content-studio-exposes-machinery" (§11/§14/§22).
// The zero-touch NORMAL surface must show only brief + Generate + finished video, and must mount
// the full workspace (ContentStudioClient) ONLY behind the Advanced toggle — so the machinery is
// genuinely absent from the normal DOM, not merely hidden. This guards the source so a regression
// that puts machinery back into the normal view fails the release.
const SRC = readFileSync(join(process.cwd(), "src/components/content-studio/ZeroTouchStudio.tsx"), "utf8");

describe("content-studio zero-touch normal view (§14 machinery hidden)", () => {
  it("exposes the curated idea-feed controls (idea in → Generate → finished + download)", () => {
    for (const id of ["cs-idea-input", "cs-generate-idea", "cs-idea-brief", "cs-generate-button", "cs-finished-video", "cs-download", "cs-advanced-toggle", "content-studio-zero-touch", "cs-capacity-card"]) {
      expect(SRC).toContain(id);
    }
  });

  it("has NO per-card freeform brief textarea (mandate D §1/§23 — the system generated the idea)", () => {
    // The operator must not re-describe the system's own idea: no per-card textarea, and no
    // cs-brief-input anywhere. The ONLY creative field is the single top-level idea input.
    expect(SRC).not.toContain("cs-brief-input");
    // A <textarea> must not appear on an idea card (the top idea control is a single-line <input>).
    expect(SRC).not.toMatch(/<textarea/);
  });

  it("mounts the full workspace ONLY inside the advanced branch", () => {
    // ContentStudioClient must be referenced only under `if (advanced)`.
    const advancedIdx = SRC.indexOf("if (advanced)");
    const clientIdx = SRC.indexOf("<ContentStudioClient");
    expect(advancedIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(advancedIdx);
  });

  it("does not render machinery panels/controls in the normal surface", () => {
    // The normal surface must not import/render the machinery components (they live in
    // ContentStudioClient, mounted only in Advanced). Check code identifiers, not prose —
    // strip comments so the descriptive header (which NAMES the excluded controls) doesn't
    // false-positive.
    const code = SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const banned of ["VoiceoverPanel", "UploadPanel", "CaptionPanel", "import { VoiceoverPanel"]) {
      expect(code.includes(banned), `normal view must not reference ${banned}`).toBe(false);
    }
  });

  it("HIDDEN_MACHINERY_CONTROLS is the shared source of truth for what stays out of the normal view", () => {
    expect(HIDDEN_MACHINERY_CONTROLS).toContain("narration-script-editor");
    expect(HIDDEN_MACHINERY_CONTROLS).toContain("generate-voiceover-button");
    expect(HIDDEN_MACHINERY_CONTROLS).toContain("generate-video-button");
  });
});

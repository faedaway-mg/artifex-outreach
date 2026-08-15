// ─────────────────────────────────────────────────────────────────────────────
// Quick Review voice pipeline — the provider boundary, narration script, and scene timing. Proves the
// LUCAS_MANUAL_BRIDGE contract: everything except the voice is automated, the operator gets one clean
// copy block, an imported audio file satisfies the boundary, and scene timing rescales to the real
// audio with NO manual timestamps. No provider ever substitutes a different voice.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { ManualLucasProvider, ProgrammaticLucasProvider, importNarrationAudio } from "./voice";
import { buildNarrationScript, withinDuration, CALIBRATION_WPM } from "./narration";
import { planSceneTiming, isContiguous } from "./timing";
import type { QuickReview } from "../outreach/quick-review";
import type { ReviewFinding, StartingPoint } from "../outreach/review-evidence";
import type { FindingPresentation } from "../outreach/review-hooks";

// A realistic 3-finding Urban Americana review shape (matches the M3.1 acceptance output).
const f = (id: string, topic: ReviewFinding["topic"], observation: string): ReviewFinding => ({
  id, category: "Customer Acquisition", topic, title: `T ${id}`, observation,
  evidence: { confidence: "Observed", sourceType: "website", sourceUrl: "https://urbanamericana.com", displayLabel: "urbanamericana.com · Section", basis: ["b"], observedAt: null, screenshotRef: null },
  whyItMatters: "It affects customers.", whatWedDo: "Audit the site.", score: 1,
});
const pres = (findingId: string, textHook: string): FindingPresentation => ({ findingId, textHook, title: "T", visualHook: { type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null } });
const start: StartingPoint = { sourceFindingId: "f2", label: "Catalog discovery & navigation pass", intervention: "Audit the catalog.", why: "A large catalog is hard to shop, so we'd start here.", proofReference: "urbanamericana.com · Catalog & navigation" };
const review: QuickReview = {
  businessName: "Urban Americana", industryLabel: "Vintage marketplace", location: "Long Beach, CA", website: "urbanamericana.com", brand: null,
  findings: [
    f("f1", "mobile", "On mobile the primary action is off-screen below three stacked banners."),
    f("f2", "catalog", "The storefront exposes 19 customer-facing collections, but no filtering to narrow them."),
    f("f3", "reviews", "The business has 950+ reviews at 4.8★ externally, but none are surfaced on the site."),
  ],
  presentations: [pres("f1", "The first mobile impression is doing too much work."), pres("f2", "19 ways in. Almost no way to narrow them."), pres("f3", "950+ customers already did the hard part.")],
  openingHook: "950+ customers already did the hard part.",
  start, status: "SENDABLE", observations: [], whyItMatters: "", recommendations: [], ready: true,
};

describe("narration script — VEED-ready one-block, segmented, TTS-clean", () => {
  const script = buildNarrationScript(review);
  it("has opening + one segment per finding + close, in order", () => {
    expect(script.segments.map((s) => s.id)).toEqual(["opening", "finding-01", "finding-02", "finding-03", "close"]);
    expect(script.segments[0].role).toBe("opening");
    expect(script.segments.at(-1)!.role).toBe("close");
  });
  it("is one clean copy block the operator can paste at once (blank-line separated)", () => {
    expect(script.copyBlock.split("\n\n")).toHaveLength(script.segments.length);
    expect(script.copyBlock).toContain("Urban Americana");
  });
  it("normalizes for speech: no URLs, ★ spoken as 'stars', sentence-final punctuation", () => {
    expect(script.copyBlock).not.toMatch(/https?:\/\//);
    expect(script.copyBlock).not.toContain("★");
    expect(script.copyBlock).toMatch(/4\.8 stars/);
    for (const s of script.segments) expect(s.text).toMatch(/[.!?…]$/);
  });
  it("estimates a duration in the review-video window and can target 45/60/75s", () => {
    const secs = script.estDurationSeconds();
    expect(secs).toBeGreaterThan(20);
    expect(secs).toBeLessThan(90);
    expect(withinDuration(script, 45, 25)).toBe(true); // fits a review-video window at the Lucas calibration
    expect(CALIBRATION_WPM).toBeGreaterThan(0);
  });
});

describe("voice provider boundary — manual Lucas, no silent substitution", () => {
  const script = buildNarrationScript(review);
  it("ManualLucasProvider returns VOICE_REQUIRED with the copy block and the Lucas steps", async () => {
    const r = await new ManualLucasProvider().generate(script);
    expect(r.status).toBe("voice-required");
    if (r.status !== "voice-required") return;
    expect(r.voice).toBe("Lucas");
    expect(r.copyBlock).toBe(script.copyBlock);
    expect(r.instructions.join(" ")).toMatch(/Lucas/);
    expect(r.instructions.join(" ")).toMatch(/paste/i);
    expect(r.targetSeconds).toBeGreaterThan(0);
  });
  it("an imported audio file satisfies the boundary and names its voice", () => {
    const audio = importNarrationAudio({ file: "/tmp/lucas.mp3", durationSeconds: 58.4, voice: "Lucas", provider: "manual-veed-lucas" });
    expect(audio.voice).toBe("Lucas");
    expect(audio.durationSeconds).toBeCloseTo(58.4);
    expect(audio.provider).toBe("manual-veed-lucas");
  });
  it("fails safely on a non-audio file, a bad duration, or a missing voice — never guesses", () => {
    expect(() => importNarrationAudio({ file: "notes.txt", durationSeconds: 10, voice: "Lucas" })).toThrow(/audio/i);
    expect(() => importNarrationAudio({ file: "x.mp3", durationSeconds: 0, voice: "Lucas" })).toThrow(/duration/i);
    expect(() => importNarrationAudio({ file: "x.mp3", durationSeconds: 10, voice: "" })).toThrow(/voice/i);
  });
  it("the programmatic provider is NOT silently available (throws until a verified API exists)", async () => {
    await expect(new ProgrammaticLucasProvider().generate()).rejects.toThrow(/programmatic/i);
  });
});

describe("scene timing — auto-aligns to the real audio, no manual timestamps", () => {
  const script = buildNarrationScript(review);
  it("tiles the whole audio contiguously and rescales to ANY narration length", () => {
    for (const dur of [45, 58.4, 72]) {
      const audio = importNarrationAudio({ file: "/tmp/lucas.mp3", durationSeconds: dur, voice: "Lucas" });
      const timings = planSceneTiming(script, audio, { leadSec: 0.3, tailSec: 0.5 });
      expect(timings).toHaveLength(script.segments.length);
      expect(timings[0].startSec).toBeCloseTo(0.3);        // lead respected
      expect(isContiguous(timings, audio, 0.5)).toBe(true); // no gaps/overlaps, ends at duration - tail
    }
  });
  it("longer segments get proportionally more time", () => {
    const audio = importNarrationAudio({ file: "/tmp/lucas.mp3", durationSeconds: 60, voice: "Lucas" });
    const timings = planSceneTiming(script, audio);
    const byId = Object.fromEntries(timings.map((t) => [t.segmentId, t]));
    const closeWords = script.segments.find((s) => s.id === "close")!.words;
    const f1Words = script.segments.find((s) => s.id === "finding-01")!.words;
    if (closeWords > f1Words) expect(byId["close"].durationSec).toBeGreaterThan(byId["finding-01"].durationSec);
  });
});

// MECHANISM PROOF — feed a REAL local audio asset through the boundary + timing. This is the existing
// Artifex content #001 narration (macOS `say` "Daniel", NOT Lucas) — it proves the import→duration→
// timing pipeline works end-to-end on a real file; the voice identity is labelled honestly.
describe("mechanism proof on a real local audio file (not Lucas)", () => {
  const AUDIO = "public/content/field-note-001/field-note-001-v4-audio-clean.mp4";
  const probe = (file: string): number | null => {
    try { return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]).toString().trim()); }
    catch { return null; }
  };
  it("imports a real audio file's true duration and produces a contiguous timing plan", () => {
    if (!existsSync(AUDIO)) return; // asset not present in this checkout — skip cleanly
    const dur = probe(AUDIO);
    if (dur == null) return; // no ffprobe available — skip cleanly
    const audio = importNarrationAudio({ file: AUDIO, durationSeconds: dur, voice: "Daniel (macOS say — NOT Lucas)", provider: "imported" });
    const script = buildNarrationScript(review);
    const timings = planSceneTiming(script, audio);
    expect(audio.durationSeconds).toBeGreaterThan(0);
    expect(isContiguous(timings, audio)).toBe(true);
  });
});

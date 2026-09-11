// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — MEDIA TIMELINE QA (Release Orchestrator mandate §6/§7/§8/§26).
//
// PURE assertion logic over SAMPLED-FRAME evidence + probe metadata. There is NO
// ffmpeg, NO network, and NO file I/O in this file. It receives a plain `MediaProbe`
// (frames already sampled across the timeline by scripts/… harness → see media-probe.ts)
// and decides PASS / WARNING / BLOCKED. Same split as visual-qa.ts: the harness owns
// ffprobe/ffmpeg + I/O; this module is a deterministic pure function → unit-testable
// with synthetic frame data, milliseconds fast, no external process.
//
// WHY THIS EXISTS — the escaped defect (§29). A rendered MP4 existing, an HTTP 200, a
// good FIRST frame, and correct duration metadata are ALL individually insufficient:
// the recent Matt cta-conversion explainer opened correctly and then went blank/static
// for the rest of a ~65s runtime, yet passed every one of those weak checks. The ONLY
// thing that catches that class is inspecting representative frames THROUGHOUT the
// entire runtime. That is this module's job.
//
// FAIL-CLOSED. Media QA never approves, renders, sends, or mutates. It READS the
// sampled evidence and REPORTS. A BLOCKER is the only thing that prevents PASS. Every
// finding names what was EXPECTED and what was OBSERVED so a repair is actionable.
// ─────────────────────────────────────────────────────────────────────────────

// Sample points across the runtime (§6). Chosen to catch a healthy opening masking a
// dead remainder: dense early (0/5/15) to characterise the "good part", then spread
// across the middle and tail (30/50/70/85/95/100) to expose blank/static stretches.
export const MEDIA_SAMPLE_PCTS = [0, 5, 15, 30, 50, 70, 85, 95, 100] as const;

export type MediaOrientation = "landscape" | "portrait";
export type MediaStatus = "PASS" | "WARNING" | "BLOCKED" | "NOT_RUN";

/** One sampled frame extracted from the video at a point on the timeline. */
export interface FrameSample {
  /** Fraction of the runtime this frame was taken at (0..100). */
  pct: number;
  /** Absolute timestamp (seconds) the frame was taken at. */
  atSeconds: number;
  /**
   * Encoded size of the extracted still (bytes). A blank / near-uniform frame
   * compresses to a small, near-constant size; a composed frame with typography,
   * device mocks, and motion compresses larger and VARIES frame to frame. Byte size
   * is a cheap, deterministic proxy for "is anything actually on screen here".
   */
  byteSize: number;
  /**
   * Optional 0..1 mean luma (0=black, 1=white). When provided, a frame that is almost
   * entirely one flat value corroborates "blank/background-only". Optional so the
   * cheap byte-size path works without decoding pixels.
   */
  meanLuma?: number | null;
}

export interface MediaProbe {
  /** Human label for the asset under test (scope / journey / file). */
  label: string;
  /** Encoded pixel dimensions from the container. */
  width: number | null;
  height: number | null;
  /** Total playable duration (seconds) per the container. */
  durationSeconds: number | null;
  /** True when the file carries at least one audio stream. */
  hasAudioStream: boolean;
  /** Audio stream duration (seconds) when known — the narration length to cover. */
  audioDurationSeconds?: number | null;
  /** Frames sampled across the timeline (see MEDIA_SAMPLE_PCTS). */
  samples: FrameSample[];

  // ── Expectations (the contract this asset must satisfy) ─────────────────────
  /** The format-contract orientation this asset MUST be (§8). Null → not enforced. */
  expectedOrientation?: MediaOrientation | null;
  /** Whether this class of asset is expected to animate (explainers/personalized do). */
  motionExpected?: boolean;
  /** Whether this asset is a narrated customer-facing video (audio is required). */
  narrated?: boolean;
  /** Minimum acceptable duration (seconds). Below this → too short to be real. */
  minDurationSeconds?: number | null;
}

export interface MediaFinding {
  kind: string;
  severity: "BLOCKER" | "WARNING";
  detail: string;
}

export interface MediaQaResult {
  label: string;
  status: MediaStatus;
  findings: MediaFinding[];
  /** Per-sample verdict — the evidence a human/repair loop needs (§26). */
  timeline: Array<{ pct: number; atSeconds: number; byteSize: number; alive: boolean }>;
  /** The last timeline point (%) that still had meaningful visual content. */
  aliveThroughPct: number;
  orientation: MediaOrientation | null;
  aspectRatio: string | null;
}

// ── Detection thresholds (deterministic, documented) ──────────────────────────
// A frame is "blank/dead" in ABSOLUTE terms when its encoded still is this small —
// a composed explainer frame at 1080p is tens of KB; a flat background is a few KB.
const ABSOLUTE_BLANK_BYTES = 9_000;
// Two adjacent sampled frames within this relative size delta are "not changing" (part
// of the same frozen/static run). Real animation moves sampled frame sizes far more —
// a busy composed scene and a simpler one differ by tens of percent, so legitimately
// simpler mid-scenes are NOT grouped with each other unless they are near-identical.
const FROZEN_REL = 0.05;
// The KEY signal: a single frozen run of near-identical frames covering this fraction
// of the sampled timeline. A healthy explainer's largest near-identical run is short
// (scenes keep changing); the blank-after-opening defect is one long frozen still that
// dominates the runtime. This — not "smaller than the peak" — is what distinguishes a
// dead render from a legitimately simpler scene, so healthy variation never trips it.
const DOMINANT_FROZEN_FRACTION = 0.55;
// Within a flagged dominant frozen run, a level below this fraction of the liveliest
// frame reads as blank/background-only ("blank after opening"); at/above it the frames
// still carry content but nothing moves ("static video"). Only affects the message.
const DEAD_LEVEL_FRACTION = 0.6;
// When mean luma is available, a frame this uniformly dark/light is background-only.
const FLAT_LUMA_LOW = 0.02;
const FLAT_LUMA_HIGH = 0.98;
// Video may run a short brand-frame tail past the narration, but a silent tail longer
// than this fraction of the runtime is flagged.
const MAX_SILENT_TAIL_FRACTION = 0.25;
// Duration coherence tolerance (seconds) between video length and narration length.
const DURATION_TOLERANCE_S = 3;

function orientationOf(width: number | null, height: number | null): MediaOrientation | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return width >= height ? "landscape" : "portrait";
}

function aspectRatioOf(width: number | null, height: number | null): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const r = width / height;
  // Snap to the two contract ratios when close, else report the raw ratio.
  if (Math.abs(r - 16 / 9) < 0.06) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.04) return "9:16";
  return `${r.toFixed(2)}:1`;
}

/**
 * Assess one probed asset. Deterministic. PASS iff zero BLOCKER findings; WARNING when
 * only non-blocking anomalies exist; NOT_RUN when there is nothing to assess.
 *
 * Blocking checks:
 *   1. no samples / no duration        — nothing was actually inspected
 *   2. too short                       — duration below the floor
 *   3. wrong orientation (§8)          — landscape asset served portrait or vice-versa
 *   4. missing audio (§7)              — a narrated asset with no audio stream
 *   5. blank/static timeline (§6)      — visuals die before MIN_ALIVE_THROUGH_PCT,
 *                                        or a motion asset never varies (static)
 *   6. narration not covered (§7/§27)  — video meaningfully shorter than the audio; a
 *                                        narrated asset with UNKNOWN audio duration cannot
 *                                        prove completeness → WARNING (never a silent PASS)
 * Warnings: long silent tail; unknown audio duration on a narrated asset; a single interior
 * dead frame that recovers.
 */
export function assessMedia(probe: MediaProbe): MediaQaResult {
  const findings: MediaFinding[] = [];
  const orientation = orientationOf(probe.width, probe.height);
  const aspectRatio = aspectRatioOf(probe.width, probe.height);
  const samples = [...(probe.samples ?? [])].sort((a, b) => a.pct - b.pct);
  const narrated = probe.narrated ?? true;
  const motionExpected = probe.motionExpected ?? true;

  // 1) Nothing inspected — fail closed rather than silently pass.
  if (samples.length === 0 || !probe.durationSeconds || probe.durationSeconds <= 0) {
    findings.push({
      kind: "media.notSampled",
      severity: "BLOCKER",
      detail: `no timeline evidence (${samples.length} samples, duration ${probe.durationSeconds ?? "unknown"}s) — the video was not actually inspected`,
    });
    return { label: probe.label, status: "BLOCKED", findings, timeline: [], aliveThroughPct: 0, orientation, aspectRatio };
  }

  // 2) Too short to be a real asset.
  const minDur = probe.minDurationSeconds ?? null;
  if (minDur != null && probe.durationSeconds < minDur) {
    findings.push({
      kind: "media.tooShort",
      severity: "BLOCKER",
      detail: `duration ${probe.durationSeconds.toFixed(2)}s is below the ${minDur}s floor for this asset`,
    });
  }

  // 3) Orientation / format contract (§8). A technically-playable portrait video does
  //    NOT satisfy a landscape explainer contract, and vice-versa.
  if (probe.expectedOrientation && orientation && orientation !== probe.expectedOrientation) {
    findings.push({
      kind: "media.orientation",
      severity: "BLOCKER",
      detail: `format contract expects ${probe.expectedOrientation} but the asset is ${orientation} (${probe.width}x${probe.height}, ${aspectRatio})`,
    });
  }

  // 4) Missing audio for a narrated asset (§7).
  if (narrated && !probe.hasAudioStream) {
    findings.push({
      kind: "media.noAudio",
      severity: "BLOCKER",
      detail: "a narrated customer-facing video has no audio stream",
    });
  }

  // ── 5) Timeline liveness — the core blank/static detector (§6) ────────────────
  // Group consecutive samples into FROZEN RUNS (adjacent sizes within FROZEN_REL —
  // "nothing is changing here"). Real animation keeps scene sizes moving, so a healthy
  // explainer's longest frozen run is short even when some scenes are simpler than
  // others. The defect signature is ONE frozen run (a repeated still) that DOMINATES
  // the runtime — that, not "smaller than the peak", is what we block on.
  const peak = Math.max(...samples.map((s) => s.byteSize), 1);
  const runId: number[] = [];
  let rid = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i === 0) { runId.push(0); continue; }
    const prev = samples[i - 1].byteSize;
    const cur = samples[i].byteSize;
    const rel = Math.abs(cur - prev) / Math.max(cur, prev, 1);
    if (rel > FROZEN_REL) rid++;
    runId.push(rid);
  }
  const runs = new Map<number, FrameSample[]>();
  runId.forEach((id, i) => { (runs.get(id) ?? runs.set(id, []).get(id)!).push(samples[i]); });

  // The single largest frozen run (≥2 near-identical frames) and its share of the timeline.
  let dominantRunId = -1;
  let dominantFraction = 0;
  let dominantLevel = 1;
  for (const [id, runSamples] of runs) {
    if (runSamples.length < 2) continue;
    const frac = runSamples.length / samples.length;
    if (frac > dominantFraction) {
      dominantFraction = frac;
      dominantRunId = id;
      dominantLevel = Math.max(...runSamples.map((s) => s.byteSize)) / peak;
    }
  }
  const dominantFrozen = dominantFraction >= DOMINANT_FROZEN_FRACTION && motionExpected;

  const isAlive = (i: number, s: FrameSample): boolean => {
    if (s.byteSize < ABSOLUTE_BLANK_BYTES) return false;                 // truly empty frame
    if (dominantFrozen && runId[i] === dominantRunId) return false;      // in the frozen still
    if (s.meanLuma != null && (s.meanLuma <= FLAT_LUMA_LOW || s.meanLuma >= FLAT_LUMA_HIGH)) return false;
    return true;
  };
  const timeline = samples.map((s, i) => ({ pct: s.pct, atSeconds: s.atSeconds, byteSize: s.byteSize, alive: isAlive(i, s) }));

  // The last CONTIGUOUS alive point from the start — where do the visuals actually
  // stop? A healthy explainer stays alive to ~100%; the escaped defect dies early.
  let aliveThroughPct = 0;
  for (const t of timeline) {
    if (t.alive) aliveThroughPct = t.pct;
    else break;
  }

  // Absolute-blank interior frames (truly empty stills mid-runtime, independent of the
  // frozen-run test — e.g. a noisy-but-empty background that doesn't compress identically).
  const blankInterior = timeline.filter((t) => t.pct > 0 && t.pct < 100 && t.byteSize < ABSOLUTE_BLANK_BYTES);

  if (dominantFrozen) {
    const firstFrozen = samples.find((_s, i) => runId[i] === dominantRunId);
    const blank = dominantLevel < DEAD_LEVEL_FRACTION;
    findings.push({
      kind: blank ? "media.blankTimeline" : "media.static",
      severity: "BLOCKER",
      detail: blank
        ? `visuals collapse to a frozen still covering ${(dominantFraction * 100).toFixed(0)}% of the runtime` +
          (firstFrozen ? ` (starts ~${firstFrozen.pct}% / ${firstFrozen.atSeconds.toFixed(1)}s)` : "") +
          ` — only the opening carries meaningful content; the rest is background-only`
        : `a single frozen run covers ${(dominantFraction * 100).toFixed(0)}% of the sampled timeline — the video appears static, not animated`,
    });
  } else if (blankInterior.length >= 2) {
    findings.push({
      kind: "media.blankTimeline",
      severity: "BLOCKER",
      detail: `${blankInterior.length} interior frames are effectively empty (at ${blankInterior.map((d) => `${d.pct}%`).join(", ")}) — large blank stretches in the runtime`,
    });
  }

  // ── 6) Audio / video duration coherence + narration COMPLETENESS (§7/§27) ──────
  // The completeness contract: a narrated explainer PASSES only when we can prove the
  // picture covers the narration to its end. A video that stays visually alive but whose
  // narration is cut off must NOT pass — the duration check above (liveness) cannot see a
  // truncated audio track, so this is the assertion that catches the `-shortest` cut.
  const audioDur = probe.audioDurationSeconds ?? null;
  if (narrated) {
    if (audioDur != null && audioDur > 0) {
      // Video meaningfully SHORTER than narration → the narration is cut off (§26/§27).
      if (probe.durationSeconds < audioDur - DURATION_TOLERANCE_S) {
        findings.push({
          kind: "media.narrationCut",
          severity: "BLOCKER",
          detail: `video runtime ${probe.durationSeconds.toFixed(1)}s is shorter than the ${audioDur.toFixed(1)}s narration — the narration is cut off`,
        });
      }
      // Long silent tail (video much longer than the narration) → warn.
      const tail = probe.durationSeconds - audioDur;
      if (tail > probe.durationSeconds * MAX_SILENT_TAIL_FRACTION && tail > DURATION_TOLERANCE_S) {
        findings.push({
          kind: "media.silentTail",
          severity: "WARNING",
          detail: `video runs ${tail.toFixed(1)}s past the narration (${((tail / probe.durationSeconds) * 100).toFixed(0)}% silent tail)`,
        });
      }
    } else {
      // (§27) A narrated explainer with NO known audio duration cannot have its narration
      // completeness verified — the gate is blind. This must never silently PASS the
      // completeness contract, so surface it as an explicit WARNING (audio present, but the
      // render pipeline failed to record the narration length that proves it is covered).
      findings.push({
        kind: "media.audioDurationUnknown",
        severity: "WARNING",
        detail: "audio duration unknown — cannot verify narration completeness (no audioDurationSeconds recorded for this narrated asset)",
      });
    }
  }

  const hasBlocker = findings.some((f) => f.severity === "BLOCKER");
  const status: MediaStatus = hasBlocker ? "BLOCKED" : findings.length > 0 ? "WARNING" : "PASS";
  return { label: probe.label, status, findings, timeline, aliveThroughPct, orientation, aspectRatio };
}

/** Combine per-asset media results into one verdict. BLOCKED if ANY asset is BLOCKED. */
export function combineMediaResults(results: MediaQaResult[]): { status: MediaStatus; blocked: MediaQaResult[]; warned: MediaQaResult[] } {
  if (results.length === 0) return { status: "NOT_RUN", blocked: [], warned: [] };
  const blocked = results.filter((r) => r.status === "BLOCKED");
  const warned = results.filter((r) => r.status === "WARNING");
  return { status: blocked.length > 0 ? "BLOCKED" : warned.length > 0 ? "WARNING" : "PASS", blocked, warned };
}

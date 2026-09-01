// ARTIFEX FIELD NOTES — data-driven template build helpers. Turns a validated ContentTemplate + the
// analyzed voiceover into (a) a beat timeline anchored to narration onsets and (b) a cue placement list
// derived from beat types. No per-piece code — the same two functions serve every template.

// Sample a monotonic array at a fractional index (linear interpolation).
function interp(arr, pos) {
  if (!arr.length) return 0;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(pos))); const f = pos - i;
  return i + 1 < arr.length ? arr[i] + f * (arr[i + 1] - arr[i]) : arr[i];
}

// ALIGNMENT METHOD (report honestly): each beat's start is anchored to the detected voice onset of its
// first narration line. Onsets come from silencedetect (readSpeech) — i.e. the gaps BETWEEN spoken
// lines, not word-level ASR. When the VO has fewer detected pauses than narration lines, the missing
// line onsets are LINEARLY INTERPOLATED across the gap (approximate, evenly spaced) — this is the known
// limitation, not word-accurate sync. Clear pauses between lines give the tightest alignment.
export function buildTemplateTimeline(tpl, speech, tail = { brand: 0.5, hold: 2.3 }) {
  const S = speech.speechStarts.length ? speech.speechStarts : [0.15];
  const L = tpl.narration.length;
  const onsetForLine = (k) => interp(S, L > 1 ? (k * (S.length - 1)) / (L - 1) : 0);
  const starts = [];
  let prev = 0.15;
  tpl.beats.forEach((b) => {
    let s;
    if (b.type === "brand") s = speech.speechEnd + tail.brand;
    else if (b.lines && b.lines.length) s = onsetForLine(b.lines[0]);
    else s = prev + 1.2;
    s = Math.max(s, prev + 0.4); // strictly increasing; min beat length 0.4s
    starts.push(+s.toFixed(3));
    prev = s;
  });
  const brandStart = starts[starts.length - 1];
  const end = +(brandStart + tail.hold).toFixed(3);
  return { starts, end };
}

// Cue placements from beat types (tonal palette C from buildPalette). Low volumes — VO stays dominant.
export function buildTemplateCues(tpl, C, TL) {
  const P = [];
  const starts = TL.starts;
  tpl.beats.forEach((b, i) => {
    const at = starts[i];
    switch (b.type) {
      case "title":
      case "statement":
        P.push({ f: C.low, at: at + 0.1, v: 0.10 });
        break;
      case "surface":
        b.rows.forEach((_, k) => P.push({ f: C.celllock, at: at + 0.3 + k * 0.4, v: 0.09 }));
        break;
      case "cards":
        b.items.forEach((_, k) => P.push({ f: C.celllock, at: at + 0.25 + k * 0.35, v: 0.09 }));
        break;
      case "chain":
        P.push({ f: C.connect, at: at + 0.3, v: 0.16 });
        b.nodes.forEach((_, k) => P.push({ f: k === b.nodes.length - 1 ? C.confirm : C.celllock, at: at + 0.5 + k * 0.45, v: k === b.nodes.length - 1 ? 0.16 : 0.08 }));
        break;
      case "routes":
        P.push({ f: C.unresolved, at: at + 0.2, v: 0.10 });
        b.items.forEach((_, k) => P.push({ f: C.tick, at: at + 0.25 + k * 0.3, v: 0.08 }));
        break;
      case "search":
        P.push({ f: C.tick, at: at + 0.2, v: 0.09 });
        b.rows.forEach((_, k) => P.push({ f: C.tick, at: at + 0.5 + k * 0.25, v: 0.07 }));
        break;
      case "report":
        b.rows.forEach((_, k) => P.push({ f: C.celllock, at: at + 0.25 + k * 0.3, v: 0.08 }));
        break;
      case "evidenceShot":
        P.push({ f: C.celllock, at: at + 0.25, v: 0.08 }); // soft settle as the screenshot lands
        break;
      case "brand":
        P.push({ f: C.brand, at: at + 0.2, v: 0.20 });
        break;
    }
    if (b.mood === "turn") P.push({ f: C.pulse, at, v: 0.13 });
  });
  return P;
}

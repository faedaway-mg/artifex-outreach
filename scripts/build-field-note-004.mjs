#!/usr/bin/env node
// Content #004 — "Waiting for approval." Thin build on the shared factory (scripts/lib/fieldnote.mjs).
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFieldNote } from "./lib/fieldnote.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TL = { ready: 0.3, done: 2.8, await: 4.6, unknowns: 6.0, waited: 8.4, times: 10.8, nothing: 13.2,
  justwait: 14.8, turn: 16.6, scav: 20.4, knows: 22.8, move: 27.0, brand: 29.4, end: 32.6 };

await buildFieldNote({
  note: "004",
  dir: join(ROOT, "public", "content", "field-note-004"),
  docs: join(ROOT, "docs", "content"),
  tmp: join(ROOT, ".tmp-004"),
  sceneFile: join(ROOT, "public", "content", "field-note-004", "scene-004.html"),
  sceneBasename: "scene-004.html",
  port: 9301,
  TL,
  placements: (C, T) => {
    const P = [{ f: C.atmo, at: 0, v: 1.0 }];
    P.push({ f: C.confirm, at: T.ready + 1.5, v: 0.18 });      // work is ready ✓
    P.push({ f: C.low, at: T.done, v: 0.12 });
    P.push({ f: C.unresolved, at: T.await, v: 0.14 });          // awaiting (hangs)
    P.push({ f: C.tick, at: T.unknowns + 0.2, v: 0.10 });       // the "?" appear
    P.push({ f: C.descend, at: T.waited, v: 0.13 });            // "then it waited"
    [0.2, 0.9, 1.6].forEach((d) => P.push({ f: C.tick, at: T.times + d, v: 0.09 })); // time advances
    P.push({ f: C.low, at: T.justwait, v: 0.11 });
    P.push({ f: C.connect, at: T.turn + 0.4, v: 0.18 });        // Artifex path
    for (let i = 0; i < 5; i++) P.push({ f: i === 3 ? C.confirm : C.celllock, at: T.turn + 0.5 + i * 0.5, v: i === 3 ? 0.18 : 0.09 }); // chain lights; APPROVED = satisfying
    P.push({ f: C.pulse, at: T.knows, v: 0.14 });
    P.push({ f: C.presolve, at: T.move - 0.2, v: 0.16 });
    P.push({ f: C.brand, at: T.brand + 0.2, v: 0.22 });
    return P;
  },
  narration: {
    lines: ["The work is finished.", "But it can't move — someone needs to approve it.",
      "So it sits in an inbox. Then a chat. Then another message.", "Nobody's sure who has it, or what happens next.",
      "Nothing is wrong with the work.", "The workflow just has no way to move it forward.",
      "When something's ready, the next step should already know who owns it.", "Good workflows keep work moving."],
    anchors: [TL.ready + 0.6, TL.await, TL.unknowns + 0.4, TL.waited, TL.nothing, TL.justwait, TL.knows, TL.move],
  },
});

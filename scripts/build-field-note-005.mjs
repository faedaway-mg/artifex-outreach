#!/usr/bin/env node
// Content #005 — "It's somewhere in the inbox." Thin build on the shared factory.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFieldNote } from "./lib/fieldnote.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TL = { ask: 0.3, exists: 2.6, search: 4.4, luck: 7.8, requery: 9.8, notmiss: 12.2, struct: 13.8,
  turn: 15.8, found: 16.4, know: 20.0, findit: 22.2, inbox: 25.6, brand: 28.6, end: 31.8 };

await buildFieldNote({
  note: "005",
  dir: join(ROOT, "public", "content", "field-note-005"),
  docs: join(ROOT, "docs", "content"),
  tmp: join(ROOT, ".tmp-005"),
  sceneFile: join(ROOT, "public", "content", "field-note-005", "scene-005.html"),
  sceneBasename: "scene-005.html",
  port: 9302,
  TL,
  placements: (C, T) => {
    const P = [{ f: C.atmo, at: 0, v: 1.0 }];
    P.push({ f: C.tick, at: T.ask + 0.3, v: 0.10 });                            // search focus
    P.push({ f: C.low, at: T.exists, v: 0.12 });
    for (let i = 0; i < 4; i++) P.push({ f: C.tick, at: T.search + 0.1 + i * 0.28, v: 0.08 }); // result rows
    for (let i = 0; i < 3; i++) P.push({ f: C.celllock, at: T.search + 1.0 + i * 0.35, v: 0.09 }); // counters
    P.push({ f: C.unresolved, at: T.luck, v: 0.13 });                            // "good luck"
    [0, 0.7, 1.4].forEach((d) => P.push({ f: C.tick, at: T.requery + d, v: 0.08 })); // re-query flail
    P.push({ f: C.low, at: T.struct, v: 0.12 });
    P.push({ f: C.connect, at: T.turn + 0.4, v: 0.18 });                         // Artifex structures it
    for (let i = 0; i < 3; i++) P.push({ f: i === 2 ? C.confirm : C.celllock, at: T.found + 0.4 + i * 0.5, v: i === 2 ? 0.18 : 0.10 }); // record fields; Searchable = satisfying
    P.push({ f: C.pulse, at: T.know, v: 0.14 });
    P.push({ f: C.presolve, at: T.inbox - 0.1, v: 0.16 });
    P.push({ f: C.brand, at: T.brand + 0.2, v: 0.22 });
    return P;
  },
  narration: {
    lines: ["The signed agreement exists. Somewhere.", "So the search starts. Email. A thread. A forward. An attachment.",
      "Thirty-four results. Three versions. Which one is real?", "The problem isn't that the information is missing.",
      "It's that nothing gives it structure.", "Captured once, it's tied to the customer, versioned, and easy to find.",
      "Having information isn't the same as being able to use it.", "Your inbox shouldn't be your operating system."],
    anchors: [TL.exists, TL.search + 0.4, TL.luck, TL.notmiss, TL.struct, TL.found + 0.6, TL.findit, TL.inbox],
  },
});

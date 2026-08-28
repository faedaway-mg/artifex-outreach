#!/usr/bin/env node
// Content #006 — "The report that takes all morning." Thin build on the shared factory.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFieldNote } from "./lib/fieldnote.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TL = { monday: 0.3, short: 2.8, pull: 4.6, building: 8.6, filled: 11.0, already: 12.6, turn: 15.2,
  auto: 16.0, created: 19.8, rebuild: 22.0, answer: 25.6, brand: 28.2, end: 31.4 };

await buildFieldNote({
  note: "006",
  dir: join(ROOT, "public", "content", "field-note-006"),
  docs: join(ROOT, "docs", "content"),
  tmp: join(ROOT, ".tmp-006"),
  sceneFile: join(ROOT, "public", "content", "field-note-006", "scene-006.html"),
  sceneBasename: "scene-006.html",
  port: 9303,
  TL,
  placements: (C, T) => {
    const P = [{ f: C.atmo, at: 0, v: 1.0 }];
    P.push({ f: C.low, at: T.monday + 0.3, v: 0.10 });                          // monday morning
    for (let i = 0; i < 5; i++) P.push({ f: C.celllock, at: T.pull + 0.3 + i * 0.7, v: 0.10 }); // manual copy, one number at a time
    [0.5, 1.2].forEach((d) => P.push({ f: C.tick, at: T.pull + d, v: 0.07 }));  // copy/paste micro-ticks
    P.push({ f: C.unresolved, at: T.filled, v: 0.12 });                         // "done (3 hrs)" — hollow
    P.push({ f: C.descend, at: T.already, v: 0.12 });                           // "already in the systems"
    P.push({ f: C.connect, at: T.turn + 0.4, v: 0.18 });                        // Artifex one view
    for (let i = 0; i < 5; i++) P.push({ f: C.tick, at: T.auto + 0.2 + i * 0.18, v: 0.08 }); // auto-fills, effortless
    P.push({ f: C.confirm, at: T.auto + 1.3, v: 0.18 });                        // view is live (satisfying)
    P.push({ f: C.pulse, at: T.created, v: 0.14 });
    P.push({ f: C.presolve, at: T.answer - 0.1, v: 0.16 });
    P.push({ f: C.brand, at: T.brand + 0.2, v: 0.22 });
    return P;
  },
  narration: {
    lines: ["Every Monday, someone builds the weekly report.", "Sales. Projects. Revenue. Leads. Delivery.",
      "Open each system, copy the number, paste it in, check it, reconcile it.", "The meeting takes a few minutes.",
      "Building the report takes the morning.", "But the business already created all of this data.",
      "Reporting should be an output of the system — not a weekly rebuild.", "The answer should already be there."],
    anchors: [TL.monday + 0.6, TL.pull, TL.pull + 1.6, TL.short, TL.building, TL.already, TL.created, TL.answer],
  },
});

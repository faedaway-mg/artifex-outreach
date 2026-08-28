// ARTIFEX FIELD NOTES — per-piece configuration (the factory's source of truth for #004+).
// NOTE: placements here are CUE-ONLY by default — NO continuous atmosphere/drone. Atmosphere is now
// opt-in (wrap with atmoPlacement(C) if a future piece explicitly needs it). This is the standing
// audio philosophy from the VO finishing pass: VOICE · EVENT CUES · SILENCE. #001–#003 outputs are
// frozen and unaffected.
export const NOTES = {
  "004": {
    seed: 20260104, sceneBasename: "scene-004.html", port: 9311,
    TL: { ready: 0.3, done: 2.8, await: 4.6, unknowns: 6.0, waited: 8.4, times: 10.8, nothing: 13.2,
      justwait: 14.8, turn: 16.6, scav: 20.4, knows: 22.8, move: 27.0, brand: 29.4, end: 32.6 },
    // base time of each narration line (monotonic) — used to sync visuals to the VO
    narrTimes: [0.3, 4.6, 6.0, 8.4, 13.2, 14.8, 22.8, 27.0],
    placements: (C, T) => {
      const P = [];
      P.push({ f: C.confirm, at: T.ready + 1.5, v: 0.18 });   // work ready ✓
      P.push({ f: C.low, at: T.done, v: 0.12 });
      P.push({ f: C.unresolved, at: T.await, v: 0.14 });       // awaiting (short, not sustained)
      P.push({ f: C.tick, at: T.unknowns + 0.2, v: 0.10 });
      P.push({ f: C.descend, at: T.waited, v: 0.13 });
      [0.2, 0.9, 1.6].forEach((d) => P.push({ f: C.tick, at: T.times + d, v: 0.09 }));
      P.push({ f: C.low, at: T.justwait, v: 0.11 });
      P.push({ f: C.connect, at: T.turn + 0.4, v: 0.18 });
      for (let i = 0; i < 5; i++) P.push({ f: i === 3 ? C.confirm : C.celllock, at: T.turn + 0.5 + i * 0.5, v: i === 3 ? 0.18 : 0.09 });
      P.push({ f: C.pulse, at: T.knows, v: 0.14 });
      P.push({ f: C.brand, at: T.brand + 0.2, v: 0.22 });
      return P;
    },
  },
  "005": {
    seed: 20260105, sceneBasename: "scene-005.html", port: 9312,
    TL: { ask: 0.3, exists: 2.6, search: 4.4, luck: 7.8, requery: 9.8, notmiss: 12.2, struct: 13.8,
      turn: 15.8, found: 16.4, know: 20.0, findit: 22.2, inbox: 25.6, brand: 28.6, end: 31.8 },
    narrTimes: [2.6, 4.4, 7.8, 12.2, 13.8, 16.4, 22.2, 25.6],
    placements: (C, T) => {
      const P = [];
      P.push({ f: C.tick, at: T.ask + 0.3, v: 0.10 });
      P.push({ f: C.low, at: T.exists, v: 0.12 });
      for (let i = 0; i < 4; i++) P.push({ f: C.tick, at: T.search + 0.1 + i * 0.28, v: 0.08 });
      for (let i = 0; i < 3; i++) P.push({ f: C.celllock, at: T.search + 1.0 + i * 0.35, v: 0.09 });
      P.push({ f: C.unresolved, at: T.luck, v: 0.13 });
      [0, 0.7, 1.4].forEach((d) => P.push({ f: C.tick, at: T.requery + d, v: 0.08 }));
      P.push({ f: C.low, at: T.struct, v: 0.12 });
      P.push({ f: C.connect, at: T.turn + 0.4, v: 0.18 });
      for (let i = 0; i < 3; i++) P.push({ f: i === 2 ? C.confirm : C.celllock, at: T.found + 0.4 + i * 0.5, v: i === 2 ? 0.18 : 0.10 });
      P.push({ f: C.pulse, at: T.know, v: 0.14 });
      P.push({ f: C.brand, at: T.brand + 0.2, v: 0.22 });
      return P;
    },
  },
  "006": {
    seed: 20260106, sceneBasename: "scene-006.html", port: 9313,
    TL: { monday: 0.3, short: 2.8, pull: 4.6, building: 8.6, filled: 11.0, already: 12.6, turn: 15.2,
      auto: 16.0, created: 19.8, rebuild: 22.0, answer: 25.6, brand: 28.2, end: 31.4 },
    narrTimes: [0.3, 4.6, 6.2, 8.6, 10.5, 12.6, 19.8, 25.6],
    placements: (C, T) => {
      const P = [];
      P.push({ f: C.low, at: T.monday + 0.3, v: 0.10 });
      for (let i = 0; i < 5; i++) P.push({ f: C.celllock, at: T.pull + 0.3 + i * 0.7, v: 0.10 });
      [0.5, 1.2].forEach((d) => P.push({ f: C.tick, at: T.pull + d, v: 0.07 }));
      P.push({ f: C.unresolved, at: T.filled, v: 0.12 });
      P.push({ f: C.descend, at: T.already, v: 0.12 });
      P.push({ f: C.connect, at: T.turn + 0.4, v: 0.18 });
      for (let i = 0; i < 5; i++) P.push({ f: C.tick, at: T.auto + 0.2 + i * 0.18, v: 0.08 });
      P.push({ f: C.confirm, at: T.auto + 1.3, v: 0.18 });
      P.push({ f: C.pulse, at: T.created, v: 0.14 });
      P.push({ f: C.brand, at: T.brand + 0.2, v: 0.22 });
      return P;
    },
  },
};

// Opt-in atmosphere (NOT default). A future piece that wants a bed: [atmoPlacement(C), ...cues].
export const atmoPlacement = (C) => ({ f: C.atmo, at: 0, v: 1.0 });

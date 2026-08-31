#!/usr/bin/env node
// TRACK 2 durability proof — the artifact must survive a WORKER/WEB RESTART. Phase "put" writes bytes to
// the durable store in ONE process, then exits (that process is gone). Phase "verify" runs in a SEPARATE
// process (a fresh connection = a restart) and must read the exact bytes back by key: sha256 matches,
// server-side Range slice matches, metadata intact. Point it at a real cloud Postgres via
// CS_STORAGE_PROVIDER=postgres + CS_DATABASE_URL to prove cross-restart durability against real infra.
import { putArtifact, getArtifactMeta, readArtifactRange, readArtifactFull, closeArtifacts } from "./lib/cs-artifacts.mjs";
import { createHash } from "node:crypto";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const KEY = "content-studio/staging/render-output/csjob_restart/v1.mp4";
// Deterministic 4 KB body so "put" and "verify" (different processes) agree without sharing memory.
const BODY = Buffer.from("ARTIFEX-STAGING-DURABILITY-" + "x".repeat(4096));
const EXPECT = sha(BODY);
const phase = process.argv[2];

if (phase === "put") {
  const r = await putArtifact(KEY, BODY, "video/mp4", { artifactClass: "render-output", jobId: "csjob_restart" });
  console.log(`PUT ok bytes=${r.bytes} sha=${r.sha256} match=${r.sha256 === EXPECT}`);
  await closeArtifacts();
  process.exit(r.sha256 === EXPECT ? 0 : 1);
} else if (phase === "verify") {
  const meta = await getArtifactMeta(KEY);
  const full = await readArtifactFull(KEY);
  const range = await readArtifactRange(KEY, 10, 19); // 10 inclusive bytes, server-side slice
  await closeArtifacts();
  const fullSha = full ? sha(full) : null;
  const rangeOk = range ? range.equals(BODY.subarray(10, 20)) : false;
  const ok = meta && meta.size === BODY.length && fullSha === EXPECT && rangeOk;
  console.log(`VERIFY (fresh process) meta.size=${meta && meta.size} sha=${fullSha} shaMatch=${fullSha === EXPECT} rangeMatch=${rangeOk} => ${ok ? "DURABLE" : "LOST"}`);
  process.exit(ok ? 0 : 1);
} else {
  console.error("usage: verify-cs-cloud-restart.mjs put|verify");
  process.exit(2);
}

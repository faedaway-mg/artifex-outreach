// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY forensics against the Railway public API.
//
// Pulls the full build + deploy logs and the deployment metadata the CLI does
// not surface, so a failure can be diagnosed from evidence rather than guessed
// at. Queries only; it never mutates a deployment or a setting.
//
// The access token is read from ~/.railway/config.json and is NEVER printed.
//
//   node scripts/railway-deploy-forensics.mjs <deploymentId> [<deploymentId> ...]
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import os from "node:os";

const cfg = JSON.parse(fs.readFileSync(`${os.homedir()}/.railway/config.json`, "utf8"));
const token = cfg?.user?.token || cfg?.user?.accessToken;
if (!token) { console.error("No Railway credential found."); process.exit(1); }

const API = "https://backboard.railway.com/graphql/v2";

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({ errors: [{ message: `non-JSON, HTTP ${res.status}` }] }));
  if (json.errors) console.log(`  [api] ${json.errors.map((e) => e.message).join(" | ")}`);
  return json.data ?? null;
}

const DEPLOYMENT = `query($id: String!) {
  deployment(id: $id) {
    id status createdAt canRedeploy snapshotId meta
    deploymentStopped
    service { id name }
  }
}`;

const BUILD_LOGS = `query($id: String!, $limit: Int) {
  buildLogs(deploymentId: $id, limit: $limit) { timestamp severity message }
}`;

const DEPLOY_LOGS = `query($id: String!, $limit: Int) {
  deploymentLogs(deploymentId: $id, limit: $limit) { timestamp severity message }
}`;

for (const id of process.argv.slice(2)) {
  console.log(`\n${"═".repeat(72)}\nDEPLOYMENT ${id}`);

  const d = await gql(DEPLOYMENT, { id });
  const dep = d?.deployment;
  if (dep) {
    console.log(`  service ......... ${dep.service?.name} (${dep.service?.id})`);
    console.log(`  status .......... ${dep.status}`);
    console.log(`  createdAt ....... ${dep.createdAt}`);
    console.log(`  stopped ......... ${dep.deploymentStopped}`);
    console.log(`  snapshotId ...... ${dep.snapshotId ?? "(none)"}`);
    console.log(`  meta ............ ${JSON.stringify(dep.meta, null, 2)}`);
  } else {
    console.log("  (deployment query returned nothing — see api errors above)");
  }

  for (const [label, q] of [["BUILD LOGS", BUILD_LOGS], ["DEPLOY LOGS", DEPLOY_LOGS]]) {
    const r = await gql(q, { id, limit: 500 });
    const logs = r?.buildLogs ?? r?.deploymentLogs ?? null;
    console.log(`\n  ── ${label} ──`);
    if (!logs) { console.log("    (unavailable)"); continue; }
    if (!logs.length) { console.log("    (empty — zero log lines were ever emitted)"); continue; }
    for (const l of logs) console.log(`    ${l.timestamp} [${l.severity ?? "-"}] ${l.message}`);
  }
}

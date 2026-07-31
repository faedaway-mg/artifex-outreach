import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Drives the REAL scripts/deploy-preflight.sh with a PATH-stubbed `railway` binary
// and file:// fixture URLs, so NO live Railway or network call can occur. The stub
// logs every invocation, letting us PROVE no mutating command ran.

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "deploy-preflight.sh");

function makeStub(dir: string, opts: { listOutput?: string; listExit?: number } = {}) {
  const log = join(dir, "railway-invocations.log");
  const listFile = join(dir, "list-output.txt");
  writeFileSync(listFile, opts.listOutput ?? "Recent Deployments\n  dep-abc123 | SUCCESS | 2026-07-30 16:48:10 -07:00\n");
  const stub = join(dir, "railway");
  writeFileSync(stub, `#!/usr/bin/env bash
echo "$@" >> "${log}"
case "$1" in
  deployment) cat "${listFile}"; exit ${opts.listExit ?? 0};;
  --version) echo "railway-stub 0.0.0"; exit 0;;
  up|redeploy|restart|rollback|link|unlink|variable|service|environment|down|remove|add) echo "MUTATION ATTEMPTED" >> "${log}"; exit 97;;
  *) exit 0;;
esac
`);
  chmodSync(stub, 0o755);
  return { log };
}

function run(dir: string, env: Record<string, string>, expectFail = false) {
  try {
    const out = execFileSync("bash", [SCRIPT], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        RAILWAY_BIN: join(dir, "railway"),
        PREFLIGHT_ARTIFACT_DIR: join(dir, "artifacts"),
        ...env,
      },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e: any) {
    if (!expectFail) throw e;
    return { code: e.status as number, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

function fixtureUrl(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return `file://${p}`;
}

function artifact(dir: string) {
  const files = readdirSync(join(dir, "artifacts")).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);
  return JSON.parse(readFileSync(join(dir, "artifacts", files[files.length - 1]), "utf8"));
}

const OK_STATUS = "<html>Railway Status Fully Operational Operational</html>";
const OK_HEALTH = '{"status":"ok","database":{"configured":true,"connected":true}}';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "preflight-")); });

describe("deploy-preflight — read-only Railway preflight", () => {
  it("1) all-green → overall PASS, deployment permitted, honest wording", () => {
    makeStub(dir);
    const r = run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    expect(r.out).toContain("PREFLIGHT PASS — no known read-only evidence currently blocks attempting");
    expect(r.out).not.toMatch(/Railway is healthy|Deployment is safe|will succeed/);
    const a = artifact(dir);
    expect(a.overall).toBe("PASS");
    expect(a.deployment_permitted).toBe(true);
    expect(a.target).toMatchObject({ project: "artifex-outreach", environment: "production", service: "outreach-web" });
  });

  it("4) official status reports deployments paused → BLOCK (exit 1), not overridable", () => {
    makeStub(dir);
    const r = run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", "<html>Active incident: Deployments are paused while we investigate</html>"),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    }, true);
    expect(r.code).toBe(1);
    expect(r.out).toContain("PREFLIGHT BLOCK");
    expect(artifact(dir)).toMatchObject({ overall: "BLOCK", deployment_permitted: false });
  });

  it("5) unrelated/ambiguous incident → CAUTION, still permitted", () => {
    makeStub(dir);
    const r = run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", "<html>Investigating elevated error rates in logging</html>"),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    expect(r.out).toContain("PREFLIGHT CAUTION");
    expect(artifact(dir)).toMatchObject({ overall: "CAUTION", deployment_permitted: true });
  });

  it("6) status source unreachable → UNKNOWN preserved (never rewritten to PASS), warn + continue", () => {
    makeStub(dir);
    const r = run(dir, {
      PREFLIGHT_STATUS_URL: "file:///nonexistent/status.html",
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    expect(r.out).toContain("PREFLIGHT UNKNOWN");
    expect(r.out).toContain("Unknown platform state is NOT evidence of health");
    const a = artifact(dir);
    expect(a.checks.public_status.state).toBe("UNKNOWN");
    expect(a.overall).toBe("UNKNOWN");
    expect(a.deployment_permitted).toBe(true);
  });

  it("7) deployment list command fails → UNKNOWN state recorded, continue", () => {
    makeStub(dir, { listExit: 1, listOutput: "error: not logged in" });
    run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    const a = artifact(dir);
    expect(a.checks.deployment_visibility.state).toBe("UNKNOWN");
  });

  it("8) in-progress deployment (BUILDING) → CAUTION", () => {
    makeStub(dir, { listOutput: "Recent Deployments\n  dep-live | BUILDING | 2026-07-31 09:00:00 -07:00\n" });
    const r = run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    expect(r.out).toContain("in-progress deployment already exists (BUILDING)");
    const a = artifact(dir);
    expect(a.checks.deployment_visibility).toMatchObject({ state: "CAUTION", latest_deployment: { id: "dep-live", status: "BUILDING" } });
  });

  it("9/10) current health ok → PASS; degraded 503 → CAUTION but still permitted (fix-over-broken-prod policy)", () => {
    makeStub(dir);
    run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", '{"status":"degraded","database":{"connected":false}}'),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    const a = artifact(dir);
    expect(a.checks.current_application_health.state).toBe("CAUTION");
    expect(a.deployment_permitted).toBe(true);
    expect(a.checks.current_application_health.caveat).toContain("does not prove");
  });

  it("11) pending migrations reaching the preflight → BLOCK regardless of anything else", () => {
    makeStub(dir);
    const r = run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "3",
    }, true);
    expect(r.code).toBe(1);
    expect(artifact(dir).checks.migration_readiness.state).toBe("BLOCK");
  });

  it("16/17) evidence artifact carries all required non-secret fields and no credential patterns", () => {
    makeStub(dir);
    run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    const a = artifact(dir);
    for (const k of ["schema", "invoked_at", "commit", "branch", "clean_tree", "target", "railway_cli_version", "checks", "overall", "deployment_permitted", "overrides_in_effect", "redaction"]) {
      expect(a).toHaveProperty(k);
    }
    const rawText = JSON.stringify(a);
    expect(rawText).not.toMatch(/(api[_-]?key|password|authorization|bearer\s+[a-z0-9]|postgres(ql)?:\/\/)/i);
    expect(a.overrides_in_effect).toEqual([]); // no override flags exist by design
  });

  it("18) an interrupted run leaves no complete-looking artifact (atomic write)", () => {
    // Simulate interruption: node unavailable → artifact generation fails mid-run.
    makeStub(dir);
    const brokenNode = join(dir, "node");
    writeFileSync(brokenNode, "#!/usr/bin/env bash\nexit 1\n"); chmodSync(brokenNode, 0o755);
    try {
      execFileSync("bash", [SCRIPT], {
        cwd: ROOT,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RAILWAY_BIN: join(dir, "railway"),
               PREFLIGHT_ARTIFACT_DIR: join(dir, "artifacts"),
               PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
               PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
               PREFLIGHT_MIGRATIONS_RESULT: "0" },
        encoding: "utf8",
      });
    } catch { /* expected: set -e aborts when node fails */ }
    const files = existsSync(join(dir, "artifacts")) ? readdirSync(join(dir, "artifacts")).filter((f) => f.endsWith(".json")) : [];
    expect(files).toHaveLength(0); // only the .tmp remains — no false complete artifact
  });

  it("19) NO mutating railway command is ever invoked by the preflight", () => {
    const { log } = makeStub(dir);
    run(dir, {
      PREFLIGHT_STATUS_URL: fixtureUrl(dir, "status.html", OK_STATUS),
      PREFLIGHT_HEALTH_URL: fixtureUrl(dir, "health.json", OK_HEALTH),
      PREFLIGHT_MIGRATIONS_RESULT: "0",
    });
    const calls = readFileSync(log, "utf8");
    expect(calls).not.toContain("MUTATION ATTEMPTED");
    expect(calls).not.toMatch(/^(up|redeploy|restart|rollback|link|variable)/m);
    const allowed = calls.trim().split("\n").every((l) => l.startsWith("deployment list") || l.startsWith("--version"));
    expect(allowed).toBe(true); // only documented read-only commands
  });
});

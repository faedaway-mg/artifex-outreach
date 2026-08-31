// Manage the rehearsal-owned SignWell webhook. Never prints the API key or the webhook
// id (the id is the HMAC key → stored as SIGNWELL_WEBHOOK_SECRET, file chmod 600).
//   register <tunnelBaseUrl>  — delete any existing hooks, create one at the tunnel, store id
//   list                      — count existing hooks (ids redacted)
//   delete-all                — remove all hooks (cleanup) and clear the local secret
import "./loadEnv";
import fs from "fs";

const KEY = process.env.SIGNWELL_API_KEY ?? "";
const BASE = process.env.SIGNWELL_API_BASE ?? "https://www.signwell.com";
const cmd = process.argv[2];
const arg = process.argv[3];

async function hooks(): Promise<any[]> {
  const r = await fetch(`${BASE}/api/v1/hooks/`, { headers: { "X-Api-Key": KEY } });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : j.hooks ?? j.data ?? [];
}
function writeSecret(id: string | null) {
  let env = fs.readFileSync(".env.local", "utf8");
  if (id === null) {
    env = env.replace(/^SIGNWELL_WEBHOOK_SECRET=.*\n?/m, "");
  } else if (/^SIGNWELL_WEBHOOK_SECRET=.*$/m.test(env)) {
    env = env.replace(/^SIGNWELL_WEBHOOK_SECRET=.*$/m, `SIGNWELL_WEBHOOK_SECRET=${id}`);
  } else {
    env = env.trimEnd() + `\nSIGNWELL_WEBHOOK_SECRET=${id}\n`;
  }
  fs.writeFileSync(".env.local", env);
  fs.chmodSync(".env.local", 0o600);
}

async function main() {
  if (!KEY) throw new Error("SIGNWELL_API_KEY not set");

  if (cmd === "list") {
    const h = await hooks();
    console.log(`existing hooks: ${h.length}`);
    for (const x of h) console.log(`  - id=***${String(x.id).slice(-4)} callback=${x.callback_url}`);
    return;
  }

  if (cmd === "delete-all") {
    const h = await hooks();
    for (const x of h) {
      const d = await fetch(`${BASE}/api/v1/hooks/${x.id}/`, { method: "DELETE", headers: { "X-Api-Key": KEY } });
      console.log(`deleted hook ***${String(x.id).slice(-4)}: ${d.status}`);
    }
    writeSecret(null);
    console.log("cleared SIGNWELL_WEBHOOK_SECRET locally.");
    return;
  }

  if (cmd === "register") {
    if (!arg || !/^https:\/\//.test(arg)) throw new Error("pass the https tunnel base url");
    // Remove any stale hooks first so exactly ONE rehearsal-owned hook exists.
    for (const x of await hooks()) {
      await fetch(`${BASE}/api/v1/hooks/${x.id}/`, { method: "DELETE", headers: { "X-Api-Key": KEY } });
    }
    const callback = `${arg.replace(/\/$/, "")}/api/webhooks/signwell`;
    const r = await fetch(`${BASE}/api/v1/hooks/`, {
      method: "POST",
      headers: { "X-Api-Key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ callback_url: callback }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(`register failed ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    writeSecret(String(j.id));
    console.log(`registered ONE webhook at ${callback}; id stored as SIGNWELL_WEBHOOK_SECRET (chmod 600, not printed).`);
    return;
  }

  throw new Error("usage: signwell-webhook.ts <register <url>|list|delete-all>");
}
main().catch((e) => { console.error("WEBHOOK ERROR:", e.message); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────────
// Communication activation preflight — a READ-ONLY readiness gate. It sends NO
// email. It reports whether the production email layer is safe to activate:
//   • required secrets present
//   • Resend domain verified (if RESEND_API_KEY provided)
//   • SPF / DKIM / DMARC DNS for the sending domain
//   • provider health (live ping, if keyed)
//
// Usage (locally, with the real values, never committed):
//   RESEND_API_KEY=... RESEND_FROM='Name <you@domain>' \
//   RESEND_WEBHOOK_SECRET=whsec_... PUBLIC_BASE_URL=https://... \
//   npx tsx scripts/comms/preflight.ts [--domain artifexlabs.tech]
//
// Exit code 0 = READY to activate, 1 = GATED (something missing/unsafe).
import "../loadEnv";
import { resolveTxt } from "node:dns/promises";

type Status = "ok" | "warn" | "fail";
const rows: Array<{ check: string; status: Status; detail: string }> = [];
const add = (check: string, status: Status, detail: string) => rows.push({ check, status, detail });

function domainFromFrom(from: string | undefined, override?: string): string | null {
  if (override) return override;
  if (!from) return null;
  const m = from.match(/@([^\s>]+)/);
  return m ? m[1].toLowerCase() : null;
}

async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

async function main() {
  const argDomain = process.argv.find((a) => a.startsWith("--domain="))?.split("=")[1];
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const publicBase = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  const domain = domainFromFrom(from, argDomain);

  // ── Secrets ────────────────────────────────────────────────────────────────
  add("RESEND_API_KEY", key ? "ok" : "fail", key ? "present" : "missing — provider stays disabled");
  add("RESEND_FROM", from ? "ok" : "fail", from ?? "missing — no verified sender");
  add("RESEND_WEBHOOK_SECRET", webhookSecret ? "ok" : "fail", webhookSecret ? "present" : "missing — webhooks fail closed in prod");
  add("PUBLIC_BASE_URL", publicBase ? "ok" : "warn", publicBase ?? "missing — one-click unsubscribe falls back to reply-based opt-out");
  add("CRON_SECRET", cronSecret ? "ok" : "fail", cronSecret ? "present" : "missing — scheduler + status endpoints unauthenticated");

  // ── DNS (SPF / DKIM / DMARC) ────────────────────────────────────────────────
  if (!domain) {
    add("DNS", "fail", "cannot determine sending domain (set RESEND_FROM or --domain=)");
  } else {
    const spf = (await txt(domain)).filter((r) => /v=spf1/i.test(r));
    const spfResend = spf.some((r) => /resend|amazonses|include:.*resend/i.test(r));
    add("SPF", spf.length === 0 ? "fail" : spfResend ? "ok" : "warn", spf.length ? spf.join(" | ") : `no SPF TXT on ${domain}`);

    // Resend's DKIM CNAME/TXT is published at resend._domainkey.<domain>.
    const dkim = await txt(`resend._domainkey.${domain}`);
    add("DKIM (resend._domainkey)", dkim.length ? "ok" : "fail", dkim.length ? "published" : `not found at resend._domainkey.${domain}`);

    const dmarc = await txt(`_dmarc.${domain}`);
    const dmarcRec = dmarc.find((r) => /v=DMARC1/i.test(r));
    add("DMARC", dmarcRec ? "ok" : "warn", dmarcRec ?? `no DMARC on _dmarc.${domain}`);
  }

  // ── Resend account (only if keyed) ──────────────────────────────────────────
  if (key) {
    try {
      const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) {
        add("Resend API", res.status === 401 || res.status === 403 ? "fail" : "warn", `GET /domains → HTTP ${res.status}`);
      } else {
        const json = (await res.json()) as { data?: Array<{ name?: string; status?: string }> };
        const list = json.data ?? [];
        const match = domain ? list.find((d) => d.name?.toLowerCase() === domain) : undefined;
        add("Resend API", "ok", `reachable — ${list.length} domain(s) on account`);
        if (domain) add("Resend domain verified", match?.status === "verified" ? "ok" : "fail", match ? `${domain}: ${match.status}` : `${domain} not found on account`);
      }
    } catch (e) {
      add("Resend API", "fail", `unreachable: ${(e as Error).message}`);
    }
  } else {
    add("Resend API", "warn", "skipped — no RESEND_API_KEY (run with the key to verify domain state)");
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const icon = { ok: "✓", warn: "▲", fail: "✗" } as const;
  console.log("\nCommunication Activation Preflight");
  console.log("=".repeat(60));
  if (domain) console.log(`sending domain: ${domain}\n`);
  for (const r of rows) console.log(`  ${icon[r.status]}  ${r.check.padEnd(28)} ${r.detail}`);

  const fails = rows.filter((r) => r.status === "fail");
  const warns = rows.filter((r) => r.status === "warn");
  console.log("=".repeat(60));
  if (fails.length === 0) {
    console.log(`READY to activate${warns.length ? ` (with ${warns.length} warning(s))` : ""}. No email has been sent.`);
    process.exit(0);
  }
  console.log(`GATED — ${fails.length} blocking item(s):`);
  for (const f of fails) console.log(`   ✗ ${f.check}: ${f.detail}`);
  console.log("Resolve these before activation. No email has been sent.");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

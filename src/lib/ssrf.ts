// ─────────────────────────────────────────────────────────────────────────────
// SSRF-safe fetch for untrusted business URLs / assets.
//
// Only http(s); resolves the hostname and rejects loopback / private / link-local
// / metadata / internal Railway targets; limits redirects (revalidating each hop);
// caps response size + duration; validates MIME and rejects executable content.
// Webpage text is DATA, never trusted instructions.
// ─────────────────────────────────────────────────────────────────────────────
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  error?: string;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;

const BLOCKED_HOST_SUFFIXES = [".railway.internal", ".internal", ".local", ".localhost"];
const BLOCKED_MIME = [/javascript/i, /ecmascript/i, /wasm/i, /octet-stream/i, /x-sh/i, /x-msdownload/i];

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 (incl. some special)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function ipv6Blocked(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local / ULA
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4Blocked(mapped[1]);
  if (v.startsWith("ff")) return true; // multicast
  return false;
}

function ipBlocked(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
  return true;
}

async function assertHostAllowed(hostname: string): Promise<void> {
  const h = hostname.toLowerCase();
  if (!h || h === "localhost") throw new Error("blocked host");
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) throw new Error("blocked internal host");
  // If it's a literal IP, check directly; else resolve and check every address.
  if (isIP(h)) {
    if (ipBlocked(h)) throw new Error("blocked IP");
    return;
  }
  const results = await lookup(h, { all: true });
  if (!results.length) throw new Error("dns resolution failed");
  for (const { address } of results) {
    if (ipBlocked(address)) throw new Error("blocked resolved IP");
  }
}

export async function safeFetch(rawUrl: string): Promise<SafeFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let url = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return fail("invalid URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("scheme not allowed");
      await assertHostAllowed(parsed.hostname); // revalidate every hop

      const res = await fetch(parsed.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "ArtifexOutreachBot/1.0 (+https://artifexlabs.tech)", Accept: "text/html,image/*" },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return fail("redirect without location");
        url = new URL(loc, parsed).toString();
        if (hop === MAX_REDIRECTS) return fail("too many redirects");
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (BLOCKED_MIME.some((re) => re.test(contentType))) return fail("disallowed content type");
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) return fail("response too large");

      // Read with a hard byte cap.
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) {
            reader.cancel();
            return fail("response exceeded size cap");
          }
          chunks.push(value);
        }
      }
      const body = new TextDecoder().decode(concat(chunks)).slice(0, MAX_BYTES);
      return { ok: res.ok, status: res.status, contentType, body, finalUrl: parsed.toString() };
    }
    return fail("too many redirects");
  } catch (err: any) {
    return fail(err?.name === "AbortError" ? "timeout" : "fetch blocked");
  } finally {
    clearTimeout(timer);
  }
}

function fail(error: string): SafeFetchResult {
  return { ok: false, status: 0, contentType: "", body: "", finalUrl: "", error };
}
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

// Exposed for unit tests.
export const _internal = { ipBlocked, ipv4Blocked, ipv6Blocked };

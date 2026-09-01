// Content Studio — SSRF guard (section G). The screenshot worker captures REAL external business
// websites, so an operator- or redirect-supplied URL is UNTRUSTED input. This module is the single,
// pure, unit-tested authority on "is this address safe to fetch": scheme allow-list, no credentials,
// and — critically — a classifier that rejects private, loopback, link-local, cloud-metadata, reserved,
// CGNAT, multicast, and documentation ranges (IPv4 AND IPv6, including IPv4-mapped/NAT64 wrappers).
//
// The worker MUST call `classifyIp` on every DNS-resolved address BEFORE connecting, and re-run the
// whole check on every redirect Location — that is what closes DNS-rebinding: a name that resolved
// public once is revalidated (freshly resolved) at each hop, so a rebind to 169.254.169.254 is caught.
//
// Nothing here performs I/O; DNS resolution is injected by the caller so this file stays deterministic
// and testable. Keep it dependency-free.

export type BlockCategory =
  | "scheme"
  | "credentials"
  | "malformed"
  | "loopback"
  | "private"
  | "link-local"
  | "metadata"
  | "cgnat"
  | "multicast"
  | "reserved"
  | "unspecified"
  | "documentation";

export interface IpVerdict {
  ok: boolean;
  category?: BlockCategory;
  reason?: string;
}

// ── IPv4 ────────────────────────────────────────────────────────────────────
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}
const cidr4 = (base: string, bits: number): [number, number] => {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [(b & mask) >>> 0, mask]; // keep base unsigned so it matches the unsigned compare below
};
// Every non-globally-routable IPv4 block, tagged with why. 169.254.169.254 (cloud metadata) lives inside
// link-local; we surface it as its own category for an honest audit trail.
const V4_BLOCKS: Array<{ net: [number, number]; category: BlockCategory }> = [
  { net: cidr4("0.0.0.0", 8), category: "unspecified" },
  { net: cidr4("10.0.0.0", 8), category: "private" },
  { net: cidr4("100.64.0.0", 10), category: "cgnat" },
  { net: cidr4("127.0.0.0", 8), category: "loopback" },
  { net: cidr4("169.254.0.0", 16), category: "link-local" },
  { net: cidr4("172.16.0.0", 12), category: "private" },
  { net: cidr4("192.0.0.0", 24), category: "reserved" },
  { net: cidr4("192.0.2.0", 24), category: "documentation" },
  { net: cidr4("192.88.99.0", 24), category: "reserved" },
  { net: cidr4("192.168.0.0", 16), category: "private" },
  { net: cidr4("198.18.0.0", 15), category: "reserved" },
  { net: cidr4("198.51.100.0", 24), category: "documentation" },
  { net: cidr4("203.0.113.0", 24), category: "documentation" },
  { net: cidr4("224.0.0.0", 4), category: "multicast" },
  { net: cidr4("240.0.0.0", 4), category: "reserved" },
];
const META_V4 = ipv4ToInt("169.254.169.254")!;

function classifyIpv4(ip: string): IpVerdict {
  const n = ipv4ToInt(ip);
  if (n === null) return { ok: false, category: "malformed", reason: `not a valid IPv4: ${ip}` };
  if (n === META_V4) return { ok: false, category: "metadata", reason: "cloud metadata endpoint 169.254.169.254" };
  for (const { net, category } of V4_BLOCKS) {
    const [base, mask] = net;
    if ((n & mask) >>> 0 === base) return { ok: false, category, reason: `IPv4 ${ip} is in a ${category} range` };
  }
  return { ok: true };
}

// ── IPv6 ────────────────────────────────────────────────────────────────────
// Expand to 8 hextets (numbers). Handles :: compression and a trailing IPv4 (mapped/NAT64). Null on junk.
export function expandIpv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  s = s.replace(/%.*$/, ""); // strip zone id
  if (!s.includes(":")) return null;
  // trailing embedded IPv4 → two hextets
  let tail: number[] = [];
  const v4m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4m) {
    const n = ipv4ToInt(v4m[1]);
    if (n === null) return null;
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    s = s.slice(0, v4m.index).replace(/:$/, ":");
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const parse = (chunk: string): number[] | null => {
    if (chunk === "") return [];
    const out: number[] = [];
    for (const h of chunk.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = parse(parts[0]);
  const rest = parts.length === 2 ? parse(parts[1]) : null;
  if (head === null || (parts.length === 2 && rest === null)) return null;
  let hextets: number[];
  if (parts.length === 2) {
    const mid = 8 - head.length - (rest!.length + tail.length);
    if (mid < 0) return null;
    hextets = [...head, ...Array(mid).fill(0), ...rest!, ...tail];
  } else {
    hextets = [...head, ...tail];
  }
  if (hextets.length !== 8) return null;
  return hextets;
}

function classifyIpv6(ip: string): IpVerdict {
  const h = expandIpv6(ip);
  if (!h) return { ok: false, category: "malformed", reason: `not a valid IPv6: ${ip}` };
  const isZero = (from: number) => h.slice(from).every((x) => x === 0);
  // ::  unspecified
  if (h.every((x) => x === 0)) return { ok: false, category: "unspecified", reason: "IPv6 unspecified ::" };
  // ::1 loopback
  if (h[7] === 1 && isZero(0) === false && h.slice(0, 7).every((x) => x === 0)) return { ok: false, category: "loopback", reason: "IPv6 loopback ::1" };
  // IPv4-mapped ::ffff:a.b.c.d  → classify the embedded v4
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const v = classifyIpv4([(h[6] >> 8) & 0xff, h[6] & 0xff, (h[7] >> 8) & 0xff, h[7] & 0xff].join("."));
    return v.ok ? v : { ok: false, category: v.category, reason: `IPv4-mapped ${v.reason}` };
  }
  // NAT64 64:ff9b::/96 → embedded v4
  if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    const v = classifyIpv4([(h[6] >> 8) & 0xff, h[6] & 0xff, (h[7] >> 8) & 0xff, h[7] & 0xff].join("."));
    return v.ok ? v : { ok: false, category: v.category, reason: `NAT64 ${v.reason}` };
  }
  const first = h[0];
  if ((first & 0xff00) === 0xff00) return { ok: false, category: "multicast", reason: "IPv6 multicast ff00::/8" };
  if ((first & 0xffc0) === 0xfe80) return { ok: false, category: "link-local", reason: "IPv6 link-local fe80::/10" };
  if ((first & 0xfe00) === 0xfc00) return { ok: false, category: "private", reason: "IPv6 unique-local fc00::/7" };
  if ((first & 0xffc0) === 0xfec0) return { ok: false, category: "link-local", reason: "IPv6 deprecated site-local fec0::/10" };
  if (first === 0x2001 && h[1] === 0x0db8) return { ok: false, category: "documentation", reason: "IPv6 documentation 2001:db8::/32" };
  return { ok: true };
}

// The single classifier the worker calls on EVERY resolved address (initial + each redirect hop).
export function classifyIp(ip: string): IpVerdict {
  const t = ip.trim();
  if (t.includes(":")) return classifyIpv6(t);
  return classifyIpv4(t);
}

// ── URL normalization ─────────────────────────────────────────────────────────
export interface UrlVerdict {
  ok: boolean;
  url?: URL;
  hostname?: string;
  category?: BlockCategory;
  reason?: string;
}

// Parse + shape-check a candidate capture URL. HTTP/HTTPS only, no embedded credentials, a real host.
// If the host is already a literal IP, classify it here (no DNS needed). Hostnames are resolved by the
// caller and each address passed to classifyIp.
export function normalizeCaptureUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, category: "malformed", reason: "unparseable URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, category: "scheme", reason: `scheme ${url.protocol} not allowed (http/https only)` };
  if (url.username || url.password)
    return { ok: false, category: "credentials", reason: "embedded credentials are not allowed" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, category: "malformed", reason: "no host" };
  // A bare "localhost" (and common local aliases) never resolves through the public path — reject early.
  if (/^(localhost|localhost\.localdomain|.*\.local|.*\.internal|.*\.localhost)$/i.test(host))
    return { ok: false, category: "loopback", reason: `local hostname ${host}` };
  // Literal IP host: classify without DNS.
  const asIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (asIp) {
    const v = classifyIp(host);
    if (!v.ok) return { ok: false, category: v.category, reason: v.reason };
  }
  return { ok: true, url, hostname: host };
}

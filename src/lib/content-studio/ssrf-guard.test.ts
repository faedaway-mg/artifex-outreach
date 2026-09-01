import { describe, it, expect } from "vitest";
import { classifyIp, normalizeCaptureUrl, expandIpv6 } from "./ssrf-guard";
// Plain-JS worker mirror (no types); imported only to assert behaviour parity.
import * as mjs from "../../../scripts/lib/ssrf-guard.mjs";

describe("SSRF IPv4 classifier (section G)", () => {
  it("allows real public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "142.250.72.14"]) {
      expect(classifyIp(ip).ok, ip).toBe(true);
    }
  });

  it("blocks the cloud metadata endpoint specifically", () => {
    const v = classifyIp("169.254.169.254");
    expect(v.ok).toBe(false);
    expect(v.category).toBe("metadata");
  });

  it("blocks loopback, private, link-local, CGNAT, multicast, reserved, documentation", () => {
    const cases: Array<[string, string]> = [
      ["127.0.0.1", "loopback"],
      ["127.5.6.7", "loopback"],
      ["10.0.0.1", "private"],
      ["172.16.9.9", "private"],
      ["172.31.255.255", "private"],
      ["192.168.1.1", "private"],
      ["169.254.10.20", "link-local"],
      ["100.100.100.200", "cgnat"], // Alibaba metadata lives in CGNAT
      ["224.0.0.1", "multicast"],
      ["240.0.0.1", "reserved"],
      ["255.255.255.255", "reserved"],
      ["0.0.0.0", "unspecified"],
      ["192.0.2.5", "documentation"],
      ["198.51.100.5", "documentation"],
      ["203.0.113.5", "documentation"],
      ["198.18.0.1", "reserved"],
    ];
    for (const [ip, cat] of cases) {
      const v = classifyIp(ip);
      expect(v.ok, ip).toBe(false);
      expect(v.category, ip).toBe(cat);
    }
  });

  it("just-outside-boundary public addresses are allowed", () => {
    expect(classifyIp("11.0.0.1").ok).toBe(true); // just past 10/8
    expect(classifyIp("172.32.0.1").ok).toBe(true); // just past 172.16/12
    expect(classifyIp("100.128.0.1").ok).toBe(true); // just past 100.64/10 CGNAT
    expect(classifyIp("169.253.0.1").ok).toBe(true); // just before link-local
  });
});

describe("SSRF IPv6 classifier (section G)", () => {
  it("expands compressed and IPv4-embedded forms", () => {
    expect(expandIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6("::ffff:169.254.169.254")).toEqual([0, 0, 0, 0, 0, 0xffff, 0xa9fe, 0xa9fe]);
  });

  it("blocks loopback, unspecified, ULA, link-local, multicast, and IPv4-mapped metadata", () => {
    const cases: Array<[string, string]> = [
      ["::1", "loopback"],
      ["::", "unspecified"],
      ["fc00::1", "private"],
      ["fd12:3456::1", "private"],
      ["fe80::1", "link-local"],
      ["ff02::1", "multicast"],
      ["2001:db8::1", "documentation"],
      ["::ffff:127.0.0.1", "loopback"], // IPv4-mapped loopback
      ["::ffff:169.254.169.254", "metadata"], // IPv4-mapped metadata
      ["64:ff9b::10.0.0.1", "private"], // NAT64-wrapped private
    ];
    for (const [ip, cat] of cases) {
      const v = classifyIp(ip);
      expect(v.ok, ip).toBe(false);
      expect(v.category, ip).toBe(cat);
    }
  });

  it("allows a real public IPv6", () => {
    expect(classifyIp("2606:4700:4700::1111").ok).toBe(true); // Cloudflare
  });
});

describe("capture URL normalization (section G)", () => {
  it("accepts a normal https business site", () => {
    const v = normalizeCaptureUrl("https://silverinthecity.com/");
    expect(v.ok).toBe(true);
    expect(v.hostname).toBe("silverinthecity.com");
  });

  it("rejects non-http(s) schemes", () => {
    for (const u of ["file:///etc/passwd", "gopher://x", "ftp://x", "data:text/html,x"]) {
      const v = normalizeCaptureUrl(u);
      expect(v.ok, u).toBe(false);
      expect(v.category, u).toBe("scheme");
    }
  });

  it("rejects embedded credentials (a common SSRF smuggle)", () => {
    const v = normalizeCaptureUrl("https://user:pass@evil.example.com/");
    expect(v.ok).toBe(false);
    expect(v.category).toBe("credentials");
  });

  it("rejects localhost and internal hostnames without DNS", () => {
    for (const u of ["http://localhost/", "http://foo.internal/", "http://svc.local/"]) {
      expect(normalizeCaptureUrl(u).ok, u).toBe(false);
    }
  });

  it("rejects a literal private/metadata IP host up-front", () => {
    expect(normalizeCaptureUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
    expect(normalizeCaptureUrl("http://127.0.0.1:8080/").ok).toBe(false);
    expect(normalizeCaptureUrl("http://[::1]/").ok).toBe(false);
  });
});

// The worker runs a plain-JS mirror of this guard; a drift between them would be a silent security hole.
describe("worker .mjs mirror stays behaviour-identical to the TS guard", () => {
  const IPS = [
    "1.1.1.1", "8.8.8.8", "169.254.169.254", "127.0.0.1", "10.0.0.1", "172.16.9.9",
    "192.168.1.1", "100.100.100.200", "224.0.0.1", "255.255.255.255", "::1", "::",
    "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:169.254.169.254", "2606:4700:4700::1111",
  ];
  it("classifyIp verdicts match for every address", () => {
    for (const ip of IPS) {
      const a = classifyIp(ip), b = mjs.classifyIp(ip);
      expect(b.ok, ip).toBe(a.ok);
      expect(b.category, ip).toBe(a.category);
    }
  });
  it("normalizeCaptureUrl verdicts match", () => {
    for (const u of ["https://silverinthecity.com/", "file:///etc/passwd", "https://u:p@x.com/", "http://localhost/", "http://169.254.169.254/"]) {
      expect(mjs.normalizeCaptureUrl(u).ok, u).toBe(normalizeCaptureUrl(u).ok);
    }
  });
});

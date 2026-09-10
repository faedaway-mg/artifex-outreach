import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const STRONG = "breakbot-test-secret-0123456789";

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/auth/test-session", { method: "POST", headers });
}

afterEach(() => { delete process.env.BREAKBOT_TEST_AUTH; });

describe("test-only session route (§4)", () => {
  it("is DISABLED (403) when BREAKBOT_TEST_AUTH is unset — inert in real production", async () => {
    const res = await POST(req({ "x-test-auth": STRONG }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a weak (<16 char) secret", async () => {
    process.env.BREAKBOT_TEST_AUTH = "short";
    const res = await POST(req({ "x-test-auth": "short" }));
    expect(res.status).toBe(403);
  });

  it("rejects a wrong secret (401)", async () => {
    process.env.BREAKBOT_TEST_AUTH = STRONG;
    const res = await POST(req({ "x-test-auth": "wrong-secret-0123456789" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("mints a genuine session cookie for the fixed test operator on the correct secret", async () => {
    process.env.BREAKBOT_TEST_AUTH = STRONG;
    const res = await POST(req({ "x-test-auth": STRONG }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, operatorId: "breakbot-test" });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("artifex_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared test harness for the compliant Resend cold-outreach transport. NOT imported by any app code
// (only *.test.ts import it), vitest-free. It provides the env (transport configured + footer
// assemblable + prospect delivery enabled so dispatch-logic tests can send to arbitrary seeded lead
// addresses) and a fetch double for Resend's single POST /emails endpoint.
// ─────────────────────────────────────────────────────────────────────────────

/** Env the compliant Resend path needs: RESEND configured, compliant footer assemblable, prospect
 *  delivery enabled (so dispatch-logic tests can send to arbitrary seeded lead addresses). */
export const RESEND_TEST_ENV: Record<string, string> = {
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "Artifex Labs <hello@artifexlabs.tech>",
  COMMS_POSTAL_ADDRESS: "Artifex Labs Systems LLC, 1 Market St, San Francisco, CA 94105",
  COMMS_UNSUBSCRIBE_SECRET: "test-unsubscribe-secret",
  PUBLIC_BASE_URL: "https://app.artifexlabs.tech",
  COMMS_PROSPECT_DELIVERY_ENABLED: "1",
};

export function configureResendTestEnv(over: Record<string, string> = {}): void {
  Object.assign(process.env, RESEND_TEST_ENV, over);
}
export function clearResendTestEnv(): void {
  for (const k of Object.keys(RESEND_TEST_ENV)) delete process.env[k];
}

export interface ResendFetchCalls { send: number; all: number; bodies: string[] }

/**
 * A fetch double for Resend's POST /emails. `send(n)` returns the HTTP status for the n-th send
 * (1-based, default 200), or { throw: true } to simulate a network fault (→ ambiguous). Success
 * responses carry `{ id: "resend-<n>" }` (the real provider message id the send records). Resend makes
 * exactly ONE call per send (no token endpoint), so `calls.send` is the outbound-message count.
 */
export function resendFetch(opts: { send?: (n: number) => number | { throw: true } } = {}): { fn: typeof fetch; calls: ResendFetchCalls } {
  const calls: ResendFetchCalls = { send: 0, all: 0, bodies: [] };
  const status = opts.send ?? (() => 200);
  const fn = (async (_url: any, init?: any) => {
    calls.all++;
    calls.send++;
    calls.bodies.push(typeof init?.body === "string" ? init.body : "");
    const r = status(calls.send);
    if (typeof r === "object" && "throw" in r) throw new Error("simulated network fault");
    return { ok: r < 400, status: r, json: async () => ({ id: `resend-${calls.send}` }), text: async () => `status ${r}` };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Parse the JSON body of the n-th (1-based) Resend /emails POST — for asserting message contents
 *  (from/to/subject/text/html/headers/attachments). */
export function sentBody(calls: ResendFetchCalls, n = 1): any {
  try { return JSON.parse(calls.bodies[n - 1] ?? "{}"); } catch { return {}; }
}

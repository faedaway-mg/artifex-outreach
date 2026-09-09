// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX STRIPE MODE — explicit TEST vs LIVE separation for the Quick-Fix
// checkout, independent of the legacy deposit flow (which keeps STRIPE_SECRET_KEY).
//
//   TEST  → STRIPE_TEST_KEY   (sandbox) → sandbox webhook secret
//   LIVE  → STRIPE_SECRET_KEY (approved live path) → live webhook secret
//
// The key used to CREATE a Checkout Session and the webhook receiving its events
// must be the SAME mode. This module resolves the key by mode and fails closed on a
// mode/prefix mismatch. SECRET SAFETY: it never logs/returns a key value in any
// diagnostic — only booleans + the resolved mode. The raw key is handed ONLY to the
// checkout client for the Authorization header.
// ─────────────────────────────────────────────────────────────────────────────

export type StripeMode = "test" | "live";

const present = (v: string | undefined | null): boolean => typeof v === "string" && v.trim().length > 0;

/** Classify a key by its PREFIX only (never logs/returns the key). */
export function stripeKeyMode(key: string | undefined | null): StripeMode | "unknown" {
  const k = (key ?? "").trim();
  if (/^(sk|rk)_test_/.test(k)) return "test";
  if (/^(sk|rk)_live_/.test(k)) return "live";
  return "unknown";
}

/** The configured Quick-Fix Stripe mode. Defaults to TEST (safe — no live charge)
 *  until an operator explicitly sets STRIPE_QUICKFIX_MODE=live. */
export function quickFixStripeMode(env: NodeJS.ProcessEnv = process.env): StripeMode {
  return env.STRIPE_QUICKFIX_MODE === "live" ? "live" : "test";
}

export interface KeyResolution {
  ok: boolean;
  /** INTERNAL — the secret key, present only when ok. Never log/serialize. */
  key?: string;
  mode: StripeMode;
  reason?: string;
}

/** Resolve the Quick-Fix Stripe secret key for a mode. Fails closed if the key is
 *  missing or its prefix does not match the requested mode (prevents a live key from
 *  being used under test, or vice-versa). */
export function resolveQuickFixStripeKey(env: NodeJS.ProcessEnv, mode: StripeMode): KeyResolution {
  const key = mode === "live" ? env.STRIPE_SECRET_KEY : env.STRIPE_TEST_KEY;
  if (!present(key)) return { ok: false, mode, reason: `Quick-Fix ${mode} Stripe key is not configured` };
  const prefix = stripeKeyMode(key);
  if (prefix !== "unknown" && prefix !== mode) {
    return { ok: false, mode, reason: `configured key mode (${prefix}) does not match requested mode (${mode})` };
  }
  return { ok: true, key: key!.trim(), mode };
}

export function quickFixStripeConfigured(env: NodeJS.ProcessEnv = process.env, mode: StripeMode = quickFixStripeMode(env)): boolean {
  return resolveQuickFixStripeKey(env, mode).ok;
}

export interface StripeModeDiagnostics {
  mode: StripeMode;
  stripeTestKeyConfigured: boolean;
  stripeLiveKeyConfigured: boolean;
  activeModeKeyConfigured: boolean;
}

/** Booleans only — safe for diagnostics. */
export function stripeModeDiagnostics(env: NodeJS.ProcessEnv = process.env): StripeModeDiagnostics {
  const mode = quickFixStripeMode(env);
  return {
    mode,
    stripeTestKeyConfigured: present(env.STRIPE_TEST_KEY),
    stripeLiveKeyConfigured: present(env.STRIPE_SECRET_KEY),
    activeModeKeyConfigured: quickFixStripeConfigured(env, mode),
  };
}

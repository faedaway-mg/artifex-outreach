// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX WEBHOOK SECRETS — mode-aware signature verification.
//
//   TEST events  verify against STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST
//                (legacy STRIPE_QUICKFIX_WEBHOOK_SECRET is a TEST-only fallback).
//   LIVE events  verify against STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE — and NEVER
//                fall back to the test/legacy secret.
//
// CRITICAL: event.livemode is NOT trusted before verification. The route verifies
// the signature first (which secret verified → which mode), and only then requires
// event.livemode to AGREE with the verifying secret's mode. SECRET SAFETY: no whsec
// value is ever logged/returned; only booleans + the resolved mode leave here.
// ─────────────────────────────────────────────────────────────────────────────
import { verifyStripeSignature } from "./webhook";
import type { StripeMode } from "./stripe-mode";

const present = (v: string | undefined | null): boolean => typeof v === "string" && v.trim().length > 0;

interface SecretCandidate { mode: StripeMode; secret: string; legacy: boolean }

/** INTERNAL — the ordered secret candidates to try. Test first (incl. legacy
 *  fallback ONLY for test), then live. Never exposed. */
function candidates(env: NodeJS.ProcessEnv): SecretCandidate[] {
  const out: SecretCandidate[] = [];
  const test = env.STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST;
  const legacy = env.STRIPE_QUICKFIX_WEBHOOK_SECRET; // legacy = TEST-only fallback during migration
  const live = env.STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE;
  if (present(test)) out.push({ mode: "test", secret: test!.trim(), legacy: false });
  else if (present(legacy)) out.push({ mode: "test", secret: legacy!.trim(), legacy: true }); // LIVE never uses this
  if (present(live)) out.push({ mode: "live", secret: live!.trim(), legacy: false });
  return out;
}

export interface WebhookVerifyResult {
  ok: boolean;
  mode?: StripeMode;
  usedLegacy?: boolean;
  reason?: string;
}

/** Verify the signature against every configured secret; the one that verifies
 *  determines the mode. Returns which mode verified (never the secret). */
export function verifyConfiguredWebhook(args: { payload: string; header: string | null; nowSec: number; env?: NodeJS.ProcessEnv }): WebhookVerifyResult {
  const env = args.env ?? process.env;
  const cands = candidates(env);
  if (cands.length === 0) return { ok: false, reason: "no Quick-Fix webhook secret configured" };
  if (!args.header) return { ok: false, reason: "missing signature header" };
  for (const c of cands) {
    const v = verifyStripeSignature({ payload: args.payload, header: args.header, secret: c.secret, nowSec: args.nowSec });
    if (v.ok) return { ok: true, mode: c.mode, usedLegacy: c.legacy };
  }
  return { ok: false, reason: "signature did not verify against any configured secret" };
}

/**
 * After signature verification, require event.livemode to agree with the verifying
 * secret's mode. livemode is only consulted HERE — post-verification. Mismatch is
 * rejected (a live-signed event claiming test, or vice-versa, cannot proceed).
 */
export function livemodeAgrees(verifiedMode: StripeMode, eventLivemode: unknown): boolean {
  const isLive = eventLivemode === true;
  return verifiedMode === "live" ? isLive : !isLive;
}

export interface WebhookSecretPresence {
  testWebhookSecretConfigured: boolean;
  liveWebhookSecretConfigured: boolean;
  legacyWebhookSecretPresent: boolean;
}

/** Booleans only — safe for diagnostics. */
export function webhookSecretPresence(env: NodeJS.ProcessEnv = process.env): WebhookSecretPresence {
  return {
    testWebhookSecretConfigured: present(env.STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST) || present(env.STRIPE_QUICKFIX_WEBHOOK_SECRET),
    liveWebhookSecretConfigured: present(env.STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE),
    legacyWebhookSecretPresent: present(env.STRIPE_QUICKFIX_WEBHOOK_SECRET),
  };
}

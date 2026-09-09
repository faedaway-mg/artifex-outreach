// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE WORKSPACE TRANSPORT — configuration PRESENCE checks only.
//
// SECRET SAFETY: this module NEVER returns, logs, or serializes any secret value
// (client secret, refresh tokens, access tokens). It reports booleans and the
// non-secret sender addresses only. Nothing here performs network I/O.
// ─────────────────────────────────────────────────────────────────────────────

export type PrimaryTransport = "google" | "resend";

/** The configured primary outbound transport. Defaults to `resend` (current
 *  behavior) until an operator explicitly flips OUTREACH_PRIMARY_TRANSPORT=google.
 *  There is NO automatic failover between them — a transport failure stays visible. */
export function primaryTransport(env: NodeJS.ProcessEnv = process.env): PrimaryTransport {
  return env.OUTREACH_PRIMARY_TRANSPORT === "google" ? "google" : "resend";
}

function present(v: string | undefined | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** True when the OAuth app + at least one full sender (address + refresh token) exist. */
export function googleTransportConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!present(env.GOOGLE_OAUTH_CLIENT_ID) || !present(env.GOOGLE_OAUTH_CLIENT_SECRET)) return false;
  const s1 = present(env.GOOGLE_WORKSPACE_SENDER_1) && present(env.GOOGLE_WORKSPACE_REFRESH_TOKEN_1);
  const s2 = present(env.GOOGLE_WORKSPACE_SENDER_2) && present(env.GOOGLE_WORKSPACE_REFRESH_TOKEN_2);
  return s1 || s2;
}

export interface SenderPresence {
  id: string;
  /** The non-secret mailbox address (safe to show). */
  address: string | null;
  refreshTokenConfigured: boolean;
}

export interface GoogleConfigPresence {
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  senders: SenderPresence[];
  configuredSenderCount: number;
  transportConfigured: boolean;
  primary: PrimaryTransport;
}

/** Booleans + non-secret addresses ONLY — safe for diagnostics/operator display. */
export function googleConfigPresence(env: NodeJS.ProcessEnv = process.env): GoogleConfigPresence {
  const senders: SenderPresence[] = [
    { id: "sender-1", address: present(env.GOOGLE_WORKSPACE_SENDER_1) ? env.GOOGLE_WORKSPACE_SENDER_1!.trim() : null, refreshTokenConfigured: present(env.GOOGLE_WORKSPACE_REFRESH_TOKEN_1) },
    { id: "sender-2", address: present(env.GOOGLE_WORKSPACE_SENDER_2) ? env.GOOGLE_WORKSPACE_SENDER_2!.trim() : null, refreshTokenConfigured: present(env.GOOGLE_WORKSPACE_REFRESH_TOKEN_2) },
  ];
  const configuredSenderCount = senders.filter((s) => s.address && s.refreshTokenConfigured).length;
  return {
    clientIdConfigured: present(env.GOOGLE_OAUTH_CLIENT_ID),
    clientSecretConfigured: present(env.GOOGLE_OAUTH_CLIENT_SECRET),
    senders,
    configuredSenderCount,
    transportConfigured: googleTransportConfigured(env),
    primary: primaryTransport(env),
  };
}

/** Per-sender daily cap (stacks UNDER the global outreach cap, never replaces it).
 *  Conservative default; initial production behavior is not volume-maximizing. */
export function senderDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.GOOGLE_SENDER_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
}

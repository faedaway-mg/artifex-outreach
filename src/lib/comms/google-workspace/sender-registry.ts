// ─────────────────────────────────────────────────────────────────────────────
// SENDER REGISTRY — the explicit, server-controlled set of approved Workspace
// senders. Browser/client input can NEVER introduce or select a From address;
// only a sender resolved here may be used, and only its non-secret address is ever
// exposed. `SenderCredential` (which holds the refresh token) is internal and is
// consumed ONLY by the Gmail transport inside the canonical send boundary.
// ─────────────────────────────────────────────────────────────────────────────
import { ARTIFEX_IDENTITY } from "../../identity";

/** Non-secret view of a sender (safe to expose). */
export interface SenderPublic {
  id: string;
  address: string;
  refreshTokenConfigured: boolean;
}

/** INTERNAL — carries the refresh token. Never log/serialize/expose. */
export interface SenderCredential {
  id: string;
  address: string;
  /** RFC5322 From header, e.g. `Artifex Labs <jordan@…>`. */
  fromHeader: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const trim = (v: string | undefined | null): string => (typeof v === "string" ? v.trim() : "");

const SLOTS: Array<{ id: string; addrKey: keyof NodeJS.ProcessEnv; tokKey: keyof NodeJS.ProcessEnv }> = [
  { id: "sender-1", addrKey: "GOOGLE_WORKSPACE_SENDER_1", tokKey: "GOOGLE_WORKSPACE_REFRESH_TOKEN_1" },
  { id: "sender-2", addrKey: "GOOGLE_WORKSPACE_SENDER_2", tokKey: "GOOGLE_WORKSPACE_REFRESH_TOKEN_2" },
];

function fromHeaderFor(address: string): string {
  return `${ARTIFEX_IDENTITY.companyName} <${address}>`;
}

/** Configured sender ids (both address AND refresh token present). */
export function configuredSenderIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return SLOTS.filter((s) => trim(env[s.addrKey]) && trim(env[s.tokKey])).map((s) => s.id);
}

/** Non-secret public view of every configured sender. */
export function listSenderPublic(env: NodeJS.ProcessEnv = process.env): SenderPublic[] {
  return SLOTS
    .map((s) => ({ id: s.id, address: trim(env[s.addrKey]), refreshTokenConfigured: !!trim(env[s.tokKey]) }))
    .filter((s) => s.address)
    .map((s) => ({ id: s.id, address: s.address, refreshTokenConfigured: s.refreshTokenConfigured }));
}

/** Resolve the full credential for a sender id. INTERNAL — transport use only.
 *  Returns null if the sender or the OAuth app is not fully configured. */
export function resolveSenderCredential(id: string, env: NodeJS.ProcessEnv = process.env): SenderCredential | null {
  const slot = SLOTS.find((s) => s.id === id);
  if (!slot) return null;
  const address = trim(env[slot.addrKey]);
  const refreshToken = trim(env[slot.tokKey]);
  const clientId = trim(env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = trim(env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (!address || !refreshToken || !clientId || !clientSecret) return null;
  return { id, address, fromHeader: fromHeaderFor(address), clientId, clientSecret, refreshToken };
}

/** True when a From header names an approved, configured sender address. Used to
 *  reject any attempt to send as an unconfigured/spoofed identity. */
export function isApprovedSenderFrom(from: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const m = from.match(/<([^>]+)>/);
  const addr = (m ? m[1] : from).trim().toLowerCase();
  return listSenderPublic(env).some((s) => s.address.toLowerCase() === addr);
}

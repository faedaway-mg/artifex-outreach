// ─────────────────────────────────────────────────────────────────────────────
// In-process FAKE e-signature provider — a test double for the UI click-through
// rehearsal ONLY. It makes NO network call and returns a deterministic synthetic
// document id, so the full approve → authorize → send flow can be exercised through
// the real UI + real server actions + real store without ever touching SignWell.
//
// SAFETY: this provider is returned by getEsignProvider() only when the env flag
// ESIGN_FAKE_PROVIDER is truthy AND the runtime is NOT production (NODE_ENV !==
// "production"). Both conditions are required, so it can never be selected on a
// production deployment. It also refuses to activate if a real SIGNWELL_API_KEY is
// present, so it can never shadow a configured live provider.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { EsignProvider, CreateSignatureRequestInput, CreateSignatureRequestResult } from "./provider";

/** Deterministic synthetic document id derived from the agreement (stable per agreement). */
function fakeRequestId(input: CreateSignatureRequestInput): string {
  const h = createHash("sha256").update(`fake:${input.agreementId}:${input.agreementNumber}`).digest("hex").slice(0, 24);
  return `fake_doc_${h}`;
}

export const fakeEsignProvider: EsignProvider = {
  name: "fake",
  canSend: true,
  meta: { name: "fake", mode: "disabled", configured: true },
  async createSignatureRequest(input: CreateSignatureRequestInput): Promise<CreateSignatureRequestResult> {
    // No network. A synthetic, deterministic "document" — never a real SignWell doc.
    const requestId = fakeRequestId(input);
    return { ok: true, requestId, signingUrl: `about:blank#${requestId}` };
  },
  async healthCheck() {
    return { ok: true, issues: [] };
  },
};

/** True only when the guarded rehearsal double should be used (dev/rehearsal only). */
export function shouldUseFakeEsignProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.ESIGN_FAKE_PROVIDER ?? "").trim().toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  const notProd = (env.NODE_ENV ?? "development") !== "production";
  const noLiveKey = !env.SIGNWELL_API_KEY;
  return on && notProd && noLiveKey;
}

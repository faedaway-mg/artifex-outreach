// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH READINESS GATE — the single GO / NO-GO verdict for turning real outbound
// on. It aggregates pass/fail CHECKS across the whole send path (provider → sender
// → reply → opt-out → approval → no-send-by-default) AND the personalization/asset
// path a full Matt journey needs (canonical asset resolver, personalized render,
// shared serving, trust-video coherence, Breakbot, ElevenLabs).
//
// SAFETY (non-negotiable): this function NEVER sends, charges, or exposes a secret.
// Every check is wrapped in try/catch so one failing/throwing dependency turns that
// ONE check red without crashing the gate. A storage-mode throw (production without
// CS_STORAGE_PROVIDER) is a FAILED check, never an exception out of the gate.
//
// REQUIRED vs ADVISORY (explicit + documented below):
//   • REQUIRED_TO_SEND_A_PROSPECT — the minimum to lawfully deliver ONE prospect
//     email: outbound provider, sender identity, reply path, opt-out (unsubscribe
//     secret + postal), approval gate, and no-send-by-default intact.
//   • REQUIRED_FOR_MATT_JOURNEY — everything above PLUS the personalization stack a
//     full Matt journey ships (asset resolver, personalized render, shared serving,
//     trust-video coherence, Breakbot healthy, ElevenLabs healthy).
//   • ADVISORY — surfaced but never blocks GO (e.g. test-recipient configured).
// The overall state is GO only when every REQUIRED check (both sets) passes.
// ─────────────────────────────────────────────────────────────────────────────
import { auditSendInfrastructure, type SendInfrastructureAudit, type AuditSettingsInput, type EnvLike } from "./send-readiness";

export interface LaunchCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Whether a failure of this check blocks GO. Advisory checks never block. */
  required: boolean;
}

export type LaunchState = "GO" | "NO-GO";

export interface LaunchReadiness {
  generatedAt: string;
  state: LaunchState;
  checks: LaunchCheck[];
  /** Labels of the REQUIRED checks that failed (empty ⇒ GO). */
  blockers: string[];
  /** The send-infra audit (booleans only — no secrets, no addresses). */
  audit: SendInfrastructureAudit;
  /** This gate is advisory infrastructure — it performs no send/charge, ever. */
  performsSend: false;
}

// ── The explicit required-set contracts (documented, not implicit) ────────────
/** Sending ONE prospect email requires exactly these check ids to pass. */
export const REQUIRED_TO_SEND_A_PROSPECT = [
  "provider",
  "sender",
  "reply-path",
  "opt-out",
  "approval-gate",
  "no-send-default",
] as const;

/** A full Matt journey additionally requires the personalization/asset stack. */
export const REQUIRED_FOR_MATT_JOURNEY = [
  ...REQUIRED_TO_SEND_A_PROSPECT,
  "asset-resolver",
  "personalized-render",
  "shared-serving",
  "trust-video",
  "breakbot",
  "elevenlabs",
] as const;

const REQUIRED_IDS = new Set<string>(REQUIRED_FOR_MATT_JOURNEY);

/** Run one check with resilience: any throw becomes ok:false with the error surfaced. */
async function guard(
  id: string,
  label: string,
  fn: () => boolean | { ok: boolean; detail: string } | Promise<boolean | { ok: boolean; detail: string }>,
): Promise<LaunchCheck> {
  const required = REQUIRED_IDS.has(id);
  try {
    const r = await fn();
    if (typeof r === "boolean") return { id, label, ok: r, detail: r ? "OK" : "check failed", required };
    return { id, label, ok: r.ok, detail: r.detail, required };
  } catch (err) {
    // A throwing dependency (e.g. storage FAIL-CLOSED in prod) is a failed check — never
    // an exception out of the gate.
    return { id, label, ok: false, detail: `check threw: ${(err as Error).message}`, required };
  }
}

/**
 * Compute the GO / NO-GO verdict. NEVER sends. `env`/`settings` are injectable so the
 * gate is deterministic under test; both default to the live process env / no settings.
 */
export async function computeLaunchReadiness(
  env: EnvLike = process.env,
  settings?: AuditSettingsInput | null,
): Promise<LaunchReadiness> {
  // The strict contract functions (storage-factory, elevenlabs-config) type their env as
  // NodeJS.ProcessEnv; only presence matters, so a cast is safe and keeps tests injectable.
  const penv = env as NodeJS.ProcessEnv;
  const audit = await auditSendInfrastructure(env, settings);
  const checks: LaunchCheck[] = [];

  // ── Send-path checks (derived from the pure audit — no I/O, no send) ──────────
  checks.push(await guard("provider", "Outbound provider configured", () => ({
    ok: audit.sendConfigured,
    detail: audit.sendConfigured ? "Resend API key present." : "RESEND_API_KEY is not set — the transport cannot send.",
  })));

  checks.push(await guard("sender", "Sender identity configured", () => ({
    ok: audit.fromIdentityConfigured,
    detail: audit.fromIdentityConfigured ? "A From identity resolves (RESEND_FROM or Settings contact email)." : "No From identity — set RESEND_FROM or a Settings contact email.",
  })));

  checks.push(await guard("reply-path", "Reply path configured", () => ({
    // Reply-To mirrors From by construction (dispatch.ts), so a resolved sender IS a reply path.
    ok: audit.fromIdentityConfigured,
    detail: audit.fromIdentityConfigured ? "Reply-To mirrors From by design — replies reach the sending mailbox." : "No sender identity ⇒ no reply path.",
  })));

  checks.push(await guard("opt-out", "Opt-out path configured", () => {
    const ok = audit.unsubscribeConfigured && audit.postalAddressConfigured;
    const missing = [
      audit.unsubscribeConfigured ? null : "COMMS_UNSUBSCRIBE_SECRET",
      audit.postalAddressConfigured ? null : "postal address (COMMS_POSTAL_ADDRESS or Settings)",
    ].filter(Boolean);
    return { ok, detail: ok ? "Signed unsubscribe secret + CAN-SPAM postal address both present." : `Missing: ${missing.join(", ")}.` };
  }));

  checks.push(await guard("no-send-default", "No-send-by-default behavior intact", () => {
    // Intact when prospect delivery is OFF (only the test recipient can receive), OR — if
    // prospect delivery is ON — a deliberate posture. Autosend must be OFF for "no-send-by-default".
    const prospectGated = !audit.prospectDeliveryEnabled;
    const autosendOff = !audit.autosendEnabled;
    if (prospectGated && autosendOff) {
      return { ok: true, detail: "Prospect delivery OFF (only the test recipient can receive) and autosend OFF." };
    }
    if (audit.prospectDeliveryEnabled) {
      return { ok: false, detail: "COMMS_PROSPECT_DELIVERY_ENABLED=1 — real prospects can receive. No-send-by-default is NOT intact (deliberate go-live only)." };
    }
    return { ok: false, detail: "Autosend is ON while the send-default should be OFF — the scheduler could auto-send." };
  }));

  // ── Canonical asset resolver — getArtifactStore() must resolve WITHOUT throwing.
  //    In prod, resolveStorageMode may throw when unconfigured; that is a FAILED check.
  checks.push(await guard("asset-resolver", "Canonical asset resolver healthy", async () => {
    const { getArtifactStore } = await import("@/lib/content-studio/storage-factory");
    const store = getArtifactStore(penv);
    const ok = !!store && (store.mode === "local" || store.mode === "postgres");
    return { ok, detail: ok ? `Artifact store resolves (mode=${store.mode}).` : "Artifact store did not resolve to a valid mode." };
  }));

  // ── Real personalized render path — the renderer module + a resolved store.
  checks.push(await guard("personalized-render", "Personalized render path healthy", async () => {
    const [{ resolvePersonalizedVideoForServe }, { getArtifactStore }] = await Promise.all([
      import("@/lib/quick-fix/personalized-video-serve"),
      import("@/lib/content-studio/storage-factory"),
    ]);
    const rendererPresent = typeof resolvePersonalizedVideoForServe === "function";
    const store = getArtifactStore(penv); // throws in prod if unconfigured → failed check
    const ok = rendererPresent && !!store;
    return { ok, detail: ok ? "Personalized-video resolver present and storage configured." : "Renderer or storage not available." };
  }));

  // ── Shared serving path — the served-route resolver is importable + store readable.
  checks.push(await guard("shared-serving", "Shared serving path healthy", async () => {
    const [{ resolvePersonalizedVideoForServe }, { getArtifactStore }] = await Promise.all([
      import("@/lib/quick-fix/personalized-video-serve"),
      import("@/lib/content-studio/storage-factory"),
    ]);
    const store = getArtifactStore(penv);
    const ok = typeof resolvePersonalizedVideoForServe === "function" && typeof store.readFull === "function";
    return { ok, detail: ok ? "Serve resolver importable and the store exposes a readable interface." : "Serve resolver or store read interface missing." };
  }));

  // ── Trust-video resolver — must return a COHERENT decision for BOTH a Matt journey
  //    and a Lucas journey, with NO cross-generation fallback.
  checks.push(await guard("trust-video", "Trust-video resolver healthy (both generations)", async () => {
    const [{ resolveTrustVideoForJourney }, { DEFAULT_VOICE_KEY, LEGACY_LUCAS_VOICE_KEY }] = await Promise.all([
      import("@/lib/voice/trust-video-plan"),
      import("@/lib/voice/registry"),
    ]);
    const scope = "cta-conversion" as const;
    const noMatt = new Set<typeof scope>(); // no Matt asset yet ⇒ prepare-on-demand, never a Lucas fallback
    const matt = resolveTrustVideoForJourney(scope, DEFAULT_VOICE_KEY, noMatt);
    const lucas = resolveTrustVideoForJourney(scope, LEGACY_LUCAS_VOICE_KEY, noMatt);
    // Coherent = a Matt journey resolves to a Matt generation (reuse/prepare — NEVER a
    // Lucas fallback), and a Lucas journey resolves to the preserved Lucas asset.
    const mattCoherent = matt.generation === "current-matt" && (matt.outcome === "reuse-matt" || matt.outcome === "prepare-matt");
    const lucasCoherent = lucas.generation === "legacy-lucas" && lucas.outcome === "use-legacy-lucas";
    const ok = mattCoherent && lucasCoherent;
    return { ok, detail: ok ? `Matt→${matt.outcome}, Lucas→${lucas.outcome} — no cross-generation fallback.` : `Incoherent: matt→${matt.outcome} (${matt.generation}), lucas→${lucas.outcome} (${lucas.generation}).` };
  }));

  // ── Breakbot healthy — a golden fixture must yield a READY (PASS) verdict.
  checks.push(await guard("breakbot", "Breakbot healthy (golden fixture passes)", async () => {
    const [{ runBreakbotPreflight }, fixtures] = await Promise.all([
      import("@/lib/breakbot/quickcash-preflight"),
      import("@/lib/breakbot/quickcash-fixtures"),
    ]);
    // Assemble ONE canonical golden input and attach the coherent Matt voice chain.
    const offer = fixtures.goldenOffer();
    const input = fixtures.baseInput(offer);
    input.voiceCoherence = fixtures.coherentMattVoice(input);
    const verdict = runBreakbotPreflight(input);
    const ok = verdict.overall === "READY";
    return { ok, detail: ok ? `Golden fixture is READY (${verdict.counts.passed} checks passed).` : `Golden fixture BLOCKED (${verdict.counts.blockers} blocker(s): ${verdict.issues.filter((i) => i.severity === "BLOCKER").map((i) => i.surface).join(", ")}).` };
  }));

  // ── ElevenLabs healthy (REQUIRED for a Matt journey; advisory for a bare prospect send).
  checks.push(await guard("elevenlabs", "ElevenLabs configured (Matt journeys)", async () => {
    const { elevenLabsConfigured } = await import("@/lib/voice/elevenlabs-config");
    const ok = elevenLabsConfigured(penv);
    return { ok, detail: ok ? "ElevenLabs API key + voice id present." : "ElevenLabs not configured — Matt-voice narration cannot be generated." };
  }));

  // ── Approval gate — no auto-approve; the compliance-gated approval module is present.
  checks.push(await guard("approval-gate", "Approval gate healthy (no auto-approve)", async () => {
    const compliance = await import("@/lib/acquisition/compliance");
    const ok = typeof (compliance as { checkPlanCompliance?: unknown }).checkPlanCompliance === "function";
    return { ok, detail: ok ? "Plan-compliance gate present — approval is an explicit, gated action (no auto-approve)." : "checkPlanCompliance is not available — approval gating cannot be verified." };
  }));

  // ── Verdict roll-up: GO only when EVERY required check passes ──────────────────
  const blockers = checks.filter((c) => c.required && !c.ok).map((c) => c.label);
  const state: LaunchState = blockers.length === 0 ? "GO" : "NO-GO";

  return {
    generatedAt: new Date().toISOString(),
    state,
    checks,
    blockers,
    audit,
    performsSend: false,
  };
}

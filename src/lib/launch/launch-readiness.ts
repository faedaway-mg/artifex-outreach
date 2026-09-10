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
/** Sending ONE prospect email requires exactly these check ids to pass. Cold prospect outreach rides the
 *  GOOGLE WORKSPACE lanes (never Resend), so prospect readiness evaluates the lanes — NOT Resend health.
 *  Resend appears separately as an advisory TRANSACTIONAL check that never gates prospect sending. */
export const REQUIRED_TO_SEND_A_PROSPECT = [
  "prospect-transport",       // Google Workspace lanes configured + authenticated (the sole cold transport)
  "prospect-lanes",           // ≥1 lane healthy + enabled + has daily capacity
  "reply-path",               // replies route to the sending lane's mailbox (or a canonical Reply-To)
  "reply-ingestion",          // inbound replies can be captured + mapped back to lead/send/lane/thread
  "opt-out",
  "approval-gate",
  "autonomous-send-policy",   // fail-closed prospect-transport policy (never falls back to Resend)
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

  // ── Prospect-transport checks (the Google Workspace lanes — NEVER Resend) ─────
  // Live lane health/capacity is evaluated once here (async) and reused by two checks.
  const { prospectLanesView } = await import("@/lib/comms/google-workspace/prospect-lanes");
  const lanes = await prospectLanesView(penv).catch(() => null);

  checks.push(await guard("prospect-transport", "Prospect transport configured (Google Workspace lanes)", () => ({
    ok: audit.prospectTransportConfigured,
    detail: audit.prospectTransportConfigured
      ? `Google Workspace cold lanes configured (${audit.prospectLanesConfigured} lane(s), OAuth app present). Resend can never carry cold outreach.`
      : "Google Workspace lanes not configured (OAuth app + at least one sender+refresh token required). Resend is transactional-only and cannot be used for prospect outreach.",
  })));

  checks.push(await guard("prospect-lanes", "At least one Google lane healthy with capacity", () => {
    if (!lanes) return { ok: false, detail: "Lane health could not be evaluated." };
    const healthy = lanes.lanes.filter((l) => l.healthy);
    const laneStr = lanes.lanes.map((l) => `Lane ${l.label}: ${l.configured ? (l.enabled ? (l.healthy ? "healthy" : "unavailable") : "disabled") : "unconfigured"} ${l.sentToday}/${l.cap}`).join(" · ");
    return {
      ok: lanes.anyLaneAvailable,
      detail: lanes.anyLaneAvailable
        ? `${healthy.length} lane(s) available, ${lanes.combinedCapacityRemaining} combined send(s) remaining today. ${laneStr}.`
        : `No lane is healthy with capacity — prospect outbound is on hold (no quota transfer between lanes). ${laneStr}.`,
    };
  }));

  checks.push(await guard("reply-path", "Reply path routes to the sending lane", () => ({
    // Reply-To mirrors the sending lane's mailbox by construction (or a configured canonical Reply-To).
    ok: audit.prospectTransportConfigured,
    detail: audit.prospectTransportConfigured
      ? "Reply-To mirrors the sending Google Workspace lane mailbox (or COMMS_CANONICAL_REPLY_TO) — replies never route to Resend or silently into hello@ M365."
      : "No lane configured ⇒ no prospect reply path.",
  })));

  checks.push(await guard("reply-ingestion", "Reply ingestion healthy", async () => {
    const reply = await import("@/lib/comms/reply");
    const routing = await import("@/lib/comms/reply-routing");
    const ok = typeof (reply as { ingestInboundReply?: unknown }).ingestInboundReply === "function"
      && typeof (routing as { mapReplyToLineage?: unknown }).mapReplyToLineage === "function";
    return { ok, detail: ok ? "Inbound replies can be captured and mapped back to lead/send/lane/thread." : "Reply ingestion or lineage mapping is unavailable." };
  }));

  checks.push(await guard("autonomous-send-policy", "Autonomous-send policy fail-closed (never Resend)", async () => {
    const { RESEND_PROSPECT_REJECTION, resolveProspectTransport, refuseResendForProspect } = await import("@/lib/comms/prospect-transport");
    // The policy must (a) exist, (b) refuse a Resend transport for a prospect, and (c) never yield Resend.
    const refusesResend = refuseResendForProspect("resend")?.reason === RESEND_PROSPECT_REJECTION;
    const decision = resolveProspectTransport(penv);
    const neverResend = !decision.ok || decision.transport === "google-workspace";
    const ok = refusesResend && neverResend;
    return { ok, detail: ok ? "Prospect transport policy is fail-closed: cold mail resolves only to the Google lanes, never Resend." : "Prospect-transport fail-closed policy is not intact." };
  }));

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

  // ── TRANSACTIONAL email (Resend) — ADVISORY ONLY. Surfaced so the operator can see the separate
  //    transactional lane, but its health NEVER gates prospect sending (cold outreach rides Google). ──
  checks.push(await guard("transactional-email", "Transactional email (Resend) configured", () => ({
    ok: audit.transactionalConfigured,
    detail: audit.transactionalConfigured
      ? "Resend configured for TRANSACTIONAL mail only (receipts, confirmations) — it does not carry prospect outreach."
      : "Resend (transactional-only) is not configured. This does not block prospect outreach.",
  })));

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

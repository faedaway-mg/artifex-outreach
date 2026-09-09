// LAUNCH READINESS GATE — the diagnostic GO / NO-GO view. A server component that
// renders the aggregate verdict, every check's pass/fail + reason, and the send-infra
// audit (booleans only — no secrets, no addresses). This page NEVER triggers a send;
// it only reads the gate. Auth is enforced by the (app) layout (redirects to /login).
import { computeLaunchReadiness } from "@/lib/launch/launch-readiness";
import { getSettings } from "@/lib/repo";
import { StatusPill } from "@/components/launch/LaunchUI";
import type { CheckStatus } from "@/lib/launch/types";

export const dynamic = "force-dynamic";

/** Present a boolean audit fact as a compliant/attention pill without leaking any value. */
function Fact({ label, ok, goodWhenFalse }: { label: string; ok: boolean; goodWhenFalse?: boolean }) {
  // Some facts are "good" when OFF (e.g. prospect delivery disabled by default).
  const good = goodWhenFalse ? !ok : ok;
  const status: CheckStatus = good ? "pass" : "warn";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-2 last:border-0">
      <span className="text-sm text-chalk-200">{label}</span>
      <StatusPill status={status} label={ok ? "YES" : "NO"} />
    </div>
  );
}

export default async function LaunchReadinessPage() {
  const settings = await getSettings().catch(() => null);
  const r = await computeLaunchReadiness(process.env, settings);
  const go = r.state === "GO";
  const a = r.audit;

  return (
    <div className="space-y-6">
      {/* Verdict banner — GO / NO-GO is the one thing that must be unmissable. */}
      <div className={`card flex flex-wrap items-center justify-between gap-3 p-5 ${go ? "border-teal-400/30" : "border-coral-400/30"}`}>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-md border px-3 py-1 text-sm font-bold uppercase tracking-wide ${
              go ? "border-teal-400/40 bg-teal-400/10 text-teal-300" : "border-coral-400/40 bg-coral-400/10 text-coral-300"
            }`}
          >
            {r.state}
          </span>
          <div>
            <p className="text-sm font-semibold text-chalk-100">
              {go ? "All required checks pass — outbound may be enabled by the operator." : "Required checks are failing — outbound must stay off."}
            </p>
            <p className="text-xs text-chalk-500">
              {r.checks.filter((c) => c.ok).length}/{r.checks.length} checks passing · {r.blockers.length} blocker(s) · this view never sends.
            </p>
          </div>
        </div>
      </div>

      {/* Blocking reasons — surfaced explicitly when NO-GO. */}
      {!go && (
        <div className="card border-coral-400/20 p-5">
          <h3 className="mb-2 text-sm font-semibold text-coral-300">Blocking reasons</h3>
          <ul className="space-y-1.5">
            {r.blockers.map((b) => (
              <li key={b} className="flex items-start gap-2 text-xs text-chalk-300">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-coral-400" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Every check with pass/fail + reason. */}
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-chalk-100">Checks</h3>
        <div>
          {r.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-3 border-b border-white/[0.04] py-2.5 last:border-0">
              <StatusPill status={c.ok ? "pass" : "fail"} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-chalk-100">
                  {c.label}
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-chalk-600">{c.required ? "required" : "advisory"}</span>
                </p>
                <p className="text-xs text-chalk-500">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Send-infrastructure audit — booleans only, never a secret or address. */}
      <div className="card p-5">
        <h3 className="mb-1 text-sm font-semibold text-chalk-100">Send-infrastructure audit</h3>
        <p className="mb-3 text-xs text-chalk-500">Provider: {a.provider} · Reply-To {a.replyToBehavior} · daily cap {a.dailyCap}. Configuration presence only — no keys, From address, or recipient shown.</p>
        <Fact label="Send configured (RESEND_API_KEY)" ok={a.sendConfigured} />
        <Fact label="From identity configured" ok={a.fromIdentityConfigured} />
        <Fact label="Unsubscribe secret configured" ok={a.unsubscribeConfigured} />
        <Fact label="Postal address configured (CAN-SPAM)" ok={a.postalAddressConfigured} />
        <Fact label="Delivery webhook configured" ok={a.webhookConfigured} />
        <Fact label="Suppression active" ok={a.suppressionActive} />
        <Fact label="Test recipient configured" ok={a.testRecipientConfigured} />
        <Fact label="Prospect delivery enabled (OFF by default)" ok={a.prospectDeliveryEnabled} goodWhenFalse />
        <Fact label="Autosend enabled (OFF by default)" ok={a.autosendEnabled} goodWhenFalse />
        <Fact label="Operator sending enabled" ok={a.sendingEnabled} />
      </div>
    </div>
  );
}

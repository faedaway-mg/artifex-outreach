"use client";
// ─────────────────────────────────────────────────────────────────────────────
// VOICE CONFIG PANEL — a small operator form to set the ElevenLabs plan WITHOUT
// editing deployment env vars: monthly minute allowance, billing reset day, and an
// optional hard cap. POSTs to /api/voice/config; on success it bumps a shared signal
// so the sibling VoiceGenerationMeter refreshes. NEVER touches the API key or voice id.
//
// Clarifies the two very different guards: the 75/90/100 warnings are INFORMATIONAL
// (they never block), while the hard cap BLOCKS generation once exceeded.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Loader2, Check, AlertTriangle, Info } from "lucide-react";

type ConfigSourceValue = "operator" | "env" | "unset";
interface ConfigSourceView {
  source: ConfigSourceValue;
  label: string;
}

interface ConfigPayload {
  effective: { monthlyMinuteBudget: number | null; billingResetDay: number | null; hardCapMinutes: number | null };
  source: {
    monthlyMinuteBudget: ConfigSourceValue;
    billingResetDay: ConfigSourceValue;
    hardCapMinutes: ConfigSourceValue;
  };
  view: {
    source: {
      monthlyMinuteBudget: ConfigSourceView;
      billingResetDay: ConfigSourceView;
      hardCapMinutes: ConfigSourceView;
    };
  };
}

// null → cleared; "" → leave unchanged; a number string → parsed.
function toNumberOrNull(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return undefined; // untouched
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN as unknown as number;
}

export function VoiceConfigPanel({ className, onSaved }: { className?: string; onSaved?: () => void }) {
  const [budget, setBudget] = useState("");
  const [resetDay, setResetDay] = useState("");
  const [hardCap, setHardCap] = useState("");
  const [source, setSource] = useState<ConfigPayload["view"]["source"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Load the current EFFECTIVE config so the fields show what's live and where it came from.
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/voice/config", { cache: "no-store" });
      if (!r.ok) throw new Error(`Could not load config (${r.status}).`);
      const d = (await r.json()) as ConfigPayload;
      setBudget(d.effective.monthlyMinuteBudget != null ? String(d.effective.monthlyMinuteBudget) : "");
      setResetDay(d.effective.billingResetDay != null ? String(d.effective.billingResetDay) : "");
      setHardCap(d.effective.hardCapMinutes != null ? String(d.effective.hardCapMinutes) : "");
      setSource(d.view.source);
    } catch (e: any) {
      setErr(e?.message || "Could not load config.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    setOk(false);

    const body: Record<string, number | null> = {};

    const b = toNumberOrNull(budget);
    if (b !== undefined) {
      if (Number.isNaN(b)) { setErr("Monthly allowance must be a positive number of minutes, or blank."); setSaving(false); return; }
      if (b !== null && b <= 0) { setErr("Monthly allowance must be greater than zero."); setSaving(false); return; }
      body.monthlyMinuteBudget = budget.trim() === "" ? null : b;
    }

    const h = toNumberOrNull(hardCap);
    if (h !== undefined) {
      if (Number.isNaN(h)) { setErr("Hard cap must be a positive number of minutes, or blank."); setSaving(false); return; }
      if (h !== null && h <= 0) { setErr("Hard cap must be greater than zero."); setSaving(false); return; }
      body.hardCapMinutes = hardCap.trim() === "" ? null : h;
    }

    if (resetDay.trim() !== "") {
      const d = Number(resetDay);
      if (!Number.isInteger(d) || d < 1 || d > 28) { setErr("Billing reset day must be a whole number from 1 to 28."); setSaving(false); return; }
      body.billingResetDay = d;
    }

    // An empty form is a no-op; require at least one field so we don't POST nothing.
    if (Object.keys(body).length === 0) { setErr("Enter a value to save (or clear a field by setting it to 0-length after loading)."); setSaving(false); return; }

    try {
      const r = await fetch("/api/voice/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => ({}))) as Partial<ConfigPayload> & { error?: string };
      if (!r.ok) { setErr(d.error || `Could not save (${r.status}).`); return; }
      if (d.view?.source) setSource(d.view.source);
      setOk(true);
      onSaved?.();
    } catch (e: any) {
      setErr(e?.message || "Could not save config.");
    } finally {
      setSaving(false);
    }
  }, [budget, resetDay, hardCap, onSaved]);

  const input =
    "mt-1 w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-[16px] tabular-nums text-chalk-100 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

  const chip = (s?: ConfigSourceView) => {
    if (!s) return null;
    const tone =
      s.source === "operator"
        ? "border-teal-400/25 bg-teal-400/[0.08] text-teal-200"
        : s.source === "env"
          ? "border-azure-400/25 bg-azure-400/[0.06] text-azure-200"
          : "border-white/10 bg-white/[0.02] text-chalk-500";
    return <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] ${tone}`}>{s.label}</span>;
  };

  return (
    <section className={`card space-y-3 p-5 ${className ?? ""}`}>
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-chalk-100">
        <SlidersHorizontal size={15} className="text-teal-300" /> Voice budget
      </h2>
      <p className="text-[12.5px] leading-relaxed text-chalk-400">
        Set the ElevenLabs plan here — no deployment env change needed. An operator value overrides the
        environment default. Leave a field blank to keep it unchanged.
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-chalk-500"><Loader2 size={13} className="animate-spin" /> Loading…</p>
      ) : (
        <>
          <label className="block">
            <span className="field-label">Monthly minute allowance {chip(source?.monthlyMinuteBudget)}</span>
            <input
              value={budget} onChange={(e) => { setBudget(e.target.value); setOk(false); }}
              inputMode="decimal" placeholder="e.g. 60" className={input}
            />
          </label>

          <label className="block">
            <span className="field-label">Billing reset day (1–28) {chip(source?.billingResetDay)}</span>
            <input
              value={resetDay} onChange={(e) => { setResetDay(e.target.value); setOk(false); }}
              inputMode="numeric" placeholder="e.g. 1 (blank = calendar month)" className={input}
            />
          </label>

          <label className="block">
            <span className="field-label">Hard cap — minutes (optional) {chip(source?.hardCapMinutes)}</span>
            <input
              value={hardCap} onChange={(e) => { setHardCap(e.target.value); setOk(false); }}
              inputMode="decimal" placeholder="blank = no hard cap" className={input}
            />
          </label>

          <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2.5 text-[12px] leading-relaxed text-amber-200/90">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            The hard cap <strong>blocks</strong> voice generation once this period's usage exceeds it. The 75 / 90 /
            100% warnings on the meter are <strong>informational only</strong> and never block.
          </p>

          <p className="flex items-start gap-1.5 text-[11.5px] text-chalk-500">
            <Info size={12} className="mt-0.5 shrink-0" />
            This never exposes or changes the ElevenLabs API key or voice id — only your budget and reset day.
          </p>

          {err && <p className="text-[12.5px] text-coral-300">{err}</p>}

          <button
            onClick={() => void save()}
            disabled={saving}
            className="btn-primary w-full justify-center !py-3 text-[15px] disabled:opacity-50"
          >
            {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : ok ? <><Check size={16} /> Saved</> : "Save voice budget"}
          </button>
        </>
      )}
    </section>
  );
}

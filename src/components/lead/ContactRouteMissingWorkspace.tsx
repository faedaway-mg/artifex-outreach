"use client";
// CONTACT ROUTE MISSING — the workspace for a lead with no actionable channel. The
// system already decided we can't call/email/DM this business (there's no verified
// way to), so the ONE action is to find a real contact route. The page routes here
// instead of a call/email workspace precisely so we never show an action that can't
// be performed. Finding a channel refreshes the page, which recomputes the next action.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Globe, Loader2, Check, ArrowRight, Plus, AlertCircle } from "lucide-react";
import { findContactRouteAction, saveManualContactAction, type FindContactResult } from "@/lib/outreach/find-contact";
import { deslug } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export function ContactRouteMissingWorkspace({ lead, reason }: { lead: Lead; reason: string }) {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<FindContactResult | null>(null);
  const [showManual, setShowManual] = useState(false);

  async function onFind() {
    if (searching) return;
    setSearching(true);
    try {
      const r = await findContactRouteAction(lead.id);
      setResult(r);
      // A channel was found → the lead is no longer route-missing; recompute its state.
      if (r.found) router.refresh();
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Compact identity — and an honest statement of what's missing. */}
      <div className="card p-5">
        <h1 className="text-2xl font-semibold text-chalk-50">{lead.businessName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-chalk-400">
          <span>{deslug(lead.industry)}</span>
          {lead.city && <span className="inline-flex items-center gap-1"><MapPin size={14} /> {lead.city}</span>}
          <span className={`inline-flex items-center gap-1 ${lead.website ? "" : "text-amber-300/90"}`}>
            <Globe size={14} /> {lead.website ? lead.websiteDomain ?? "Has website" : "No website"}
          </span>
        </div>
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[13.5px] leading-relaxed text-chalk-300">{reason}</p>
      </div>

      {/* The one action: find a verified contact route. */}
      <section className="card p-5">
        <p className="eyebrow text-azure-300">Contact route missing</p>
        <h2 className="mt-1 text-lg font-semibold text-chalk-50">Find a way to contact {lead.businessName}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-400">
          We haven&apos;t found a verified way to reach {lead.businessName} — no phone number, email address, contact
          form, booking link, or social account. There&apos;s nothing to call or send yet.
        </p>
        <p className="mt-2 flex gap-2 text-[13.5px] leading-relaxed text-chalk-300">
          <Search size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <span>Goal: find one reliable contact route before preparing any outreach.</span>
        </p>

        {!result?.found && (
          <button onClick={onFind} disabled={searching} className="btn-primary mt-4 w-full justify-center !py-3.5 text-[16px] disabled:opacity-60">
            {searching ? <><Loader2 size={18} className="animate-spin" /> Searching public listings…</> : <><Search size={18} /> Find contact information</>}
          </button>
        )}

        {/* Honest result — what was found or what was checked. */}
        {result && (
          <div className={`mt-4 rounded-xl border p-4 ${result.found ? "border-teal-400/25 bg-teal-400/[0.06]" : "border-white/[0.08] bg-white/[0.02]"}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-chalk-500">Contact search complete{result.mode === "mock" ? " (dev mock data)" : ""}</p>
            {result.found ? (
              <>
                <ul className="mt-2 space-y-1 text-[13.5px] text-chalk-200">
                  {result.channels.phone && <li>Phone: <span className="text-chalk-50">{result.channels.phone}</span></li>}
                  {result.channels.website && <li>Website: <span className="text-chalk-50">{result.channels.website}</span></li>}
                  <li className="text-[12.5px] text-chalk-500">Source: {result.source}{result.matchName ? ` · matched “${result.matchName}”` : ""}</li>
                </ul>
                <button onClick={() => router.refresh()} className="btn-primary mt-3 inline-flex !py-2.5 text-sm">
                  Continue to the next action <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-[13px] text-chalk-300">No verified channel found. {result.message}</p>
                <p className="mt-2 text-[12.5px] text-chalk-500">Checked: {result.sourcesChecked.join(", ")}.</p>
                <button onClick={() => setShowManual(true)} className="btn-secondary mt-3 inline-flex !py-2 text-sm"><Plus size={14} /> Add contact manually</button>
              </>
            )}
          </div>
        )}

        {/* Secondary, quieter fallback — never a competing primary action. */}
        {!showManual && !result?.found && (
          <button onClick={() => setShowManual(true)} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-chalk-500 hover:text-chalk-300">
            <Plus size={13} /> Add contact information manually
          </button>
        )}

        {showManual && !result?.found && <ManualContactForm lead={lead} onSaved={() => router.refresh()} />}
      </section>
    </div>
  );
}

function ManualContactForm({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [form, setForm] = useState("");
  const [instagram, setInstagram] = useState("");
  const [source, setSource] = useState("");
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const input = "w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-sm text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

  async function onSave() {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const r = await saveManualContactAction(lead.id, { phone, publicEmail: email, website, contactFormUrl: form, instagram, source, verified });
      if (r.ok) onSaved();
      else setErr(r.reason ?? "Couldn't save.");
    } catch {
      setErr("Something went wrong saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Add a contact route manually</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" inputMode="email" autoCapitalize="none" className={input} />
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (https://…)" autoCapitalize="none" className={input} />
        <input value={form} onChange={(e) => setForm(e.target.value)} placeholder="Contact / booking link" autoCapitalize="none" className={input} />
        <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Instagram profile URL" autoCapitalize="none" className={input} />
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (where you found it)" className={input} />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-chalk-300">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-ink-950" />
        I verified this against its source
      </label>
      {err && <p className="inline-flex items-center gap-1.5 text-[12.5px] text-coral-300"><AlertCircle size={13} /> {err}</p>}
      <button onClick={onSave} disabled={saving} className="btn-primary w-full justify-center !py-2.5 text-sm disabled:opacity-60">
        {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Check size={15} /> Save contact route</>}
      </button>
    </div>
  );
}

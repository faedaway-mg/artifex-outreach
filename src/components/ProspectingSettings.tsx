"use client";
import { useRouter } from "next/navigation";
import { Play, Pause, Radar, Clock, CheckCircle2 } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { runProspectingNowAction, toggleProspectingAction, updateProspectingProfileAction } from "@/lib/actions";
import type { ProspectingProfile, ProspectingRun } from "@/lib/types";

export function ProspectingSettings({ profile, lastRun, nextRunLabel }: { profile: ProspectingProfile; lastRun: ProspectingRun | null; nextRunLabel: string }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const terr = profile.territories.map((t) => `${t.city}|${t.state}`).join(", ");

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><Radar size={16} className="text-azure-300" /> Artifex Prospecting Profile</h2>
          <p className="mt-1 text-xs text-chalk-500">The automatic daily lead engine reads this to prepare your Today queue. It never contacts anyone.</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${profile.enabled ? "border-teal-400/30 bg-teal-400/10 text-teal-300" : "border-white/10 bg-white/[0.03] text-chalk-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${profile.enabled ? "bg-teal-400" : "bg-chalk-500"}`} /> {profile.enabled ? "Automation on" : "Paused"}
        </span>
      </div>

      {/* Status row */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="panel p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-chalk-500"><Clock size={11} /> Next scheduled run</p>
          <p className="mt-1 text-sm text-chalk-200">{nextRunLabel}</p>
        </div>
        <div className="panel p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-chalk-500"><CheckCircle2 size={11} /> Last run</p>
          <p className="mt-1 text-sm text-chalk-200">
            {lastRun ? `${new Date(lastRun.startedAt).toLocaleString()} · +${lastRun.addedToToday} added` : "Not run yet"}
          </p>
          {lastRun && <p className="text-[11px] text-chalk-500">{lastRun.examined} examined · {lastRun.duplicatesRemoved} dupes · {lastRun.excluded} excluded · {lastRun.providerMode}{lastRun.estimatedCostUsd ? ` · ~$${lastRun.estimatedCostUsd.toFixed(3)}` : ""}</p>}
          {lastRun?.errors?.length ? <p className="mt-0.5 text-[11px] text-coral-300">{lastRun.errors[0]}</p> : null}
        </div>
        <div className="flex flex-col justify-center gap-2 panel p-3">
          <ActionButton variant="primary" className="w-full !py-1.5 text-xs" onRun={() => runProspectingNowAction().then(refresh)}>
            <Play size={13} /> Run prospecting now
          </ActionButton>
          <ActionButton variant="secondary" className="w-full !py-1.5 text-xs" onRun={() => toggleProspectingAction().then(refresh)}>
            {profile.enabled ? <><Pause size={13} /> Pause automation</> : <><Play size={13} /> Resume automation</>}
          </ActionButton>
        </div>
      </div>

      {/* Editable targeting */}
      <form action={updateProspectingProfileAction} onSubmit={() => setTimeout(refresh, 400)} className="space-y-3">
        <label className="block"><span className="field-label">Positioning</span><textarea name="positioning" defaultValue={profile.positioning} rows={2} className="input text-sm" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="field-label">Priority industries (comma-separated)</span><input name="industries" defaultValue={profile.industries.join(", ")} className="input" /></label>
          <label className="block"><span className="field-label">Excluded industries</span><input name="excludedIndustries" defaultValue={profile.excludedIndustries.join(", ")} className="input" /></label>
        </div>
        <label className="block"><span className="field-label">Territories (City|ST, comma-separated)</span><input name="territories" defaultValue={terr} className="input" /></label>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="block"><span className="field-label">Radius (mi)</span><input name="radiusMiles" type="number" min={1} max={50} defaultValue={profile.radiusMiles} className="input" /></label>
          <label className="block"><span className="field-label">Min rating</span><input name="minRating" type="number" step={0.1} min={0} max={5} defaultValue={profile.minRating} className="input" /></label>
          <label className="block"><span className="field-label">Min reviews</span><input name="minReviews" type="number" min={0} defaultValue={profile.minReviews} className="input" /></label>
          <label className="block"><span className="field-label">Daily queue size</span><input name="dailyQueueSize" type="number" min={1} max={20} defaultValue={profile.dailyQueueSize} className="input" /></label>
          <label className="block"><span className="field-label">Run time (PT)</span><input name="runTime" type="time" defaultValue={profile.runTime} className="input" /></label>
          <label className="block"><span className="field-label">Tier A target</span><input name="tierTargetA" type="number" min={0} max={8} defaultValue={profile.tierTargetA} className="input" /></label>
          <label className="block"><span className="field-label">Tier B target</span><input name="tierTargetB" type="number" min={0} max={8} defaultValue={profile.tierTargetB} className="input" /></label>
          <label className="block"><span className="field-label">Cooling-off (days)</span><input name="coolingOffDays" type="number" min={0} defaultValue={profile.coolingOffDays} className="input" /></label>
        </div>
        <label className="block"><span className="field-label">Exclusion keywords (comma-separated)</span><input name="exclusionKeywords" defaultValue={profile.exclusionKeywords.join(", ")} className="input" /></label>
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-chalk-300"><input type="checkbox" name="requireWebsite" defaultChecked={profile.requireWebsite} className="accent-azure-500" /> Website required</label>
          <label className="flex items-center gap-2 text-sm text-chalk-300"><input type="checkbox" name="requirePhone" defaultChecked={profile.requirePhone} className="accent-azure-500" /> Phone required</label>
          <button type="submit" className="btn-primary ml-auto text-xs">Save prospecting profile</button>
        </div>
      </form>

      {/* Services (definition) */}
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <p className="label mb-2">Services & planning ranges</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {profile.services.map((s) => (
            <div key={s.name} className="panel p-2.5">
              <p className="text-sm text-chalk-200">{s.name}</p>
              <p className="text-[11px] text-chalk-500">${s.priceLow.toLocaleString()}–${s.priceHigh.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

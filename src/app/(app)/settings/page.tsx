import { getSettings, listSuppressions, listProspectingRuns } from "@/lib/repo";
import { updateSettingsAction } from "@/lib/actions";
import { aiMode } from "@/lib/providers/ai";
import { storageStatus } from "@/lib/storage";
import { hasDb } from "@/db/client";
import { nextScheduledRun } from "@/lib/schedule";
import { ResetDemoButton } from "@/components/ResetDemoButton";
import { ProspectingSettings } from "@/components/ProspectingSettings";
import { CategoryManager } from "@/components/CategoryManager";
import { formatRange } from "@/lib/utils";
import { CheckCircle2, Circle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, suppressions, runs] = await Promise.all([getSettings(), listSuppressions(), listProspectingRuns(1)]);
  const ai = aiMode();
  const store = storageStatus();
  const nextRun = nextScheduledRun(settings.prospecting);

  const integrations = [
    { name: "Database (Postgres)", on: hasDb(), env: "DATABASE_URL" },
    { name: `AI provider — ${ai.mode}`, on: ai.mode !== "mock", env: "AI_PROVIDER + OPENAI_API_KEY / ANTHROPIC_API_KEY" },
    { name: "Google Places", on: !!process.env.GOOGLE_PLACES_API_KEY, env: "GOOGLE_PLACES_API_KEY" },
    { name: "Google Maps", on: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, env: "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" },
    { name: "PageSpeed", on: !!process.env.GOOGLE_PAGESPEED_API_KEY, env: "GOOGLE_PAGESPEED_API_KEY" },
    { name: `File storage — ${store.provider}`, on: store.configured, env: "STORAGE_PROVIDER + S3_*" },
    { name: "Screenshot worker", on: !!process.env.SCREENSHOT_WORKER_URL, env: "SCREENSHOT_WORKER_URL" },
    { name: "Gmail send", on: process.env.GMAIL_ENABLED === "true", env: "GMAIL_ENABLED" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="label">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Configuration</h1>
      </div>

      {/* Automatic daily lead engine */}
      <ProspectingSettings profile={settings.prospecting} lastRun={runs[0] ?? null} nextRunLabel={nextRun.label} />

      {/* Category portfolio */}
      <CategoryManager categories={settings.prospecting.categories} preset={settings.prospecting.preset} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity */}
        <form action={updateSettingsAction} className="card space-y-3 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-chalk-100">Sender identity & links</h2>
          <label className="block"><span className="field-label">Business mailing address (for compliant email)</span><input name="businessAddress" defaultValue={settings.businessAddress} className="input" /></label>
          <label className="block"><span className="field-label">Signature</span><textarea name="signature" defaultValue={settings.signature} rows={3} className="input" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="field-label">Calendar link</span><input name="calendarLink" defaultValue={settings.calendarLink} className="input" /></label>
            <label className="block"><span className="field-label">Website</span><input name="website" defaultValue={settings.website} className="input" /></label>
            <label className="block"><span className="field-label">Contact email</span><input name="contactEmail" defaultValue={settings.contactEmail} className="input" /></label>
            <label className="block"><span className="field-label">Default report language</span><input name="defaultReportLanguage" defaultValue={settings.defaultReportLanguage} className="input" /></label>
          </div>
          <button type="submit" className="btn-primary">Save settings</button>
        </form>

        {/* Integration status */}
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-chalk-100">Integrations</h2>
          <p className="mb-3 text-xs text-chalk-500">Real integrations activate only when their env variable is present. Otherwise mock mode is used.</p>
          <ul className="space-y-2">
            {integrations.map((i) => (
              <li key={i.name} className="flex items-center gap-2 text-sm">
                {i.on ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Circle size={15} className="text-chalk-600" />}
                <span className={i.on ? "text-chalk-200" : "text-chalk-500"}>{i.name}</span>
                <span className="ml-auto font-mono text-[10px] text-chalk-600">{i.on ? "live" : "mock"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Default pricing */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-chalk-100">Default pricing ranges (internal)</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(settings.defaultPricing).map(([service, p]) => (
            <div key={service} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-2.5 text-sm">
              <span className="text-chalk-300">{service}</span>
              <span className="font-mono text-xs text-chalk-400">{formatRange(p.low, p.high)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Suppression list */}
      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-chalk-100">Suppression list</h2>
        <p className="mb-3 text-xs text-chalk-500">Opt-outs are never contacted again.</p>
        {suppressions.length === 0 ? (
          <p className="text-sm text-chalk-500">No suppressed contacts.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {suppressions.map((s) => (
              <li key={s.id} className="flex justify-between text-chalk-300">
                <span>{s.email ?? s.domain ?? s.phone}</span>
                <span className="text-xs text-chalk-500">{s.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Danger zone */}
      <div className="card border-amber-400/20 p-5">
        <h2 className="text-sm font-semibold text-chalk-100">Demo data</h2>
        <p className="mb-3 mt-1 text-xs text-chalk-500">Reset the in-memory store back to the seeded sample leads.</p>
        <ResetDemoButton />
      </div>

      <p className="text-center text-xs text-chalk-600">Artifex Outreach · Daily client-acquisition system for Artifex Labs</p>
    </div>
  );
}

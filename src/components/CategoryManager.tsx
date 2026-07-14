"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Pause, Play, RotateCcw, Plus } from "lucide-react";
import {
  setCategoryEnabledAction, setCategoryPriorityAction, setCategoryCapsAction,
  pauseCategoryAction, resumeCategoryAction, applyCategoryPresetAction,
  addCustomCategoryAction, restoreCategoryDefaultsAction,
} from "@/lib/actions";
import { CATEGORY_GROUPS, CATEGORY_PRESETS, type ProspectCategoryTarget, type CategoryGroup, type CategoryPreset } from "@/lib/types";

const PRIO_STYLE: Record<string, string> = {
  high: "text-amber-300",
  medium: "text-azure-300",
  low: "text-chalk-500",
};

export function CategoryManager({ categories, preset }: { categories: ProspectCategoryTarget[]; preset: CategoryPreset }) {
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<void>) => start(() => fn().then(() => router.refresh()));
  const enabledCount = categories.filter((c) => c.enabled).length;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><Layers size={16} className="text-indigo-300" /> Business categories</h2>
          <p className="mt-1 text-xs text-chalk-500">{enabledCount} of {categories.length} enabled · drives the diversified daily mix. Dental stays available; no single category dominates.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            defaultValue={preset}
            onChange={(e) => run(() => applyCategoryPresetAction(e.target.value as CategoryPreset))}
            className="input !w-auto !py-1.5 text-xs"
          >
            {CATEGORY_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => run(() => restoreCategoryDefaultsAction())} className="btn-ghost !px-2 !py-1.5 text-xs" title="Restore recommended defaults"><RotateCcw size={13} /></button>
        </div>
      </div>

      <div className="space-y-2">
        {CATEGORY_GROUPS.map((group) => {
          const inGroup = categories.filter((c) => c.group === group);
          if (!inGroup.length) return null;
          const on = inGroup.filter((c) => c.enabled).length;
          return (
            <details key={group} className="panel overflow-hidden">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm text-chalk-200">
                <span>{group}</span>
                <span className="text-[11px] text-chalk-500">{on}/{inGroup.length} on</span>
              </summary>
              <div className="divide-y divide-white/[0.04] border-t border-white/[0.05]">
                {inGroup.map((c) => (
                  <CategoryRow key={c.id} cat={c} run={run} />
                ))}
              </div>
            </details>
          );
        })}
      </div>

      {/* Add custom */}
      <details className="panel mt-3 p-3">
        <summary className="cursor-pointer text-xs font-medium text-chalk-300">Add a custom category</summary>
        <form action={addCustomCategoryAction} onSubmit={() => setTimeout(() => router.refresh(), 400)} className="mt-3 grid gap-2 sm:grid-cols-4">
          <input name="label" required placeholder="Category name" className="input sm:col-span-1" />
          <select name="group" className="input sm:col-span-1">{CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}</select>
          <input name="searchQueries" placeholder="Google queries (comma-sep, optional)" className="input sm:col-span-1" />
          <button type="submit" className="btn-secondary text-xs"><Plus size={13} /> Add</button>
        </form>
      </details>

      <p className="mt-2 text-[11px] text-chalk-600">{PRIO_LEGEND}</p>
    </div>
  );
}

const PRIO_LEGEND = "Priority + recency + how underrepresented a category is in your pipeline determine what gets searched each day — never a brute-force sweep of every category.";

function CategoryRow({ cat, run }: { cat: ProspectCategoryTarget; run: (fn: () => Promise<void>) => void }) {
  const paused = Boolean(cat.pausedUntil && +new Date(cat.pausedUntil) > Date.now());
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <label className="flex items-center gap-2">
        <input type="checkbox" defaultChecked={cat.enabled} onChange={(e) => run(() => setCategoryEnabledAction(cat.id, e.target.checked))} className="accent-azure-500" />
        <span className={`text-sm ${cat.enabled ? "text-chalk-100" : "text-chalk-500 line-through"}`}>{cat.label}</span>
      </label>

      <select
        defaultValue={cat.priority}
        onChange={(e) => run(() => setCategoryPriorityAction(cat.id, e.target.value as any))}
        className={`ml-auto rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1 text-[11px] ${PRIO_STYLE[cat.priority]}`}
      >
        <option value="high">high</option>
        <option value="medium">medium</option>
        <option value="low">low</option>
      </select>

      <form action={setCategoryCapsAction.bind(null, cat.id)} className="flex items-center gap-1.5">
        <input name="dailyNewLeadCap" type="number" min={0} max={8} defaultValue={cat.dailyNewLeadCap} title="Daily cap" className="w-12 rounded-lg border border-white/10 bg-ink-950/50 px-1.5 py-1 text-center text-[11px] text-chalk-200" />
        <span className="text-[10px] text-chalk-600">/d</span>
        <input name="weeklyNewLeadCap" type="number" min={0} max={40} defaultValue={cat.weeklyNewLeadCap} title="Weekly cap" className="w-12 rounded-lg border border-white/10 bg-ink-950/50 px-1.5 py-1 text-center text-[11px] text-chalk-200" />
        <span className="text-[10px] text-chalk-600">/wk</span>
        <button type="submit" className="btn-ghost !px-2 !py-1 text-[10px]">Save</button>
      </form>

      {paused ? (
        <button onClick={() => run(() => resumeCategoryAction(cat.id))} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-300"><Play size={11} /> Resume</button>
      ) : (
        <button onClick={() => run(() => pauseCategoryAction(cat.id, 7))} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-chalk-400 hover:text-chalk-200"><Pause size={11} /> Pause</button>
      )}

      <span className="basis-full text-[10px] text-chalk-600 sm:basis-auto">
        {cat.leadsFoundThisWeek}/{cat.weeklyNewLeadCap} this wk{cat.lastSearchedAt ? ` · searched ${new Date(cat.lastSearchedAt).toLocaleDateString()}` : " · not searched yet"}
      </span>
    </div>
  );
}

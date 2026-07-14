import Link from "next/link";
import { cn, TIER_STYLES, STAGE_COLORS } from "@/lib/utils";
import type { Tier, PipelineStage, Confidence, FindingType } from "@/lib/types";

export function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) return <span className="text-xs text-chalk-500">Unscored</span>;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", TIER_STYLES[tier])}>
      Tier {tier}
    </span>
  );
}

export function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", STAGE_COLORS[stage])}>
      {stage}
    </span>
  );
}

export function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-chalk-500">—</span>;
  const tone = score >= 70 ? "text-amber-300" : score >= 45 ? "text-indigo-300" : "text-chalk-400";
  return (
    <span className={cn("font-mono text-sm font-semibold tabular-nums", tone)}>
      {score}
      <span className="text-chalk-600">/100</span>
    </span>
  );
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  Verified: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  Likely: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  Unknown: "text-chalk-400 border-white/10 bg-white/[0.04]",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", CONFIDENCE_STYLES[confidence])}>
      {confidence}
    </span>
  );
}

const FINDING_STYLES: Record<FindingType, string> = {
  "Verified fact": "text-emerald-300 border-emerald-400/30",
  "Automated technical finding": "text-azure-300 border-azure-500/30",
  "AI inference": "text-indigo-300 border-indigo-400/30",
  "Jordan-approved recommendation": "text-amber-300 border-amber-400/30",
};

export function FindingTypeBadge({ type }: { type: FindingType }) {
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium", FINDING_STYLES[type])}>
      {type}
    </span>
  );
}

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-chalk-50">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-chalk-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "amber" | "indigo" | "azure" | "emerald" }) {
  const toneClass =
    tone === "amber" ? "text-amber-300" : tone === "indigo" ? "text-indigo-300" : tone === "azure" ? "text-azure-300" : tone === "emerald" ? "text-emerald-300" : "text-chalk-50";
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-chalk-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 p-10 text-center">
      <p className="text-sm font-medium text-chalk-300">{title}</p>
      {hint && <p className="text-xs text-chalk-500">{hint}</p>}
    </div>
  );
}

export function SourceTag({ source }: { source: string }) {
  return <span className="text-[10px] uppercase tracking-wide text-chalk-600">{source}</span>;
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" }) {
  const cls = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Tier, PipelineStage, NextAction } from "./types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US")}`;
}

export function formatRange(low: number | null, high: number | null): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null) return `$${low.toLocaleString()}–$${high.toLocaleString()}`;
  return formatCurrency(low ?? high);
}

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Math.round((d.getTime() - Date.now()) / 86_400_000);
  const abs = Math.abs(diff);
  if (abs === 0) return "today";
  if (diff < 0) return abs === 1 ? "yesterday" : `${abs}d ago`;
  return diff === 1 ? "tomorrow" : `in ${diff}d`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export const TIER_STYLES: Record<Tier, string> = {
  A: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  B: "border-indigo-400/40 bg-indigo-400/10 text-indigo-300",
  C: "border-white/10 bg-white/[0.04] text-chalk-400",
};

export const STAGE_COLORS: Record<PipelineStage, string> = {
  Discovered: "text-chalk-400 border-white/10",
  Qualified: "text-azure-300 border-azure-500/30",
  "Analysis Ready": "text-azure-300 border-azure-500/30",
  "Deliverable Ready": "text-indigo-300 border-indigo-400/30",
  Contacted: "text-indigo-300 border-indigo-400/30",
  "Follow-Up": "text-amber-300 border-amber-400/30",
  "Meeting Booked": "text-amber-300 border-amber-400/40",
  "Discovery Complete": "text-amber-300 border-amber-400/40",
  "Proposal Sent": "text-amber-200 border-amber-400/50",
  Won: "text-emerald-300 border-emerald-400/40",
  Lost: "text-red-300 border-red-500/30",
  Nurture: "text-chalk-400 border-white/10",
  Disqualified: "text-chalk-500 border-white/10",
  "Proposal Accepted": "text-amber-200 border-amber-400/50",
  "Agreement Signed": "text-emerald-300 border-emerald-400/40",
  "Deposit Paid": "text-emerald-300 border-emerald-400/50",
};

export const ACTION_LABELS: Record<NextAction, string> = {
  "Prepare video": "Prepare video",
  "Send personalized email": "Review & send",
  Call: "Call",
  Visit: "Visit",
  Nurture: "Nurture",
  Skip: "Skip",
};

/** "Los Angeles, CA" | "Los Angeles" | "CA" | "" — never leaves dangling commas. */
export function formatLocation(city?: string | null, state?: string | null): string {
  return [city, state].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
}

/** Join non-empty parts with " · " so no dangling separators appear. */
export function joinMeta(...parts: Array<string | null | undefined>): string {
  return parts.map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");
}

/** Turn an internal slug ("ongoing-partnership", "dental_clinic") into readable text. */
export function deslug(s: string | null | undefined): string {
  return (s ?? "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Deslug + capitalize the first letter, for standalone labels/chips. */
export function titleizeSlug(s: string | null | undefined): string {
  const d = deslug(s);
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : "";
}

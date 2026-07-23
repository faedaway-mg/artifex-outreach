// ─────────────────────────────────────────────────────────────────────────────
// The engagement timeline — one chronological story of the whole relationship.
//
// Meetings, memories, roadmap transitions, outcome reviews, business evolution,
// emails, replies, proposals, and baseline snapshots — merged into a single, sorted,
// explainable stream. The operator can scroll the entire consulting relationship in
// one place, and every entry is a real recorded event.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext, TimelineEntry } from "./types";
import { buildEvolution, hasObservation } from "../outcomes";

const at = (s: string | null | undefined) => s || "";
const valid = (e: TimelineEntry) => Boolean(e.at) && !isNaN(Date.parse(e.at));

export function engagementTimeline(ctx: EngagementContext): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const m of ctx.meetings) entries.push({ at: at(m.scheduledAt), source: "meeting", title: "Discovery conversation", detail: m.notes ? m.notes.slice(0, 120) : m.nextStep || undefined });

  for (const mem of ctx.memory) {
    if (mem.status === "Superseded" || mem.status === "Resolved") continue;
    entries.push({ at: at(mem.createdAt), source: "memory", title: `Learned · ${mem.title}`, detail: `${mem.category} · ${mem.value}`.slice(0, 140) });
  }

  for (const p of ctx.progress) entries.push({ at: at(p.updatedAt), source: "roadmap", title: `Roadmap · ${p.title}`, detail: `Moved to ${p.status}` });

  for (const r of ctx.reviews) {
    if (r.status === "Awaiting Review") continue;
    entries.push({ at: at(r.reviewedAt || r.updatedAt), source: "outcome", title: `Outcome · ${r.title}`, detail: `Reviewed: ${r.status}${r.observedOutcome ? ` — ${r.observedOutcome.slice(0, 90)}` : ""}` });
  }

  for (const e of buildEvolution(ctx.reviews.filter(hasObservation), [])) entries.push({ at: e.at, source: "evolution", title: `Change observed · ${e.title}`, detail: e.detail.slice(0, 120) });

  for (const o of ctx.outreach) if (o.sentAt) entries.push({ at: o.sentAt, source: "email", title: `Email sent · ${o.subject}`, detail: o.responseStatus !== "none" ? `Response: ${o.responseStatus}` : undefined });
  for (const i of ctx.inbound) entries.push({ at: at(i.receivedAt), source: "reply", title: "Reply received", detail: i.subject || undefined });

  for (const p of ctx.proposals) {
    if (p.sentAt) entries.push({ at: p.sentAt, source: "proposal", title: `Proposal sent${p.number ? ` · ${p.number}` : ""}`, detail: p.amount != null ? `$${p.amount.toLocaleString()}` : undefined });
    if (p.acceptedAt) entries.push({ at: p.acceptedAt, source: "proposal", title: "Proposal accepted", detail: undefined });
  }

  for (const s of ctx.snapshots) entries.push({ at: at(s.createdAt), source: "snapshot", title: `Baseline captured · ${s.trigger}`, detail: "Immutable 'before' state frozen." });

  return entries.filter(valid).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * READ-ONLY morning-queue reporter. Runs the REAL operator queue logic
 * (buildWorkQueue — the same path the Today view uses) and reports the per-channel
 * candidate pool vs. the daily capacities (email/call/video). No writes.
 */
import "./loadEnv";
import { listLeads, allTasks, getSettings } from "../src/lib/repo";
import { buildWorkQueue } from "../src/lib/work-queue";
import type { Lead } from "../src/lib/types";

function isInternal(l: any): boolean {
  const v = `${l.industry ?? ""} ${l.normalizedCategory ?? ""} ${l.categoryGroup ?? ""}`.toLowerCase();
  return v.includes("internal");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — refusing to run.");
  const [leadsAll, tasks, settings] = await Promise.all([listLeads(), allTasks(), getSettings()]);
  const leads = new Map<string, Lead>(leadsAll.filter((l) => !isInternal(l)).map((l) => [l.id, l as Lead]));
  const open = tasks.filter((t) => t.status === "open" && leads.has(t.leadId));

  const cats = buildWorkQueue({ tasks: open, meetingsToday: [], leads });

  const p = settings.prospecting;
  const cap = {
    email: p.emailDailyTarget ?? 10,
    call: p.callDailyTarget ?? 10,
    video: p.videoDailyTarget ?? 3,
  };

  const countOf = (kind: string) => cats.find((c) => c.kind === kind)?.count ?? 0;

  console.log("──────── MORNING QUEUE (real buildWorkQueue path) ────────");
  console.log(`Daily capacities: email ${cap.email} · call ${cap.call} · video ${cap.video}`);
  console.log("");
  for (const c of cats) console.log(`  ${c.kind.padEnd(14)} pool=${String(c.count).padStart(3)}   ${c.title}`);
  console.log("");
  const emailPool = countOf("email");
  const callPool = countOf("call");
  const followPool = countOf("follow-up");
  const videoPool = countOf("video");
  console.log("──────── ACCEPTANCE (pool → surfaced within capacity) ────────");
  console.log(`  Initial-email candidates:   ${emailPool}  → surfaces ${Math.min(emailPool, cap.email)} / ${cap.email}`);
  console.log(`  Follow-ups due:             ${followPool}`);
  console.log(`  Call candidates (warm/hi):  ${callPool}  → surfaces ${Math.min(callPool, cap.call)} / ${cap.call}`);
  console.log(`  Video candidates:           ${videoPool}  → surfaces ${Math.min(videoPool, cap.video)} / ${cap.video}`);
  console.log("");
  console.log(`  Email queue meets 10 target: ${emailPool >= cap.email ? "YES" : `NO (${emailPool} of ${cap.email})`}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

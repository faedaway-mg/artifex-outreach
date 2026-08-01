// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY preview of the FIRST operational handoff to Alex.
//
// Eight real businesses — one working day, not a mathematical split. Each one is
// re-validated against live production rows at the moment this runs, because a
// preview computed from stale state is a guess wearing a report's clothes.
//
// Nothing is written. No lead is transferred, no audit row is created, no
// ownership column is touched. Contact details, message bodies and recipient
// addresses are never printed — only whether they exist, since that is what
// "will Alex inherit the context?" actually asks.
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

/** The eight the corrected scheduler chose on its own. Named, not inferred. */
const CANDIDATE_NAMES = [
  "Los Angeles Dentist - Studio Smiles",
  "Middletown Ohio Dentist-David J. Roemisch, DDS-Dentist in Middletown OH",
  "Home Construction Burbank",
  "Happy Smiles",
  "Pasadena Dusty Ducts HVAC Services",
  "California Dental Group Los Angeles",
  "Union Dental Center",
  "Bottega Louie",
];

/** Relationships that must stay with Jordan and must never appear below. */
const PROTECTED_NAMES = [
  "L.A Center Jewelry Inc",
  "Westside Pediatric Dental and Orthodontic Group - Santa Monica",
  "Wilshire Law Firm",
  "Villa Brasil Motel",
];

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const yn = (b: boolean) => (b ? "yes" : "no");

async function main() {
  const { listOperators, listLeads, allTasks, allPlans, allMeetings, getSettings } = await import("../src/lib/repo");
  const { planDistribution, computeWorkloads, isActiveConversation, isInternalLead, idleBusinessDays, TERMINAL_STAGES, DEFAULT_POLICY } =
    await import("../src/lib/operators/assignment");
  const { distributionEnabled } = await import("../src/lib/operators/distribute");
  const { workKindForTask } = await import("../src/lib/work-queue");
  const postgres = (await import("postgres")).default;

  const now = new Date();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [operators, leads, tasks, plans, meetings, settings] = await Promise.all([
    listOperators(), listLeads(), allTasks(), allPlans(), allMeetings(), getSettings(),
  ]);
  const ctx = { plans, meetings };
  const openTasks = tasks.filter((t) => t.status === "open");
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const isDue = (leadId: string) =>
    openTasks.some((t) => t.leadId === leadId
      && !(t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now.getTime())
      && new Date(t.dueAt).getTime() <= eod);

  console.log(`read at ${now.toISOString()}`);
  console.log(`gate: distributionEnabled() = ${distributionEnabled()}`);
  console.log(`policy: stale after ${DEFAULT_POLICY.staleAfterBusinessDays} business days · ` +
              `conversation window ${DEFAULT_POLICY.activeConversationDays} days · queue cap ${settings.prospecting.dailyQueueSize}`);

  // ── Alex must be able to receive work at all ──────────────────────────────
  const alex = operators.find((o) => o.id === "alex");
  const jordan = operators.find((o) => o.id === "jordan");
  if (!alex || !jordan) throw new Error("operator missing");
  console.log("\n──────────── RECEIVER CHECK ────────────");
  console.log(`  Alex  active=${yn(alex.active)}  mode=${alex.availabilityMode}  dailyCapacity=${alex.dailyCapacity}  owns=${leads.filter((l) => l.assignedTo === "alex").length}`);
  console.log(`  Jordan active=${yn(jordan.active)} mode=${jordan.availabilityMode} dailyCapacity=${jordan.dailyCapacity}`);

  // ── The corrected scheduler's own conclusion, recomputed live ─────────────
  const plan = planDistribution({ operators, leads, tasks, ctx, now, mode: "maintain" });
  const engineMove = new Map(plan.reassignments.map((r) => [r.leadId, r]));

  // ── Re-validate every candidate ───────────────────────────────────────────
  console.log("\n──────────── CANDIDATE RE-VALIDATION (live rows) ────────────");
  const byName = new Map(leads.map((l) => [l.businessName, l]));
  const qualified: string[] = [];
  const disqualified: Array<{ name: string; why: string }> = [];

  for (const name of CANDIDATE_NAMES) {
    const l = byName.get(name);
    if (!l) { disqualified.push({ name, why: "lead no longer exists" }); continue; }

    const checks: Array<[string, boolean, string]> = [];
    const idle = idleBusinessDays(l, now);
    const live = isActiveConversation(l, ctx, now);
    const futureMeeting = meetings.filter((m) => m.leadId === l.id && new Date(m.scheduledAt) >= now);
    const inbound = await sql`select count(*)::int as n from inbound_messages where lead_id = ${l.id}`;
    const replies = await sql`select count(*)::int as n from outreach where lead_id = ${l.id} and response_status <> 'none'`;
    const ownerAudit = await sql`select count(*)::int as n from audit_log
      where target_type = 'lead' and target_id = ${l.id}
        and action in ('lead.assigned','lead.reassigned','lead.transferred')`;
    const hasWork = openTasks.some((t) => t.leadId === l.id);

    checks.push(["still exists", true, ""]);
    checks.push(["still assigned to Jordan", l.assignedTo === "jordan", `owner=${l.assignedTo}`]);
    checks.push(["not terminal", !TERMINAL_STAGES.has(l.pipelineStage), `stage=${l.pipelineStage}`]);
    checks.push(["not an internal/test record", !isInternalLead(l), `source=${l.source}`]);
    checks.push(["no active conversation", !live, live ? "conversation is live" : ""]);
    checks.push(["still stale (no fresh Jordan activity)", (idle ?? 0) >= DEFAULT_POLICY.staleAfterBusinessDays, `idle=${idle} business days`]);
    checks.push(["no meeting booked", futureMeeting.length === 0, `${futureMeeting.length} upcoming`]);
    checks.push(["no reply received", Number(inbound[0].n) === 0 && Number(replies[0].n) === 0, `inbound=${inbound[0].n} replies=${replies[0].n}`]);
    checks.push(["no manual ownership change", Number(ownerAudit[0].n) === 0, `${ownerAudit[0].n} ownership events`]);
    checks.push(["has legitimate open work", hasWork, `${openTasks.filter((t) => t.leadId === l.id).length} open task(s)`]);
    checks.push(["scheduler still ranks Alex better", engineMove.get(l.id)?.to === "alex", engineMove.get(l.id) ? `→ ${engineMove.get(l.id)!.to}` : "no move proposed"]);

    const failed = checks.filter(([, ok]) => !ok);
    console.log(`\n  ${name}`);
    for (const [label, ok, detail] of checks) console.log(`    ${ok ? "✓" : "✗"} ${pad(label, 40)} ${detail}`);
    if (failed.length) disqualified.push({ name, why: failed.map(([l2, , d]) => `${l2}${d ? ` (${d})` : ""}`).join("; ") });
    else qualified.push(l.id);
  }

  // ── The proposed batch, in full ───────────────────────────────────────────
  console.log("\n──────────── PROPOSED HANDOFF ────────────");
  console.log(`  qualified: ${qualified.length} of ${CANDIDATE_NAMES.length}`);
  for (const id of qualified) {
    const l = leads.find((x) => x.id === id)!;
    const mine = openTasks.filter((t) => t.leadId === id).sort((a, b) => b.priority - a.priority);
    const next = mine[0];
    const move = engineMove.get(id)!;
    const plan0 = plans.find((p) => p.leadId === id);
    const contactRows = await sql`select count(*)::int as n, count(email)::int as with_email, sum(case when opted_out then 1 else 0 end)::int as opted from contacts where lead_id = ${id}`;
    const sends = await sql`select count(*)::int as n from email_sends where lead_id = ${id}`;
    const findingRows = await sql`select count(*)::int as n from findings where lead_id = ${id}`;
    const auditRows = await sql`select count(*)::int as n from audit_log where target_type='lead' and target_id=${id}`;
    const supp = await sql`select count(*)::int as n from suppressions
      where lower(email) = lower(${l.publicEmail ?? "-"}) or lower(domain) = lower(${l.websiteDomain ?? "-"})`;

    console.log(`\n  ── ${l.businessName}`);
    console.log(`     id .................. ${l.id}`);
    console.log(`     stage ............... ${l.pipelineStage}`);
    console.log(`     work kind ........... ${next ? workKindForTask(next, l) : "—"}`);
    console.log(`     open tasks .......... ${mine.length}`);
    console.log(`     due today ........... ${yn(isDue(id))}`);
    console.log(`     last operator activity ${l.lastOperatorActivityAt ?? l.assignedAt ?? "never"}`);
    console.log(`     business days idle .. ${idleBusinessDays(l, now)}`);
    console.log(`     active conversation . ${yn(isActiveConversation(l, ctx, now))}`);
    console.log(`     current owner ....... ${l.assignedTo}`);
    console.log(`     proposed owner ...... ${move.to}`);
    console.log(`     transfer code ....... ${move.code}`);
    console.log(`     transfer reason ..... ${move.reason}`);
    console.log(`     why Alex ranks better:`);
    for (const b of move.because) console.log(`        · ${b}`);
    console.log(`     context Alex inherits:`);
    console.log(`        note on record ... ${l.note ? `yes (${l.note.length} chars)` : "none"}`);
    console.log(`        contacts ......... ${contactRows[0].n} (${contactRows[0].with_email} with email, ${contactRows[0].opted ?? 0} opted out)`);
    console.log(`        findings ......... ${findingRows[0].n}`);
    console.log(`        acquisition plan . ${plan0 ? `${plan0.strategy} · status ${plan0.status} · approval ${plan0.approvalStatus} · step ${plan0.currentStep}/${plan0.maxTouches}` : "none"}`);
    console.log(`        email sends ...... ${sends[0].n}`);
    console.log(`        suppressed ....... ${Number(supp[0].n) > 0 ? "YES — sending blocked" : "no"}`);
    console.log(`        timeline entries . ${auditRows[0].n}`);
    console.log(`        last contact ..... ${l.lastContactAt ?? "never"}`);
    console.log(`        next follow-up ... ${l.nextFollowUpAt ?? "none"}`);
    console.log(`     immediate next action Alex sees:`);
    console.log(`        ${next ? `${next.type} — ${next.title} (due ${next.dueAt})` : "nothing open"}`);
  }

  // ── Before / after, real businesses only ──────────────────────────────────
  const before = computeWorkloads(operators, leads, tasks, now);
  const moved = new Set(qualified);
  const projectedLeads = leads.map((l) => (moved.has(l.id) ? { ...l, assignedTo: "alex" } : l));
  const after = computeWorkloads(operators, projectedLeads, tasks, now);

  console.log("\n──────────── WORKLOAD — BEFORE ────────────");
  for (const o of [jordan, alex]) {
    const w = before.get(o.id)!;
    console.log(`  ${pad(o.name, 16)} real businesses ${String(w.leadsOwned).padStart(3)}   due today ${w.dueToday}   capacity ${w.capacity}   headroom ${w.headroom}`);
  }
  console.log("\n──────────── WORKLOAD — AFTER THE PROPOSED EIGHT ────────────");
  for (const o of [jordan, alex]) {
    const w = after.get(o.id)!;
    console.log(`  ${pad(o.name, 16)} real businesses ${String(w.leadsOwned).padStart(3)}   due today ${w.dueToday}   capacity ${w.capacity}   headroom ${w.headroom}`);
  }

  // ── Protected relationships ───────────────────────────────────────────────
  console.log("\n──────────── PROTECTED — MUST REMAIN WITH JORDAN ────────────");
  for (const name of PROTECTED_NAMES) {
    const l = byName.get(name);
    if (!l) { console.log(`  ${pad(name, 52)} NOT FOUND`); continue; }
    console.log(`  ${pad(name, 52)} owner=${l.assignedTo}  live=${yn(isActiveConversation(l, ctx, now))}  ` +
                `in batch=${yn(moved.has(l.id))}`);
  }
  const liveNow = leads.filter((l) => isActiveConversation(l, ctx, now) && !isInternalLead(l));
  const extra = liveNow.filter((l) => !PROTECTED_NAMES.includes(l.businessName));
  console.log(`  live conversations in the book: ${liveNow.length}`);
  console.log(`  NEWLY live since the last preview: ${extra.length}`);
  for (const l of extra) console.log(`    ${l.businessName} (${l.pipelineStage})`);

  // ── Internal test data ────────────────────────────────────────────────────
  const internal = leads.filter(isInternalLead);
  console.log("\n──────────── INTERNAL TEST RECORDS (excluded, not deleted) ────────────");
  for (const l of internal) {
    console.log(`  ${pad(l.businessName, 40)} source=${pad(l.source ?? "-", 24)} industry=${l.industry} owner=${l.assignedTo}`);
  }
  console.log(`  count ${internal.length} · open tasks ${openTasks.filter((t) => internal.some((l) => l.id === t.leadId)).length} · counted toward anyone's load: no`);

  // ── Ownership is unchanged ────────────────────────────────────────────────
  const dist = await sql`select assigned_to, count(*)::int as n from leads group by assigned_to order by assigned_to`;
  const ownEvents = await sql`select count(*)::int as n from audit_log where action in ('lead.assigned','lead.reassigned','lead.transferred')`;
  console.log("\n──────────── OWNERSHIP STATE (live) ────────────");
  for (const r of dist) console.log(`  ${r.assigned_to ?? "unassigned"}: ${r.n}`);
  console.log(`  ownership audit events in the entire workspace: ${ownEvents[0].n}`);

  if (disqualified.length) {
    console.log("\n──────────── CANDIDATES THAT NO LONGER QUALIFY ────────────");
    for (const d of disqualified) console.log(`  ${d.name}\n    why: ${d.why}`);
    const inBatch = new Set(qualified);
    const replacements = plan.reassignments.filter((r) => r.to === "alex" && !inBatch.has(r.leadId));
    console.log("  strongest eligible replacements (NOT inserted into the batch):");
    for (const r of replacements.slice(0, 3)) console.log(`    ${r.businessName} — ${r.reason}`);
    if (!replacements.length) console.log("    none available");
  }

  await sql.end();
  console.log("\nrows written by this script: 0");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

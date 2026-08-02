// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY assertion of the Phase 2 role activation, item by item, against LIVE
// production rows. Every capability below is computed by the deployed code from
// the actual users.role value — nothing is asserted from the seed file or from
// what the code "should" say.
//
// Nothing is written. Nothing is performed: impersonation authority is COMPUTED,
// not entered; the rebalance is PREVIEWED, not applied.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/verify-role-activation.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

let fail = 0;
const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail = 1; };
const chk = (c: boolean, m: string) => (c ? ok(m) : bad(m));

async function main() {
  const { listOperators, listLeads, listAudit } = await import("../src/lib/repo");
  const { roleOf, ROLE_LABEL, capabilitiesOf, canImpersonate } = await import("../src/lib/operators/roles");
  const { distributionEnabled } = await import("../src/lib/operators/distribute");

  const operators = await listOperators();
  const jordan = operators.find((o) => o.id === "jordan")!;
  const alex = operators.find((o) => o.id === "alex")!;

  console.log("\n[1] ENDING PRODUCTION ROLE STATE");
  for (const o of [jordan, alex]) {
    console.log(`        ${o.id.padEnd(8)} users.role=${JSON.stringify(o.role).padEnd(22)} -> ${ROLE_LABEL[roleOf(o)]}`);
  }
  chk(roleOf(jordan) === "founder", "Jordan is Founder (unchanged — NOT moved to Engineering)");
  chk(roleOf(alex) === "head_of_outreach", "Alex is Head of Outreach");

  console.log("\n[2] ALEX'S CAPABILITIES");
  const a = capabilitiesOf(alex);
  chk(a.viewTeam, "Alex can access Team Management");
  chk(a.transferWork, "Alex can transfer leads");
  chk(a.createOperator, "Alex can create operators");
  chk(a.manageOperators, "Alex can manage operators");
  chk(a.rebalance, "Alex can rebalance");
  chk(a.impersonate, "Alex can impersonate operators");
  chk(!a.changePolicy, "Alex CANNOT change system policy");

  console.log("\n[3] JORDAN'S CAPABILITIES");
  const j = capabilitiesOf(jordan);
  chk(j.viewTeam, "Jordan can access Team Management");
  chk(j.transferWork, "Jordan can transfer leads");
  chk(j.createOperator, "Jordan can create operators");
  chk(j.manageOperators, "Jordan can manage operators");
  chk(j.rebalance, "Jordan can rebalance");
  chk(j.impersonate, "Jordan can impersonate operators");
  chk(j.changePolicy, "Jordan CAN change system policy");

  console.log("\n[4] THE ONLY INTENTIONAL DIFFERENCE IS SYSTEM POLICY");
  const differ = (Object.keys(j) as Array<keyof typeof j>).filter((k) => j[k] !== a[k]);
  console.log(`        capabilities that differ: ${differ.join(", ") || "(none)"}`);
  chk(differ.length === 1 && differ[0] === "changePolicy",
      "Jordan and Alex are identical on every outreach capability; only changePolicy differs");

  console.log("\n[5] IMPERSONATION AUTHORITY (computed, never performed)");
  const jToA = canImpersonate(jordan, alex);
  const aToJ = canImpersonate(alex, jordan);
  console.log(`        jordan -> alex  ${jToA.ok ? "ALLOWED" : "REFUSED"}  ${jToA.reason}`);
  console.log(`        alex   -> jordan ${aToJ.ok ? "ALLOWED" : "REFUSED"}  ${aToJ.reason}`);
  chk(jToA.ok, "Jordan may view as Alex");
  chk(!aToJ.ok, "Alex may NOT view as Jordan — impersonation cannot reach authority he lacks");

  console.log("\n[6] SAFETY GATES");
  chk(distributionEnabled() === false, "OPERATOR_DISTRIBUTION_ENABLED is OFF (rebalance is preview-only)");
  chk(!process.env.OUTREACH_SENDING_ENABLED, "OUTREACH_SENDING_ENABLED is not set — sending OFF");
  chk(!process.env.COMMS_AUTOSEND_ENABLED, "COMMS_AUTOSEND_ENABLED is not set — autosend OFF");

  console.log("\n[7] OWNERSHIP UNCHANGED");
  const leads = await listLeads();
  const byOwner = new Map<string, number>();
  for (const l of leads) byOwner.set(l.assignedTo ?? "(unassigned)", (byOwner.get(l.assignedTo ?? "(unassigned)") ?? 0) + 1);
  for (const [o, n] of byOwner) console.log(`        ${o}: ${n} leads`);
  chk(byOwner.get("jordan") === 32 && byOwner.size === 1, "all 32 businesses still owned by jordan — zero leads moved");
  chk((byOwner.get("alex") ?? 0) === 0, "Alex owns nothing — the eight-lead handoff remains unapplied");

  console.log("\n[8] THE AUDIT ROW WRITTEN BY THIS CHANGE");
  const audit = await listAudit(400);
  const roleRows = audit.filter((e) => e.action === "operator.role");
  for (const r of roleRows) {
    const m = r.meta as Record<string, unknown>;
    console.log(`        ${r.createdAt}  actor=${r.actor} target=${r.targetId} from=${JSON.stringify(m.from)} to=${JSON.stringify(m.to)}`);
    console.log(`          reason: ${m.reason}`);
  }
  chk(roleRows.length === 1, "exactly one operator.role audit entry exists");

  // The original entry misstates its own `from` value. It is NOT edited — a
  // correction is appended beside it. Both rows are asserted here so the pair
  // stays legible to whoever reads this log without the report next to them.
  const fixes = audit.filter((e) => e.action === "operator.role.corrected");
  for (const r of fixes) {
    const m = r.meta as Record<string, unknown>;
    console.log(`        ${r.createdAt}  corrects=${m.corrects} recorded=${JSON.stringify(m.recordedFrom)} actual=${JSON.stringify(m.actualFrom)}`);
  }
  chk(fixes.length === 1, "exactly one correction entry exists");
  const fix = fixes[0]?.meta as Record<string, unknown> | undefined;
  chk(fix?.corrects === roleRows[0]?.id, "the correction names the entry it corrects");
  chk(fix?.actualFrom === "Operator", "the correction records Alex's true prior role");
  chk(fix?.changesRole === false, "the correction changes no role");
  chk((roleRows[0]?.meta as Record<string, unknown>)?.from === "head_of_outreach",
      "the original entry is untouched — history is appended to, never rewritten");

  const owns = audit.filter((e) => ["lead.assigned", "lead.reassigned", "lead.transferred", "lead.released"].includes(e.action));
  chk(owns.length === 0, "zero ownership events in the entire audit log");

  console.log(`\n${fail === 0 ? "ALL ROLE ACTIVATION CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  console.log("rows written by this script: 0");
  process.exit(fail);
}

main().catch((e) => { console.error(e); process.exit(1); });

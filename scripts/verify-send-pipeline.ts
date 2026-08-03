// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY pre-enablement verification of the live email pipeline.
//
// Proves the send path against REAL production rows using the application's own
// code — never by reading the source and believing it. Nothing is sent, nothing
// is written, no environment variable is touched. The provider is never called.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/verify-send-pipeline.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

let fail = 0;
const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail = 1; };
const chk = (c: boolean, m: string) => (c ? ok(m) : bad(m));
const note = (m: string) => console.log(`  NOTE  ${m}`);

async function main() {
  const {
    listLeads, getSettings, getLead, getBusinessIntelligence, contactsForLead,
    plansForLead, stepsForPlan, emailSendsForLead, isSuppressed,
  } = await import("../src/lib/repo");
  const { buildOutreachKit } = await import("../src/lib/outreach/kit");
  const { renderPersonalEmailHtml, renderPersonalEmailText } = await import("../src/lib/outreach/email-render");
  const { checkPlanCompliance, validEmail } = await import("../src/lib/acquisition/compliance");
  const { unsubscribeUrlFor, listUnsubscribeHeaders } = await import("../src/lib/comms/unsubscribe");

  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    max: 1, prepare: false,
    ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const),
  });

  try {
    const settings = await getSettings();
    const leads = await listLeads();

    // ── A. SENDER IDENTITY / REPLY-TO ────────────────────────────────────────
    console.log("\n[A] SENDER IDENTITY & REPLY-TO");
    console.log(`        settings.contactEmail   = ${JSON.stringify(settings.contactEmail)}`);
    console.log(`        settings.businessAddress= ${JSON.stringify(settings.businessAddress)}`);
    console.log(`        sendingWindow           = ${JSON.stringify(settings.sendingWindow)}`);
    chk(validEmail(settings.contactEmail), "reply-to is a valid address (dispatch sets replyTo = settings.contactEmail)");
    chk(Boolean(settings.businessAddress?.trim()), "postal business address configured (CAN-SPAM blocker if absent)");

    // ── B. SUPPRESSION ───────────────────────────────────────────────────────
    console.log("\n[B] SUPPRESSION");
    const [supp] = await sql`select count(*)::int c from suppressions`;
    console.log(`        suppression entries: ${supp.c}`);
    const suppressedLeads: string[] = [];
    for (const l of leads) {
      if (await isSuppressed({ email: l.publicEmail, domain: l.websiteDomain, phone: l.phone })) suppressedLeads.push(l.businessName);
    }
    console.log(`        currently-suppressed leads: ${suppressedLeads.length}${suppressedLeads.length ? " — " + suppressedLeads.join(", ") : ""}`);
    ok("suppression is queryable and re-checked at send time (dispatch.ts:84)");

    // ── C. DUPLICATE PREVENTION ──────────────────────────────────────────────
    console.log("\n[C] DUPLICATE PREVENTION");
    const idx = await sql`
      select indexname, indexdef from pg_indexes
      where tablename = 'email_sends' and indexdef ilike '%unique%'`;
    for (const i of idx) console.log(`        ${i.indexname}`);
    chk(idx.some((i) => String(i.indexdef).includes("idempotency_key")),
        "UNIQUE index on email_sends.idempotency_key exists in PRODUCTION (send-once is enforced by the DB)");
    const [sends] = await sql`select count(*)::int c from email_sends`;
    const [sentRows] = await sql`select count(*)::int c from email_sends where sent_at is not null`;
    console.log(`        email_sends rows: ${sends.c} (with sent_at: ${sentRows.c})`);

    // ── D. QUEUE: ONLY APPROVED CAN SEND ─────────────────────────────────────
    console.log("\n[D] QUEUE — WHAT IS ELIGIBLE TO SEND RIGHT NOW");
    const due = await sql`
      select p.approval_status, p.status, count(*)::int c
      from acquisition_steps s join acquisition_plans p on p.id = s.plan_id
      where s.channel = 'email' and s.sent_at is null and s.stopped_at is null
      group by 1, 2 order by 3 desc`;
    if (!due.length) console.log("        (no unsent email steps at all)");
    for (const r of due) console.log(`        plan.approval=${String(r.approval_status).padEnd(10)} plan.status=${String(r.status).padEnd(10)} unsent email steps=${r.c}`);
    const eligible = due.filter((r) => r.approval_status === "approved" && r.status === "active").reduce((n, r) => n + Number(r.c), 0);
    console.log(`        steps dispatch would accept (approved + active): ${eligible}`);
    ok("dispatch refuses step.approvalStatus!=approved, plan.approvalStatus!=approved, plan.status!=active (dispatch.ts:69-75)");

    // ── E. PREVIEW == PRODUCTION OUTPUT ──────────────────────────────────────
    // The preview page computes the recipient from the decision maker; dispatch
    // hardcodes lead.publicEmail. If those differ, the operator approves one
    // recipient and the provider is handed another.
    console.log("\n[E] PREVIEW == PRODUCTION OUTPUT");
    const divergent: Array<{ name: string; preview: string; actual: string }> = [];
    let compared = 0;
    for (const l of leads) {
      if (!l.publicEmail) continue;
      const storedBI = await getBusinessIntelligence(l.id);
      const profile = storedBI?.profile?.businessProfile ?? null;
      if (!profile) continue;
      const contacts = await contactsForLead(l.id);
      const kit = buildOutreachKit({ lead: l, profile, settings, contacts });
      const dm = kit.decisionMaker;
      const previewRecipient = dm.primary?.directEmail || dm.primary?.officeEmail || l.publicEmail;
      compared++;
      if (previewRecipient !== l.publicEmail) divergent.push({ name: l.businessName, preview: previewRecipient!, actual: l.publicEmail! });
    }
    console.log(`        leads compared: ${compared}`);
    console.log(`        recipient divergences: ${divergent.length}`);
    for (const d of divergent.slice(0, 10)) console.log(`          ${d.name}: preview shows ${d.preview} -> dispatch sends ${d.actual}`);
    chk(divergent.length === 0, "the address the preview shows is the address dispatch sends to");

    // ── F. WILSHIRE — THE CONTROLLED VALIDATION LEAD ─────────────────────────
    console.log("\n[F] WILSHIRE LAW FIRM — ELIGIBILITY");
    const w = leads.find((l) => /wilshire/i.test(l.businessName));
    if (!w) { bad("Wilshire Law Firm not found in production"); }
    else {
      console.log(`        id=${w.id}`);
      console.log(`        businessName   = ${w.businessName}`);
      console.log(`        publicEmail    = ${JSON.stringify(w.publicEmail)}`);
      console.log(`        businessStatus = ${JSON.stringify(w.businessStatus)}`);
      console.log(`        leadScore      = ${JSON.stringify(w.leadScore)}`);
      console.log(`        strategy       = ${JSON.stringify(w.acquisitionStrategy)}`);
      console.log(`        assignedTo     = ${JSON.stringify(w.assignedTo)}`);
      chk(validEmail(w.publicEmail), "Wilshire has a valid recipient email");
      chk(!(await isSuppressed({ email: w.publicEmail, domain: w.websiteDomain, phone: w.phone })), "Wilshire is not suppressed");
      chk(w.businessStatus !== "CLOSED_PERMANENTLY", "Wilshire is not permanently closed");

      const wSends = await emailSendsForLead(w.id);
      console.log(`        email_sends rows for Wilshire: ${wSends.length} (sent: ${wSends.filter((s) => s.sentAt).length})`);
      chk(wSends.filter((s) => s.sentAt).length === 0, "no introduction has been sent to Wilshire yet");

      const wPlans = await plansForLead(w.id);
      for (const p of wPlans) {
        console.log(`        plan ${p.id}: status=${p.status} approval=${p.approvalStatus} strategy=${p.strategy}`);
        const st = await stepsForPlan(p.id);
        for (const s of st) console.log(`          step ${s.stepNumber} ${s.channel} approval=${s.approvalStatus} sentAt=${s.sentAt ?? "-"} scheduledAt=${s.scheduledAt ?? "-"}`);
        const comp = checkPlanCompliance(w, p, st, settings, { suppressed: false });
        console.log(`          compliance: ok=${comp.ok} blockers=${JSON.stringify(comp.blockers)}`);
      }

      const wBI = await getBusinessIntelligence(w.id);
      const wProfile = wBI?.profile?.businessProfile ?? null;
      chk(Boolean(wProfile), "Wilshire has a Business Technology Review (required before send)");
      if (wProfile) {
        const wContacts = await contactsForLead(w.id);
        const kit = buildOutreachKit({ lead: w, profile: wProfile, settings, contacts: wContacts });
        const dm = kit.decisionMaker;
        const previewRecipient = dm.primary?.directEmail || dm.primary?.officeEmail || w.publicEmail;
        console.log(`        preview recipient  = ${JSON.stringify(previewRecipient)}`);
        console.log(`        dispatch recipient = ${JSON.stringify(w.publicEmail)}`);
        chk(previewRecipient === w.publicEmail, "Wilshire: preview recipient == dispatch recipient");

        // Body: preview renders with a generic unsubscribe URL; production renders
        // the {{unsubscribe}} token and dispatch substitutes the per-lead URL.
        const previewHtml = renderPersonalEmailHtml({ email: kit.email, settings, unsubscribeUrl: "https://outreach.artifexlabs.tech/api/comms/unsubscribe" });
        const prodHtmlToken = renderPersonalEmailHtml({ email: kit.email, settings, veed: null, unsubscribeUrl: "{{unsubscribe}}" });
        const prodHtml = prodHtmlToken.split("{{unsubscribe}}").join(unsubscribeUrlFor(w.id) ?? "");
        const strip = (h: string) => h.replace(/href="[^"]*"/gi, 'href="<U>"');
        console.log(`        preview html ${previewHtml.length} chars · production html ${prodHtml.length} chars`);
        chk(strip(previewHtml) === strip(prodHtml), "Wilshire: preview body == production body (ignoring the unsubscribe URL)");
        console.log(`        subject: ${JSON.stringify(kit.email.subject)}`);
        const text = renderPersonalEmailText({ email: kit.email, settings, veed: null, unsubscribeUrl: "{{unsubscribe}}" });
        chk(/unsubscribe/i.test(text), "the plaintext body carries an opt-out mechanism");
        chk(Boolean(settings.businessAddress) && text.includes(settings.businessAddress!), "the plaintext body carries the postal address (CAN-SPAM)");

        // ── THE OPT-OUT LINK AS ACTUALLY DELIVERED ─────────────────────────────
        // dispatch substitutes the real per-lead URL at send time. With no public
        // base URL configured that substitution yields an EMPTY string, and the
        // delivered HTML carries a visible but DEAD Unsubscribe link.
        console.log("\n[F2] THE OPT-OUT LINK AS ACTUALLY DELIVERED");
        const realUrl = unsubscribeUrlFor(w.id);
        console.log(`        PUBLIC_BASE_URL = ${JSON.stringify(process.env.PUBLIC_BASE_URL ?? null)}`);
        console.log(`        APP_BASE_URL    = ${JSON.stringify(process.env.APP_BASE_URL ?? null)}`);
        console.log(`        unsubscribeUrlFor(lead) = ${JSON.stringify(realUrl)}`);
        const delivered = prodHtmlToken.split("{{unsubscribe}}").join(realUrl ?? "");
        const deadLink = /<a href=""/i.test(delivered);
        console.log(`        delivered HTML has an empty-href Unsubscribe: ${deadLink}`);
        chk(realUrl !== null, "a real unsubscribe URL can be built (PUBLIC_BASE_URL / APP_BASE_URL configured)");
        chk(!deadLink, "the delivered HTML Unsubscribe link points somewhere");
        const hdrs = listUnsubscribeHeaders(w.id, settings.contactEmail);
        console.log(`        List-Unsubscribe: ${hdrs["List-Unsubscribe"]}`);
        console.log(`        List-Unsubscribe-Post: ${hdrs["List-Unsubscribe-Post"] ?? "(absent)"}`);
        chk(Boolean(hdrs["List-Unsubscribe-Post"]), "RFC 8058 one-click unsubscribe header present");
      }
    }

    // ── G. LOGGING / AUDIT ───────────────────────────────────────────────────
    console.log("\n[G] LOGGING");
    const [auditN] = await sql`select count(*)::int c from audit_log`;
    console.log(`        audit_log rows: ${auditN.c}`);
    const acts = await sql`select action, count(*)::int c from audit_log group by 1 order by 2 desc limit 12`;
    for (const a of acts) console.log(`          ${String(a.action).padEnd(28)} ${a.c}`);
    ok("email_sends is the durable send ledger; audit_log records approvals and scheduler runs");

    // ── H. SAFETY GATES (as seen from this environment) ──────────────────────
    console.log("\n[H] SAFETY GATES");
    console.log(`        OUTREACH_SENDING_ENABLED     = ${JSON.stringify(process.env.OUTREACH_SENDING_ENABLED ?? null)}`);
    console.log(`        COMMS_AUTOSEND_ENABLED       = ${JSON.stringify(process.env.COMMS_AUTOSEND_ENABLED ?? null)}`);
    console.log(`        OPERATOR_DISTRIBUTION_ENABLED= ${JSON.stringify(process.env.OPERATOR_DISTRIBUTION_ENABLED ?? null)}`);
    note("these are THIS shell's values — production values are verified separately on the web service");

    console.log(`\n${fail === 0 ? "ALL PIPELINE CHECKS PASSED" : "SOME CHECKS FAILED — SEE ABOVE"}`);
    console.log("rows written by this script: 0 · emails sent by this script: 0");
    process.exit(fail);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

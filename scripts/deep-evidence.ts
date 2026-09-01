// Deep per-site evidence runner (final revenue-blocker delta). Captures a business's own pages, derives
// ONLY directly-observed findings, and — with `persist` — writes them into the existing pipeline
// (business_intelligence.profile.opportunities + a ready screenshot job for the finding's source page)
// so buildQuickReview → the evidence gate → the render worker produce a genuinely evidence-backed video.
// No fabrication: a site with no supported finding yields nothing and stays Needs-evidence.
//
// Usage (via tsx):
//   tsx scripts/deep-evidence.ts smoke <url> [industry] [businessName]   — capture+derive one site, print
//   tsx scripts/deep-evidence.ts leads <leadId,leadId,...>               — from DB, print findings+BreakBot
//   tsx scripts/deep-evidence.ts narrate <leadId,leadId,...>             — capture + preview value-dense scripts (no writes)
//   tsx scripts/deep-evidence.ts persist <leadId,leadId,...>             — persist opps + screenshot + value-dense template
//   tsx scripts/deep-evidence.ts stale <leadId,leadId,...> [deficiency]  — invalidate stale narration → needs-evidence (no capture)
import postgres from "postgres";
import { createRequire } from "node:module";
import { deriveObservedFindings, distinctByTopic, toOpportunities, isSpeculative, type SiteEvidence, type ObservedFinding } from "../src/lib/content-studio/site-evidence";
import { compareClientScripts } from "../src/lib/content-studio/script-distinctness";
import { composeClientNarration, assessScriptQuality } from "../src/lib/content-studio/client-narration";

const require = createRequire(import.meta.url);

async function loadCapture() {
  // site-capture.mjs pulls in Playwright; import lazily so `leads` listing without capture stays cheap.
  return await import("./lib/site-capture.mjs");
}
async function loadArtifacts() { return await import("./lib/cs-artifacts.mjs"); }

function db() {
  const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("CS_DATABASE_URL/DATABASE_URL required");
  const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
  return postgres(url, { max: 3, prepare: false, ssl });
}

function printFindings(site: SiteEvidence, findings: ObservedFinding[]) {
  console.log(`\n=== ${site.businessName} (${site.leadId || "—"}) — ${site.website}`);
  console.log(`    pages inspected: ${site.pages.map((p) => `${p.role}:${p.status}${p.role === "home" ? `(overflow ${p.overflowPx}px, nav ${p.navItemCount}, forms ${p.forms.length}, ctas ${p.primaryCtas.length}, booking ${p.bookingSignals.length}, tel ${p.phoneLinks}, mail ${p.mailLinks}, brokenImg ${p.brokenAssets})` : ""}`).join(" | ")}`);
  const kept = distinctByTopic(findings);
  if (!kept.length) { console.log("    FINDINGS: none directly observed → Needs evidence"); return kept; }
  for (const f of kept) {
    const spec = isSpeculative(f.observation) ? "  ⚠SPECULATIVE" : "";
    console.log(`    [${f.impactLevel}/${f.topic}] ${f.key}${spec}\n      obs: ${f.observation}\n      basis: ${f.basis.slice(0, 3).join(" | ")}`);
  }
  return kept;
}

async function captureLead(cap: any, row: any): Promise<{ site: SiteEvidence; shots: Map<string, { png: Buffer; sha256: string }>; findings: ObservedFinding[] }> {
  const { site, shots } = await cap.captureSite({ website: row.website, industry: row.industry, leadId: row.id, businessName: row.business_name });
  const stamped: SiteEvidence = { ...site, capturedAt: new Date().toISOString() };
  const findings = deriveObservedFindings(stamped);
  return { site: stamped, shots, findings };
}

async function main() {
  const [mode, arg, industry, name] = process.argv.slice(2);
  if (mode === "smoke") {
    const cap: any = await loadCapture();
    const { site, shots } = await cap.captureSite({ website: arg, industry: industry || null, leadId: "", businessName: name || new URL(arg).host });
    const stamped: SiteEvidence = { ...site, capturedAt: new Date().toISOString() };
    printFindings(stamped, deriveObservedFindings(stamped));
    console.log(`    shots: ${[...shots.keys()].length} page PNG(s)`);
    return;
  }

  if (mode === "canary") {
    // End-to-end interior-screenshot render canary: drive the REAL render worker over one saved
    // evidence-backed template with a SYNTHETIC voiceover, then prove (visual-acceptance harness) that the
    // SHA-verified screenshot composites into an INTERIOR frame — not just the poster. No prospect involved.
    const leadId = arg;
    const pieceId = `client-${leadId}`;
    const art: any = await loadArtifacts();
    const { assessGenerationEvidence } = await import("../src/lib/content-studio/evidence-gate");
    const va: any = await import("./cs-visual-acceptance.mjs");
    const { execFileSync, spawnSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sql = db();
    try {
      const tpl: any = await art.loadTemplatePgDoc(pieceId);
      if (!tpl) throw new Error("template not found: " + pieceId);
      const shotRow: any = (await sql`SELECT output_key, sha256, final_url FROM content_studio_screenshot_jobs WHERE business_id=${leadId} AND status='ready' AND output_key IS NOT NULL ORDER BY captured_at DESC LIMIT 1`)[0];
      if (!shotRow) throw new Error("no ready screenshot for " + leadId);
      const liveShot = { outputKey: shotRow.output_key, sha256: shotRow.sha256, sourceUrl: shotRow.final_url, pageTitle: "Homepage" };
      const gate = assessGenerationEvidence({ template: tpl, liveShot });
      if (!gate.ok) throw new Error("gate not ok: " + gate.reason);
      console.log(`canary: ${pieceId} gate.ok=${gate.ok} evidenceScenes=${gate.evidenceScenes} narration lines=${tpl.narration.length}`);

      // Synthetic VO: one tone burst per narration line, separated by real silence (so silencedetect finds
      // per-line onsets the template timeline anchors to). Purely internal — never sent to anyone.
      const tmpDir = path.join(process.cwd(), ".tmp-canary");
      fs.rmSync(tmpDir, { recursive: true, force: true }); fs.mkdirSync(tmpDir, { recursive: true });
      const L = tpl.narration.length; const segs: string[] = [];
      for (let i = 0; i < L; i++) {
        const tone = path.join(tmpDir, `t${i}.wav`), sil = path.join(tmpDir, `s${i}.wav`);
        execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=${200 + i * 50}:duration=1.2`, "-ar", "44100", "-ac", "1", tone], { stdio: "ignore" });
        execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono:duration=0.5`, "-ar", "44100", "-ac", "1", sil], { stdio: "ignore" });
        segs.push(tone, sil);
      }
      const listFile = path.join(tmpDir, "list.txt");
      fs.writeFileSync(listFile, segs.map((s) => `file '${s}'`).join("\n"));
      const voPath = path.join(tmpDir, `vo-${leadId}.mp3`);
      execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-q:a", "4", voPath], { stdio: "ignore" });

      // Build the worker's job file exactly as runner.ts would (storyboard from the gate + bound screenshot).
      const jobId = `canary_${leadId}`.replace(/[^0-9a-z_]/gi, "_");
      const jobsDir = path.join(process.cwd(), ".data", "content-studio", "jobs"); fs.mkdirSync(jobsDir, { recursive: true });
      const jobFile = path.join(jobsDir, `${jobId}.json`);
      const job = { jobId, pieceId, mode: "uploaded-vo", audioFile: voPath, screenshotKey: liveShot.outputKey, screenshotSha: liveShot.sha256, storyboard: gate.storyboard, inputVersion: "canary1", audioLabel: "synthetic canary VO (internal)" };
      fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

      console.log(`canary: rendering via real worker (scripts/content-studio-render.mjs ${jobId})…`);
      const res = spawnSync(process.execPath, ["scripts/content-studio-render.mjs", jobId], { stdio: "inherit", env: { ...process.env, CS_STORAGE_PROVIDER: "postgres", CS_ARTIFACT_ENV: "production" } });
      if (res.status !== 0) throw new Error("render worker exited " + res.status);
      const done: any = JSON.parse(fs.readFileSync(jobFile, "utf8"));
      if (done.status !== "ready") throw new Error("render not ready: " + (done.error || done.status));
      const mp4 = done.outputFile;
      const ev = (done.evidenceScenes || [])[0];
      if (!ev) throw new Error("no evidence scene recorded in output — screenshot did not composite into an interior frame");
      const { path: pngPath } = await art.materializeArtifact(liveShot.outputKey, { destDir: tmpDir, filename: "ref.png", expectedSha: liveShot.sha256 });
      const probe = va.probeOutput(mp4);
      const evidenceAt = ev.at + Math.min(0.8, Math.max(0.2, (ev.end - ev.at) / 2));
      const controlAt = 0.6; // a title/statement beat (NOT the poster at t=0, NOT the evidence scene)
      const verdict = va.verifyEvidenceScene({ mp4, screenshotPng: pngPath, evidenceAt, controlAt });
      console.log(`canary probe: ${JSON.stringify(probe)}`);
      console.log(`canary evidence scene @${ev.at}s–${ev.end}s (line ${ev.line}); sampling evidence@${evidenceAt.toFixed(2)}s control@${controlAt}s`);
      console.log(`canary verdict: ok=${verdict.ok} dEvidence=${verdict.dEvidence} dControl=${verdict.dControl} evLuma=${verdict.evLuma} vignette=${verdict.vignetteRatio} checks=${JSON.stringify(verdict.checks)}`);
      await art.closeArtifacts().catch(() => {});
    } finally { await sql.end(); }
    return;
  }

  if (mode === "stale") {
    // Invalidate the ACTIVE narration of client projects that are (or should be) needs-evidence, so a stale
    // generic script can never keep presenting itself as recordable/approved content. Archives the prior
    // script into revision history, sets a specific deficiency, and clears any approval. No capture, no send.
    const ids = (arg || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error("provide comma-separated leadIds");
    const { loadTemplatePg, saveTemplatePg } = await import("../src/lib/content-studio/cs-lifecycle-pg");
    const { clearApprovalPg } = await import("../src/lib/content-studio/cs-lifecycle-pg");
    const { invalidateNarration } = await import("../src/lib/content-studio/stale-content");
    const deficiency = industry /* 3rd CLI arg reused as an optional deficiency override */
      || "No directly-observed website finding beyond ratings/reviews — deep multi-page capture surfaced only review-count signal, which cannot be the whole personalization. Capture a supported, demonstrable problem before a script is written.";
    const now = new Date().toISOString();
    for (const leadId of ids) {
      const pieceId = `client-${leadId}`.replace(/[^0-9a-z_-]/gi, "-").slice(0, 40);
      const tpl: any = await loadTemplatePg(pieceId).catch(() => null);
      if (!tpl) { console.log(`stale: ${pieceId} — no template, skipped`); continue; }
      const res = invalidateNarration(tpl, deficiency, now);
      await saveTemplatePg(res.template);
      await clearApprovalPg(pieceId).catch(() => {});
      console.log(`stale: ${pieceId} — changed=${res.changed} archivedLines=${res.archivedLines} evidenceState=${res.template.evidenceState} rev=${res.template.revision} approval cleared`);
    }
    return;
  }

  const ids = (arg || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error("provide comma-separated leadIds");
  const sql = db();
  try {
    const cap: any = await loadCapture();
    const rows = await sql`SELECT id, business_name, website, industry, city, state FROM leads WHERE id IN ${sql(ids)}`;
    const results: Array<{ row: any; site: SiteEvidence; shots: Map<string, { png: Buffer; sha256: string }>; findings: ObservedFinding[] }> = [];
    for (const row of rows) {
      if (!row.website) { console.log(`\n=== ${row.business_name} (${row.id}) — NO WEBSITE → cannot capture`); continue; }
      try {
        const r = await captureLead(cap, row);
        printFindings(r.site, r.findings);
        results.push({ row, ...r });
      } catch (e: any) { console.log(`\n=== ${row.business_name} (${row.id}) — capture error: ${e?.message ?? e}`); }
    }

    // BreakBot across the businesses that produced a top finding (using the topic as the distinctness key).
    const scripts = results.map((r) => {
      const kept = distinctByTopic(r.findings);
      return { id: r.row.id, businessName: r.row.business_name, narration: kept.map((f) => f.observation), findingTopics: kept.map((f) => f.topic) };
    }).filter((s) => s.narration.length);
    if (scripts.length >= 2) {
      const bb = compareClientScripts(scripts);
      console.log(`\n=== BreakBot across ${scripts.length}: ok=${bb.ok} templateEquivalent=${bb.templateEquivalent}`);
      for (const p of bb.pairs) console.log(`    ${p.a} vs ${p.b}: sim=${p.similarity} sameFindings=${p.sameFindings} equiv=${p.templateEquivalent}`);
    }

    // Preview the VALUE-DENSE composed script + quality gate per winner (no DB writes) — for `leads`/`narrate`.
    const composedForBreakbot: any[] = [];
    for (const r of results) {
      const high = distinctByTopic(r.findings).filter((f) => f.impactLevel === "High").slice(0, 1);
      if (!high.length) continue;
      const c = composeClientNarration(high[0], r.row.business_name);
      const q = assessScriptQuality(c);
      console.log(`\n--- ${r.row.business_name} — value-dense script [${c.topic}] ${c.wordCount}w qualityOk=${q.ok}${q.ok ? "" : " reasons=" + q.reasons.join("; ")}`);
      for (const l of c.lines) console.log(`    (${l.role}) ${l.text}`);
      composedForBreakbot.push({ id: r.row.id, businessName: r.row.business_name, narration: c.lines.map((l) => l.text), findingTopics: [c.topic] });
    }
    if (composedForBreakbot.length >= 2) {
      const bb = compareClientScripts(composedForBreakbot);
      console.log(`\n=== BreakBot across ${composedForBreakbot.length} COMPOSED scripts: ok=${bb.ok} templateEquivalent=${bb.templateEquivalent}`);
      for (const p of bb.pairs) console.log(`    ${p.a} vs ${p.b}: sim=${p.similarity} equiv=${p.templateEquivalent}`);
    }
    if (mode === "narrate") return;

    if (mode === "persist") {
      const art: any = await loadArtifacts();
      const { buildQuickReview } = await import("../src/lib/outreach/quick-review");
      const { buildBusinessTemplate } = await import("../src/lib/content-studio/client-video");
      const { assessGenerationEvidence } = await import("../src/lib/content-studio/evidence-gate");
      const { saveTemplatePg, loadTemplatePg } = await import("../src/lib/content-studio/cs-lifecycle-pg");
      const ENV = process.env.NODE_ENV === "production" ? "production" : (process.env.CS_ARTIFACT_ENV || "development");
      const builtScripts: any[] = [];
      for (const r of results) {
        // ONE strong, directly-observed finding per winner (High impact) → a focused, exactly-bound video.
        const high = distinctByTopic(r.findings).filter((f) => f.impactLevel === "High");
        const kept = high.slice(0, 1);
        if (!kept.length) { console.log(`persist: ${r.row.id} — no High directly-observed finding, left Needs-evidence`); continue; }
        const top = kept[0];
        const shot = r.shots.get(top.sourcePageUrl) || [...r.shots.values()][0];
        if (!shot) { console.log(`persist: ${r.row.id} — finding but NO screenshot captured, left Needs-evidence`); continue; }

        // 1) Persist the finding's OWN source-page screenshot as a ready screenshot job (the render worker
        //    materializes + SHA-verifies these bytes when compositing the interior evidence frame).
        const outputKey = art.buildObjectKey({ artifactClass: "poster", env: ENV, jobId: `deepcap_${r.row.id}`, version: shot.sha256.slice(0, 16), ext: "png" });
        await art.putArtifact(outputKey, shot.png, "image/png", { artifactClass: "poster", jobId: `deepcap_${r.row.id}`, metadata: { kind: "screenshot", source: "deep-evidence", finalUrl: top.sourcePageUrl } });
        const jobId = `csshot_deep_${r.row.id}`.replace(/[^0-9a-z_]/gi, "_").slice(0, 40);
        await sql`INSERT INTO content_studio_screenshot_jobs
            (id, business_id, piece_id, requested_url, canonical_url, viewport, status, progress, stage,
             final_url, content_type, byte_size, sha256, output_key, captured_at, provenance, created_at, updated_at, finished_at)
          VALUES (${jobId}, ${r.row.id}, ${`client-${r.row.id}`}, ${top.sourcePageUrl}, ${canonUrl(top.sourcePageUrl)}, 'mobile', 'ready', 1, 'Ready',
             ${top.sourcePageUrl}, 'image/png', ${shot.png.length}, ${shot.sha256}, ${outputKey}, now(),
             ${sql.json({ source: "deep-evidence", finalUrl: top.sourcePageUrl, pages: r.site.pages.length })}, now(), now(), now())
          ON CONFLICT (id) DO UPDATE SET sha256=EXCLUDED.sha256, output_key=EXCLUDED.output_key, final_url=EXCLUDED.final_url,
             byte_size=EXCLUDED.byte_size, captured_at=now(), updated_at=now(), status='ready'`;

        // 2) Merge the Observed opportunity into the BI profile at profile.businessProfile.opportunities
        //    (the exact path buildQuickReview reads). Deterministic id lets re-runs stay stable.
        const opps = toOpportunities(kept, r.row.id);
        const biRow: any = (await sql`SELECT id, profile FROM business_intelligence WHERE lead_id=${r.row.id} ORDER BY generated_at DESC LIMIT 1`)[0];
        if (!biRow || !biRow.profile?.businessProfile) { console.log(`persist: ${r.row.id} — NO BI businessProfile, cannot bind opportunity`); continue; }
        const wrapper = biRow.profile;
        // Prepend the deep-capture Observed opportunity so buildQuickReview/selectReviewFindings picks it
        // FIRST on any re-prepare (durable: the template can't silently regress to needs-evidence). Match on
        // the BI row's primary key (a Date-valued WHERE silently matched nothing).
        const prior = Array.isArray(wrapper.businessProfile.opportunities) ? wrapper.businessProfile.opportunities.filter((o: any) => !String(o?.id ?? "").startsWith(`opp_${r.row.id}_`)) : [];
        wrapper.businessProfile.opportunities = [...opps, ...prior];
        const upd = await sql`UPDATE business_intelligence SET profile=${sql.json(wrapper)}, updated_at=now() WHERE id=${biRow.id} RETURNING id`;
        if (!upd.length) { console.log(`persist: ${r.row.id} — BI UPDATE matched 0 rows (id ${biRow.id})`); }

        // 3) Compose the VALUE-DENSE six-beat narration from the finding and run the section-E quality gate
        //    BEFORE building. A script that can't clear the gate (too generic, no exact detail, prohibited
        //    phrase, wrong length) does NOT get written — the project stays Needs-evidence, honestly.
        const composed = composeClientNarration(top, r.row.business_name);
        const quality = assessScriptQuality(composed);
        if (!quality.ok) { console.log(`persist: ${r.row.id} — script quality gate FAILED (${quality.wordCount}w): ${quality.reasons.join("; ")} — left Needs-evidence`); continue; }

        // 4) Build the evidence-backed template through the REAL product path with the composed narration,
        //    binding the finding's screenshot exactly, then verify the honest generation gate PASSES.
        const lead: any = { id: r.row.id, businessName: r.row.business_name, website: r.row.website, city: r.row.city ?? null, state: r.row.state ?? null, industry: r.row.industry ?? null };
        const review = buildQuickReview(lead, wrapper.businessProfile, null, { approved: false });
        const screenshots: Record<string, string> = {};
        if (review.findings[0]) screenshots[review.findings[0].id] = outputKey;
        const built = buildBusinessTemplate(review, { leadId: r.row.id, screenshots, composedNarration: composed });
        if (!built.template || built.evidenceState !== "evidence-backed") { console.log(`persist: ${r.row.id} — template NOT evidence-backed (${built.evidenceState}: ${built.blockedReason ?? ""})`); continue; }
        const gate = assessGenerationEvidence({ template: built.template, liveShot: { outputKey, sha256: shot.sha256, sourceUrl: top.sourcePageUrl, pageTitle: top.sourcePageTitle } });
        if (!gate.ok) { console.log(`persist: ${r.row.id} — generation gate NOT ok: ${gate.reason} — left unchanged`); continue; }
        const existing = await loadTemplatePg(built.template.id).catch(() => null);
        // Archive the prior (shallow) narration into revision history before overwriting — preserved, never lost.
        const priorHist = Array.isArray((existing as any)?.revisionHistory) ? (existing as any).revisionHistory : [];
        if (existing && Array.isArray((existing as any).narration) && (existing as any).narration.length) {
          priorHist.push({ revision: (existing as any).revision ?? 0, archivedAt: new Date().toISOString(), reason: "Superseded by value-dense rewrite.", evidenceState: (existing as any).evidenceState, narration: (existing as any).narration.slice(0, 12) });
        }
        (built.template as any).revisionHistory = priorHist.slice(-20);
        built.template.revision = ((existing as any)?.revision ?? 0) + 1;
        (built.template as any).ownerEdited = false;
        await saveTemplatePg(built.template);
        builtScripts.push({ id: built.template.id, businessName: built.template.businessName, narration: built.template.narration, findingTopics: [top.topic] });
        console.log(`persist: ${r.row.id} — topic ${top.topic} | ${composed.wordCount}w | evidenceState=${built.evidenceState} | gate.ok=${gate.ok} scenes=${gate.evidenceScenes} | template ${built.template.id} rev ${built.template.revision} saved`);
        console.log(built.template.narration.map((l: string, i: number) => `      ${i}: ${l}`).join("\n"));
      }
      if (builtScripts.length >= 2) {
        const bb = compareClientScripts(builtScripts);
        console.log(`\n=== BreakBot across ${builtScripts.length} BUILT templates: ok=${bb.ok} templateEquivalent=${bb.templateEquivalent}`);
        for (const p of bb.pairs) console.log(`    ${p.a} vs ${p.b}: sim=${p.similarity} equiv=${p.templateEquivalent}`);
      }
      await art.closeArtifacts().catch(() => {});
    }
  } finally {
    await sql.end();
  }
}

function canonUrl(raw: string): string {
  try { const u = new URL(raw); u.hash = ""; u.search = ""; u.hostname = u.hostname.toLowerCase(); const p = u.pathname.replace(/\/+$/, "") || "/"; return `${u.protocol}//${u.host}${p}`; } catch { return raw; }
}

main().catch((e) => { console.error(e); process.exit(1); });

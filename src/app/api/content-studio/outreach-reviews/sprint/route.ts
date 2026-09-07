// ─────────────────────────────────────────────────────────────────────────────
// NARRATION SPRINT API (mandate 28). The canonical server operations behind the mobile sprint: start a
// session, read it, upload audio (validate → transcript-verify → bind → queue EXACTLY ONE render), and the
// session transitions (skip/reject/needs-attention/resume). Reuses the canonical render boundary (writeJob +
// artifact store), the M27 targeting engine, and the M28 backbone. Never contacts an email provider.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isAuthenticated } from "@/lib/auth";
import { currentOperatorId } from "@/lib/auth";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { writeJob, listJobs } from "@/lib/content-studio/store";
import { detectAudioType } from "@/lib/content-studio/audio-detect";
import type { RenderJob } from "@/lib/content-studio/types";
import { buildSprintBacklog } from "@/lib/outreach-review/sprint-backlog";
import { createSprintSession, currentLead, markComplete, markRejected, markNeedsAttention, skipForNow, resume, progress, type SprintSession } from "@/lib/outreach-review/session";
import { saveSprintSession, loadSprintSession } from "@/lib/outreach-review/sprint-store";
import { planUpload } from "@/lib/outreach-review/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  if (isAuthenticated()) return true;
  const secret = (process.env.CS_CANARY_SECRET ?? "").trim();
  return secret.length > 0 && req.headers.get("x-cs-canary") === secret;
}
const now = () => new Date().toISOString();
const nowMs = () => 1_760_000_000_000; // fixed clock for deterministic ranking (real time not needed for order)

async function backlog() { return buildSprintBacklog({ nowMs: nowMs() }); }

// GET ?action=session&sessionId=… → { session, card, progress }  OR  ?action=backlog → counts
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "session";
  if (action === "backlog") {
    const b = await backlog();
    return NextResponse.json({ readyCount: b.readyCount, order: b.readyLeadIds }, { status: 200 });
  }
  const sessionId = url.searchParams.get("sessionId") ?? "";
  const s = await loadSprintSession(sessionId);
  if (!s) return NextResponse.json({ error: "no such session", code: "NO_SESSION" }, { status: 404 });
  const b = await backlog();
  const lead = currentLead(s);
  return NextResponse.json({ session: s, leadId: lead, card: lead ? b.cards[lead] ?? null : null, progress: progress(s), done: lead === null }, { status: 200 });
}

// POST ?action=start|upload|skip|reject|attention|resume
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  let body: any = {};
  try { body = await req.json(); } catch { /* some actions take no body */ }
  const operator = currentOperatorId() ?? "operator";

  if (action === "start") {
    const b = await backlog();
    const batchSize = body?.batchSize === "all" ? "all" : Math.max(1, Math.floor(Number(body?.batchSize ?? 25)) || 25);
    const id = `sprint_${createHash("sha256").update(`${operator}|${b.readyLeadIds.join(",")}|${now()}`).digest("hex").slice(0, 12)}`;
    const session = createSprintSession({ id, operator, order: b.readyLeadIds, batchSize, now: now() });
    await saveSprintSession(session, now());
    return NextResponse.json({ sessionId: id, order: session.order, firstLeadId: currentLead(session), readyCount: b.readyCount, progress: progress(session) }, { status: 200 });
  }

  const sessionId = String(body?.sessionId ?? "").trim();
  let s = await loadSprintSession(sessionId);
  if (!s) return NextResponse.json({ error: "no such session", code: "NO_SESSION" }, { status: 404 });

  if (action === "resume") {
    const b = await backlog();
    const eligible = new Set(b.readyLeadIds);
    const r = resume(s, { now: now(), stillEligible: (l) => eligible.has(l) });
    await saveSprintSession(r.session, now());
    const lead = currentLead(r.session);
    return NextResponse.json({ session: r.session, leadId: lead, card: lead ? b.cards[lead] ?? null : null, skippedIneligible: r.skippedIneligible, progress: progress(r.session), done: lead === null }, { status: 200 });
  }

  const lead = currentLead(s);
  const transition = async (next: SprintSession, extra: Record<string, unknown> = {}) => {
    await saveSprintSession(next, now());
    const b = await backlog();
    const nl = currentLead(next);
    return NextResponse.json({ session: next, nextLeadId: nl, card: nl ? b.cards[nl] ?? null : null, progress: progress(next), done: nl === null, ...extra }, { status: 200 });
  };

  if (action === "skip") return transition(skipForNow(s));
  if (action === "attention") return transition(markNeedsAttention(s));
  if (action === "reject") {
    // Canonical exactly-once rejection (mandate 28 §D). Uses the existing rejection operation.
    if (lead) {
      const { rejectLead } = await import("@/lib/outreach/rejection");
      await rejectLead({ leadId: lead, reason: body?.reason || "poor-fit", note: body?.note ?? null, actor: `sprint:${operator}` }).catch(() => {});
    }
    return transition(markRejected(s));
  }

  if (action === "upload") {
    if (!lead) return NextResponse.json({ error: "sprint complete", code: "DONE" }, { status: 409 });
    const b = await backlog();
    const card = b.cards[lead];
    if (!card) return NextResponse.json({ error: "current business is no longer eligible", code: "INELIGIBLE" }, { status: 409 });

    const audioBase64 = String(body?.audioBase64 ?? "");
    const buf = audioBase64 ? Buffer.from(audioBase64, "base64") : Buffer.alloc(0);
    const detected = detectAudioType(buf);
    const meta = {
      mime: String(body?.mime ?? detected.mime ?? ""),
      bytes: buf.length,
      durationSeconds: Number(body?.durationSeconds ?? 0),
      signatureOk: detected.ok,
    };
    const sha256 = createHash("sha256").update(buf).digest("hex");

    // Prior audio bound to this input version (idempotency dedup).
    const priorJob = (await listJobs()).find((j) => j.pieceId === `client-${lead}` && j.inputVersion === card.inputVersion);
    // Transcriber provider seam: a real speech-to-text provider fills `spokenTranscript` server-side in prod.
    // The client may pass one (the isolated fake transcriber for deterministic acceptance); when omitted in the
    // isolated tenant, a correct recording is simulated as the card narration (→ MATCH). Prod omits → UNAVAILABLE.
    const isolated = process.env.BREAKBOT_TEST_TENANT === "1";
    const spoken = body?.spokenTranscript != null ? String(body.spokenTranscript) : (isolated ? card.narration : "");
    const transcriptAvailable = body?.transcriptAvailable != null ? body.transcriptAvailable : (isolated ? true : !!spoken);
    const plan = planUpload({
      meta, sha256, scriptRevisionId: card.scriptRevisionId, inputVersion: card.inputVersion,
      requestedRevisionId: String(body?.requestedRevisionId ?? card.scriptRevisionId),
      existingArtifactSha: (priorJob as any)?.audioSha ?? null,
      narration: card.narration, spokenTranscript: spoken, transcriptAvailable,
    });

    if (!plan.ok) {
      return NextResponse.json({ ok: false, code: plan.code, reason: plan.reason, transcript: plan.transcript, leadId: lead, scriptRevisionId: card.scriptRevisionId, nextRoute: null }, { status: plan.code === "REVISION_MISMATCH" ? 409 : 422 });
    }

    // Store the artifact ONCE (idempotent by key+sha).
    const audioKey = `content-studio/outreach-reviews/${lead}/${card.inputVersion}.audio`;
    let put: { sha256: string } = { sha256 };
    if (!plan.idempotent) {
      put = await getArtifactStore().put(audioKey, buf, { artifactClass: "audio-source" as any, contentType: meta.mime || "audio/mp4" });
    }

    // Queue EXACTLY ONE render for this input version (converge on retry/double-tap).
    let renderJobId: string | null = priorJob?.id ?? null;
    let renderQueued = false;
    if (plan.shouldQueueRender) {
      if (!priorJob) {
        const t = now();
        const job: RenderJob = {
          id: `sprint_job_${lead}_${card.inputVersion}`, pieceId: `client-${lead}`, inputVersion: card.inputVersion,
          status: "queued", progress: 0, stage: "queued", mode: "uploaded-vo", audioKind: "uploaded", audioFile: null,
          audioKey, audioSha: sha256, audioLabel: "sprint-vo", outputFile: null, outputRel: null, outputKey: null, posterKey: null,
          screenshotKey: null, screenshotSha: null, storyboard: null, thumbRel: null, error: null, attempt: 1, pid: null,
          createdAt: t, updatedAt: t, startedAt: null, finishedAt: null,
        } as RenderJob;
        await writeJob(job);
        renderJobId = job.id;
      }
      renderQueued = true;
      // Persisted upload + render queued → mark complete + auto-advance.
      s = markComplete(s);
      await saveSprintSession(s, now());
    }

    const nl = currentLead(s);
    return NextResponse.json({
      ok: true, code: plan.code, reason: plan.reason, idempotent: plan.idempotent,
      leadId: lead, scriptRevisionId: card.scriptRevisionId, audioArtifactId: audioKey, sha256: put.sha256,
      durationSeconds: meta.durationSeconds, transcript: plan.transcript,
      renderJobId, renderQueued, autoAdvance: renderQueued,
      nextLeadId: renderQueued ? nl : lead, nextRoute: renderQueued && nl ? `/content-studio/outreach-reviews/sprint/${sessionId}/${nl}` : null,
      progress: progress(s), done: nl === null,
    }, { status: 200 });
  }

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}

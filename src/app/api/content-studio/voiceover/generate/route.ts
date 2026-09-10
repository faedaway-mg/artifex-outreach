import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, currentActor } from "@/lib/auth";
import { generateLeadVoiceover } from "@/lib/voice/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → generate (or reuse) the canonical ElevenLabs voiceover for a lead's narration. SERVER-ONLY:
// every ElevenLabs call happens here; the browser never sees the raw provider voiceId or the API key.
// The response is deliberately SAFE — display name only, plus a stable voiceoverId the audio route can
// serve. `force` (explicit operator regeneration) supersedes the prior canonical asset; it is honored
// ONLY when the caller explicitly requests it. This route generates + persists an asset; it never sends.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const leadId = typeof body?.leadId === "string" ? body.leadId.trim() : "";
  const narrationId = typeof body?.narrationId === "string" ? body.narrationId.trim() : "";
  const narrationScript = typeof body?.narrationScript === "string" ? body.narrationScript : "";
  const offerId = typeof body?.offerId === "string" && body.offerId.trim() ? body.offerId.trim() : null;
  // force is honored ONLY when the caller explicitly sends true — no accidental credit-burning regen.
  const force = body?.force === true;

  if (!leadId || !narrationId || !narrationScript.trim()) {
    return NextResponse.json({ error: "leadId, narrationId and narrationScript are required" }, { status: 400 });
  }

  const result = await generateLeadVoiceover({
    leadId,
    offerId,
    narrationId,
    narrationScript,
    actor: currentActor(),
    force,
    // Social Content Studio native generation (§17) — deliberate operator creation, not per-prospect
    // finalist production, so it is not blocked by the paid-compute finalist gate (still ledger-tracked).
    authorization: { scope: "social" },
  });

  // SAFE projection — never leak the raw ElevenLabs voiceId, model, or key.
  switch (result.status) {
    case "reused":
    case "ready":
      return NextResponse.json({
        status: result.status,
        voiceoverId: result.voiceover.id,
        durationSeconds: result.voiceover.durationSeconds,
        voice: result.voiceDisplayName,
      });
    case "legacy":
      return NextResponse.json({ status: "legacy", voice: result.voiceDisplayName, reason: result.reason });
    case "not_configured":
      return NextResponse.json({ status: "not_configured", reason: result.reason });
    case "failed":
      return NextResponse.json({ status: "failed", voiceoverId: result.voiceoverId, reason: result.reason }, { status: 502 });
    default:
      return NextResponse.json({ error: "unexpected result" }, { status: 500 });
  }
}

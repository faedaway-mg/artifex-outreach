import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listVoiceovers, getVoiceConfig } from "@/lib/voice/store";
import { computeVoiceUsage, resolveVoiceUsageConfig } from "@/lib/voice/usage";
import { buildVoiceUsageView } from "@/lib/voice/usage-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → the voice-generation capacity meter, computed READ-ONLY from the persisted voiceover records and
// the EFFECTIVE budget (operator-stored value overriding the env default). Auth-gated. Returns the raw
// usage numbers, the provenance of each configured value, and the pre-formatted operator view model so
// the browser meter and this payload can never drift in wording. Every field is browser-safe — no
// provider ids or keys are ever part of this response.
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { config, source } = resolveVoiceUsageConfig(await getVoiceConfig());
  const usage = computeVoiceUsage(await listVoiceovers(), config, new Date().toISOString());
  const view = buildVoiceUsageView(usage, source);

  return NextResponse.json({ usage, source, view });
}

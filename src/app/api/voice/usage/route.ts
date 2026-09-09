import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, currentActor } from "@/lib/auth";
import { listVoiceovers, getVoiceConfig, setVoiceConfig } from "@/lib/voice/store";
import { computeVoiceUsage } from "@/lib/voice/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → the voice-generation capacity meter, computed READ-ONLY from the persisted voiceover records and
// the configured budget. Auth-gated. Every field here is safe for the browser (no provider ids/keys).
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const usage = computeVoiceUsage(await listVoiceovers(), await getVoiceConfig(), new Date().toISOString());
  return NextResponse.json(usage);
}

// PUT → set the (optional) monthly minute budget and/or billing reset day. Auth-gated operator action.
// A null budget clears any configured quota; the meter then shows minutes generated with NO fabricated
// remaining allowance. billingResetDay must be a day-of-month 1..28 (matches the usage period math).
export async function PUT(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const cfg: { monthlyMinuteBudget?: number | null; billingResetDay?: number | null } = {};

  if ("monthlyMinuteBudget" in body) {
    const v = body.monthlyMinuteBudget;
    if (v === null) cfg.monthlyMinuteBudget = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0) cfg.monthlyMinuteBudget = v;
    else return NextResponse.json({ error: "monthlyMinuteBudget must be a non-negative number or null" }, { status: 400 });
  }

  if ("billingResetDay" in body) {
    const v = body.billingResetDay;
    if (v === null) cfg.billingResetDay = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 28) cfg.billingResetDay = v;
    else return NextResponse.json({ error: "billingResetDay must be an integer 1..28 or null" }, { status: 400 });
  }

  if (Object.keys(cfg).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await setVoiceConfig(cfg, currentActor());
  const usage = computeVoiceUsage(await listVoiceovers(), await getVoiceConfig(), new Date().toISOString());
  return NextResponse.json(usage);
}

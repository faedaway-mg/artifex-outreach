import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, currentActor } from "@/lib/auth";
import { getVoiceConfig, setVoiceConfig, type VoiceConfig } from "@/lib/voice/store";
import { computeVoiceUsage, resolveVoiceUsageConfig } from "@/lib/voice/usage";
import { listVoiceovers } from "@/lib/voice/store";
import { buildVoiceUsageView } from "@/lib/voice/usage-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The operator-facing voice budget config. Lets the operator set the ElevenLabs plan (monthly minute
// allowance, billing reset day, optional hard cap) WITHOUT editing deployment env vars — the stored value
// overrides the env default. Auth-gated. NEVER returns the API key or raw voice id (this route touches
// neither): it deals only with the budget/reset/cap knobs.

/** Assemble the current resolved view: stored config + effective (resolved) config + provenance + usage view. */
async function resolvedPayload() {
  const stored = await getVoiceConfig();
  const { config, source } = resolveVoiceUsageConfig(stored);
  const usage = computeVoiceUsage(await listVoiceovers(), config, new Date().toISOString());
  const view = buildVoiceUsageView(usage, source);
  return { stored, effective: config, source, usage, view };
}

// GET → the current stored VoiceConfig + the resolved EFFECTIVE config + provenance + usage view. No secrets.
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await resolvedPayload());
}

// Validate a single budget/cap value: a positive finite number, or null to clear it.
function parseBudget(v: unknown, field: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return { ok: true, value: v };
  return { ok: false, error: `${field} must be a positive number or null` };
}

function buildUpdate(body: any): { ok: true; cfg: Partial<VoiceConfig> } | { ok: false; error: string } {
  if (body == null || typeof body !== "object") return { ok: false, error: "invalid body" };

  // Reject unknown keys so a typo can never silently do nothing.
  const allowed = new Set(["monthlyMinuteBudget", "billingResetDay", "hardCapMinutes"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return { ok: false, error: `unknown field: ${k}` };
  }

  const cfg: Partial<VoiceConfig> = {};

  if ("monthlyMinuteBudget" in body) {
    const r = parseBudget(body.monthlyMinuteBudget, "monthlyMinuteBudget");
    if (!r.ok) return r;
    cfg.monthlyMinuteBudget = r.value;
  }

  if ("hardCapMinutes" in body) {
    const r = parseBudget(body.hardCapMinutes, "hardCapMinutes");
    if (!r.ok) return r;
    cfg.hardCapMinutes = r.value;
  }

  if ("billingResetDay" in body) {
    const v = body.billingResetDay;
    if (v === null) cfg.billingResetDay = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 28) cfg.billingResetDay = v;
    else return { ok: false, error: "billingResetDay must be an integer 1..28 or null" };
  }

  if (Object.keys(cfg).length === 0) return { ok: false, error: "nothing to update" };
  return { ok: true, cfg };
}

async function handleWrite(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const parsed = buildUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  await setVoiceConfig(parsed.cfg, currentActor());
  return NextResponse.json(await resolvedPayload());
}

// POST / PUT → set the plan knobs (any subset). Returns the new resolved view.
export async function POST(req: NextRequest) {
  return handleWrite(req);
}
export async function PUT(req: NextRequest) {
  return handleWrite(req);
}

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY. Manage the shared evergreen ARTIFEX_QUICK_FIX_EXPLAINER versions.
// Activating/retiring a version NEVER regenerates any offer — offer pages simply
// select the active version at render time. No customer contact, no charge.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; version?: number; assetUrl?: string; durationSeconds?: number | null };
  const now = new Date().toISOString();

  switch (body.action) {
    case "seed": { const v = await store.ensureEvergreenSeed(now); return NextResponse.json({ ok: true, versions: v }); }
    case "add": { const v = await store.addEvergreenDraft(now); return NextResponse.json({ ok: true, created: v }); }
    case "attach": {
      if (typeof body.version !== "number" || !body.assetUrl) return NextResponse.json({ ok: false, error: "version + assetUrl required" }, { status: 400 });
      const v = await store.attachEvergreenAsset(body.version, body.assetUrl, body.durationSeconds ?? null, now);
      return v ? NextResponse.json({ ok: true, version: v }) : NextResponse.json({ ok: false, error: "version not found" }, { status: 404 });
    }
    case "activate": {
      if (typeof body.version !== "number") return NextResponse.json({ ok: false, error: "version required" }, { status: 400 });
      const v = await store.activateEvergreen(body.version, now);
      return v ? NextResponse.json({ ok: true, version: v }) : NextResponse.json({ ok: false, error: "version not found" }, { status: 404 });
    }
    case "retire": {
      if (typeof body.version !== "number") return NextResponse.json({ ok: false, error: "version required" }, { status: 400 });
      const v = await store.retireEvergreen(body.version, now);
      return v ? NextResponse.json({ ok: true, version: v }) : NextResponse.json({ ok: false, error: "version not found" }, { status: 404 });
    }
    default:
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}

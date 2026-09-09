import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { breakbotBatchView } from "@/lib/quick-fix/operator-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY (authenticated), READ-ONLY QA GATE. Runs Breakbot over the top-N
// high-confidence READY_TO_SELL stored offers (mode=ready|top10) OR over the pure/
// offline demo fixtures + regression suite (mode=fixtures|regression). Never approves,
// sends, charges, schedules, or mutates. Fail-closed (Part Y).
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const mode = req.nextUrl.searchParams.get("mode") ?? "ready";

  // ── Pure/offline modes (no store, no DB) ─────────────────────────────────────
  if (mode === "fixtures") {
    const { runBreakbotPreflight } = await import("@/lib/breakbot/quickcash-preflight");
    const { goldenFixtures, failureFixtures } = await import("@/lib/breakbot/quickcash-fixtures");
    const golden = goldenFixtures().map((g) => {
      const v = runBreakbotPreflight(g.input);
      return { id: g.id, label: g.label, expected: "READY", overall: v.overall, blockers: v.counts.blockers, pass: v.overall === "READY" };
    });
    const failure = failureFixtures().map((f) => {
      const v = runBreakbotPreflight(f.input);
      const surfaces = v.issues.filter((i) => i.severity === "BLOCKER").map((i) => i.surface);
      return {
        id: f.id, label: f.label, expectBlockerSurface: f.expectBlockerSurface,
        overall: v.overall, blockers: v.counts.blockers,
        pass: v.overall === "BLOCKED" && surfaces.includes(f.expectBlockerSurface),
      };
    });
    const allPass = golden.every((g) => g.pass) && failure.every((f) => f.pass);
    return NextResponse.json({ ok: true, mode, fixtures: { golden, failure, allPass } });
  }

  if (mode === "regression") {
    const { runRegression } = await import("@/lib/breakbot/regression");
    const result = runRegression();
    return NextResponse.json({ ok: true, mode, regression: result });
  }

  // ── Real read-only production batch (READY_TO_SELL, high-confidence) ─────────
  const limit = mode === "top10" ? 10 : Number(req.nextUrl.searchParams.get("limit") ?? 10) || 10;
  const view = await breakbotBatchView(limit);
  return NextResponse.json({ ok: true, mode, batch: view });
}

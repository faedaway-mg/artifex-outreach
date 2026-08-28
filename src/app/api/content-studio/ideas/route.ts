import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { suggestIdeas } from "@/lib/content-studio/ideas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?n=&seed= → starter social-video ideas. DETERMINISTIC bank (not provider-generated) — the response
// says so, so nothing here is mistaken for AI-verified output.
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const n = Math.max(1, Math.min(6, Number(req.nextUrl.searchParams.get("n") ?? 3)));
  const seed = Number(req.nextUrl.searchParams.get("seed") ?? 0) || 0;
  return NextResponse.json({
    ideas: suggestIdeas(n, seed),
    source: "deterministic-bank",
    note: "Starter ideas from the Field Notes theme — edit freely. Not AI/provider-generated; wire an authorized LLM provider to replace this (see the deployment request).",
  });
}

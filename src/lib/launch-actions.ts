"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Launch readiness — server actions. The only mutation here is the human sign-off
// on the final manual-review checkpoint ("would I confidently send this to a real
// business owner today?"). Recording it is deliberately explicit and audited so
// launch is never a silent default.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSettings, updateSettings, appendAudit } from "./repo";
import { nowIso } from "./store";
import { currentActor } from "@/lib/auth";

export async function setLaunchReviewConfirmed(confirmed: boolean): Promise<void> {
  const settings = await getSettings();
  const at = confirmed ? nowIso() : null;
  await updateSettings({ ...settings, launchReviewConfirmedAt: at, launchReviewConfirmedBy: confirmed ? "jordan" : null });

  let ip: string | null = null;
  try {
    ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {}
  await appendAudit({
    action: confirmed ? "launch.review.confirmed" : "launch.review.revoked",
    actor: currentActor(),
    targetType: "launch",
    targetId: "manual-review",
    meta: null,
    ip,
  });

  revalidatePath("/launch/readiness");
  revalidatePath("/launch/confidence");
  revalidatePath("/launch");
}

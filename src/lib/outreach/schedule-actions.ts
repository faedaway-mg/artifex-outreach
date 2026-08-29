"use server";
// Operator-facing scheduling actions. Scheduling is DISTINCT from review approval and from "Send now":
// it persists a version-bound, per-message authorization for a one-time staggered batch. Only
// already-eligible (SENDABLE) packages are scheduled; ineligible ones are reported as removed. No
// message is delivered — there is no business-approved delivering transport (see the runner) — so a
// prepared batch is labelled "Delivery blocked — transport required" until that decision is made.
import { revalidatePath } from "next/cache";
import { currentActor } from "../auth";
import { newId } from "../store";
import { scheduleBatch, cancelScheduled, type ScheduleResult } from "./scheduled-batch";

const MONDAY_TARGET = "2026-08-31"; // the requested one-time date (a "use server" file exports only async fns)

export async function scheduleMondayBatchAction(leadIds: string[]): Promise<ScheduleResult & { deliveryBlocked: true; note: string }> {
  const res = await scheduleBatch(leadIds, { dateKey: MONDAY_TARGET, by: currentActor(), batchId: newId("batch") });
  revalidatePath("/schedule"); revalidatePath("/work/email");
  // Honest: the batch is persisted + validated, but nothing will send — no approved transport exists.
  return { ...res, deliveryBlocked: true, note: "Delivery blocked — a business-approved delivering transport is required before this batch can send." };
}

export async function cancelScheduledAction(leadId: string): Promise<{ ok: boolean }> {
  const ok = await cancelScheduled(leadId);
  revalidatePath("/schedule"); revalidatePath("/work/email");
  return { ok };
}

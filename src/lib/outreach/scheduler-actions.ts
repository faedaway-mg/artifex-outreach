"use server";
// Owner pause/resume controls for the scheduled-outreach runner. The DB-backed pause is observed by
// the runner on its NEXT tick with no redeploy. Both actions revalidate the schedule surface.
import { revalidatePath } from "next/cache";
import { currentActor } from "../auth";
import { setOutreachPaused } from "./outreach-pause";

export async function pauseSchedulerAction(): Promise<{ paused: true }> {
  await setOutreachPaused(true, { actor: currentActor(), reason: "owner paused from Scheduler" });
  revalidatePath("/schedule");
  return { paused: true };
}

export async function resumeSchedulerAction(): Promise<{ paused: false }> {
  await setOutreachPaused(false, { actor: currentActor(), reason: "owner resumed from Scheduler" });
  revalidatePath("/schedule");
  return { paused: false };
}

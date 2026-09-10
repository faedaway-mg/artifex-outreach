"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { MoreHorizontal, Clock, X, Ban, Check } from "lucide-react";
import {
  completeTaskAction,
  snoozeTaskAction,
  skipTaskAction,
  markUnqualifiedAction,
  replaceSkippedLeadAction,
} from "@/lib/actions";
import { RefreshCw } from "lucide-react";
import type { Task } from "@/lib/types";

// Deep-links each task type to the right place on the lead page.
function primaryHref(task: Task, leadId: string): string {
  switch (task.type) {
    case "prepare_video":
      // Canonical client-video project (section C): open the ONE persisted Content Studio project
      // keyed by lead id — not the retired /leads/#video panel. `from=today` renders Back-to-Today.
      // §13-18 social-only: no `section=client` — the normal studio no longer has a prospect panel.
      return `/content-studio?from=today&lead=${leadId}`;
    case "review_and_send":
      return `/leads/${leadId}#outreach`;
    case "follow_up":
      return `/leads/${leadId}#outreach`;
    case "prepare_meeting":
      return `/leads/${leadId}#meeting`;
    case "prepare_proposal":
      return `/leads/${leadId}#proposal`;
    default:
      return `/leads/${leadId}`;
  }
}

export function TaskActions({ task, leadId, primaryLabel }: { task: Task; leadId: string; primaryLabel: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => {
    setOpen(false);
    start(() => void fn());
  };

  return (
    <div className="flex items-center gap-2">
      <Link href={primaryHref(task, leadId)} className="btn-primary whitespace-nowrap">
        {primaryLabel}
      </Link>
      <div className="relative">
        <button
          aria-label="More actions"
          onClick={() => setOpen((o) => !o)}
          className="btn-ghost h-9 w-9 !px-0"
          disabled={pending}
        >
          <MoreHorizontal size={18} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-ink-800 p-1 shadow-lift">
              <MenuItem icon={Check} onClick={() => run(() => completeTaskAction(task.id))}>
                Mark complete
              </MenuItem>
              <MenuItem icon={Clock} onClick={() => run(() => snoozeTaskAction(task.id, 1))}>
                Snooze 1 day
              </MenuItem>
              <MenuItem icon={Clock} onClick={() => run(() => snoozeTaskAction(task.id, 3))}>
                Snooze 3 days
              </MenuItem>
              <MenuItem icon={X} onClick={() => run(() => skipTaskAction(task.id))}>
                Skip
              </MenuItem>
              {task.type === "review" && (
                <MenuItem icon={RefreshCw} onClick={() => run(() => replaceSkippedLeadAction(task.id))}>
                  Skip & replace with new lead
                </MenuItem>
              )}
              <MenuItem icon={Ban} danger onClick={() => run(() => markUnqualifiedAction(leadId, task.id))}>
                Mark unqualified
              </MenuItem>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: any; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06] ${danger ? "text-red-300" : "text-chalk-200"}`}
    >
      <Icon size={15} /> {children}
    </button>
  );
}

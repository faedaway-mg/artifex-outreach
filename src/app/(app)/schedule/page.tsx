import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { schedulableEmails } from "@/lib/outreach/schedulable-list";
import { ScheduleBatchPanel } from "@/components/ScheduleBatchPanel";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const view = await schedulableEmails();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center gap-2 text-[13px] text-chalk-400"><Link href="/work/email" className="hover:underline"><ArrowLeft size={14} className="inline" /> Emails to send</Link></div>
      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-chalk-50"><CalendarClock size={20} className="text-gold-300" /> Schedule for Monday</h1>
      <p className="mt-1 text-[13px] text-chalk-400">Prepare and authorize a one-time staggered batch. Scheduling is separate from “Send now,” and separate from review approval.</p>
      <div className="mt-5">
        <ScheduleBatchPanel eligible={view.eligible} scheduled={view.scheduled} notReady={view.notReady} window={view.window} dateKey={view.dateKey} />
      </div>
    </div>
  );
}

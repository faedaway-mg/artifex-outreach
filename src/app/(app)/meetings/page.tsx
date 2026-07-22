import Link from "next/link";
import { allMeetings, listLeads } from "@/lib/repo";
import { EmptyState } from "@/components/ui";
import { shortDate, timeOfDay, joinMeta, formatLocation, deslug } from "@/lib/utils";
import { CalendarClock } from "lucide-react";
import type { Meeting, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const [meetings, leads] = await Promise.all([allMeetings(), listLeads()]);
  const leadMap = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  const now = Date.now();
  const upcoming = meetings.filter((m) => new Date(m.scheduledAt).getTime() >= now - 3600_000);
  const past = meetings.filter((m) => new Date(m.scheduledAt).getTime() < now - 3600_000);

  return (
    <div className="space-y-6">
      <div>
        <p className="label">Meetings</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Discovery conversations</h1>
      </div>
      {meetings.length === 0 ? (
        <EmptyState title="No meetings yet." hint="Book one from a lead's detail page." />
      ) : (
        <>
          <Group title="Upcoming" items={upcoming} leadMap={leadMap} />
          <Group title="Past" items={past} leadMap={leadMap} />
        </>
      )}
    </div>
  );
}

function Group({ title, items, leadMap }: { title: string; items: Meeting[]; leadMap: Map<string, Lead> }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-chalk-400">{title}</h2>
      <div className="space-y-2">
        {items.map((m) => {
          const lead = leadMap.get(m.leadId);
          return (
            <Link key={m.id} href={`/meetings/${m.id}`} className="card card-hover flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-chalk-100">{lead?.businessName ?? "Unknown"}</p>
                <p className="text-xs text-chalk-500">{joinMeta(deslug(lead?.industry), formatLocation(lead?.city, lead?.state))}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs capitalize text-chalk-500">{m.outcome.replace("_", " ")}</span>
                <span className="flex items-center gap-1.5 text-sm text-amber-300"><CalendarClock size={14} /> {shortDate(m.scheduledAt)} · {timeOfDay(m.scheduledAt)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

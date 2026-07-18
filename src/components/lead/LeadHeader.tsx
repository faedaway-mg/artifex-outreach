// Compact, shared header for the lead sub-pages (Discovery / Relationship /
// Conversation). Understanding-first: business name + where it sits in the journey,
// not a deal size. Includes the lead sub-nav.
import Link from "next/link";
import { ArrowLeft, Globe, MapPin, Star } from "lucide-react";
import type { Lead } from "@/lib/types";
import { TierBadge } from "@/components/ui";
import { JourneyBadge } from "@/components/JourneyBadge";
import { LeadSubNav } from "@/components/lead/LeadSubNav";
import { journeyPhaseOf } from "@/lib/journey";

export function LeadHeader({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-4">
      <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100">
        <ArrowLeft size={15} /> {lead.businessName}
      </Link>
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-chalk-50">{lead.businessName}</h1>
          <TierBadge tier={lead.tier} />
          <JourneyBadge phase={journeyPhaseOf(lead)} showMotion />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-chalk-500">
          <span>{lead.industry} · {lead.city}, {lead.state}</span>
          {lead.websiteDomain && (
            <a href={lead.website ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-azure-300"><Globe size={12} /> {lead.websiteDomain}</a>
          )}
          {lead.rating != null && <span className="inline-flex items-center gap-1"><Star size={12} className="text-amber-400" /> {lead.rating} ({lead.reviewCount})</span>}
          <span className="inline-flex items-center gap-1"><MapPin size={12} /> {lead.address}</span>
        </div>
      </div>
      <LeadSubNav id={lead.id} />
    </div>
  );
}

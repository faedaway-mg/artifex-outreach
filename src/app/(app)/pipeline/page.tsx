import { listLeads, allBusinessIntelligence } from "@/lib/repo";
import { PipelineBoard } from "@/components/PipelineBoard";
import { opportunityMetrics } from "@/lib/journey";
import { Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [leads, bi] = await Promise.all([listLeads(), allBusinessIntelligence()]);
  const om = opportunityMetrics(leads, bi);
  const maxMat = Math.max(1, ...om.maturityDistribution.map(([, n]) => n));

  return (
    <div className="space-y-6">
      <div>
        <p className="label">The journey</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Every business, by how well we understand it</h1>
        <p className="mt-1 text-sm text-chalk-400">From identified to a mature partnership. Drag a business to reflect where the relationship stands.</p>
      </div>

      {/* Opportunity metrics — understanding & relationship, not pipeline value */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Opportunity score" value={om.businessOpportunityScore == null ? "—" : `${om.businessOpportunityScore}`} tone="teal" hint="avg / 100" />
        <Stat label="Relationship potential" value={om.relationshipPotential == null ? "—" : `${om.relationshipPotential}%`} tone="indigo" />
        <Stat label="Evidence confidence" value={om.avgOpportunityConfidence == null ? "—" : `${om.avgOpportunityConfidence}%`} />
        <Stat label="Ready for conversation" value={om.readyForConversation} tone="azure" />
        <Stat label="Ready for partnership" value={om.readyForPartnership} tone="emerald" />
        <Stat label="Discovery completion" value={`${om.avgDiscoveryCompletion}%`} hint="of businesses in dialogue" />
      </div>

      {/* Distributions */}
      {(om.maturityDistribution.length > 0 || om.frictionDistribution.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-chalk-100">Technology maturity distribution</h3>
            {om.maturityDistribution.length === 0 ? (
              <p className="text-xs text-chalk-600">No analyzed businesses yet.</p>
            ) : (
              <div className="space-y-2.5">
                {om.maturityDistribution.map(([level, n]) => (
                  <div key={level}>
                    <div className="flex justify-between text-xs"><span className="text-chalk-400">{level}</span><span className="font-mono text-chalk-300">{n}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-indigo-500" style={{ width: `${(n / maxMat) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-chalk-100">Confirmed friction distribution</h3>
            {om.frictionDistribution.length === 0 ? (
              <p className="text-xs text-chalk-600">No analyzed businesses yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {om.frictionDistribution.slice(0, 12).map(([domain, n]) => (
                  <span key={domain} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-chalk-400">{domain} <span className="font-mono text-chalk-500">{n}</span></span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <PipelineBoard leads={leads} />
    </div>
  );
}

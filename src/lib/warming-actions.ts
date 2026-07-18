"use server";
// Morning Intelligence Warming — server action. Generates a full Business
// Intelligence profile for one business (Snapshot, Maturity, Opportunity Graph,
// Discovery Questions, Evolution preview, Operator Briefing all come from the one
// analyzeBusiness pass). Deliberately does NOT call revalidatePath: the caller warms
// the queue sequentially from the client and refreshes once at the end, so the page
// never remounts mid-run.
import { getLead } from "./repo";
import { generateAndStoreBI } from "./intelligence-actions";

export async function warmBusinessIntelligenceAction(
  leadId: string,
): Promise<{ ok: boolean; evidenceConfidence: number | null; providers: number; error?: string }> {
  try {
    const lead = await getLead(leadId);
    if (!lead) return { ok: false, evidenceConfidence: null, providers: 0, error: "Business not found" };
    const bi = await generateAndStoreBI(lead);
    return { ok: true, evidenceConfidence: bi.evidenceConfidence, providers: bi.profile.providerCoverage.contributing.length };
  } catch (e) {
    return { ok: false, evidenceConfidence: null, providers: 0, error: (e as Error).message };
  }
}

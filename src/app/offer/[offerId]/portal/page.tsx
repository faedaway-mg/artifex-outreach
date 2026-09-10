import { notFound } from "next/navigation";
import { CustomerPortalView } from "@/components/quick-fix/CustomerPortalView";
import { buildCustomerPortalView } from "@/lib/quick-fix/customer-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC customer portal (Customer Portal mandate CP6). Reached with NO session — the unguessable share
// token (or hash-derived offerId) in the URL is the capability, identical to the offer page. Renders ONLY
// the customer-safe projection (buildCustomerPortalView); a bad/modified token resolves to nothing →
// 404, never another customer's project. Read-only: no send, no charge, no writes.
export default async function CustomerPortalPage({ params }: { params: { offerId: string } }) {
  const view = await buildCustomerPortalView(params.offerId);
  if (!view) notFound();
  return <CustomerPortalView view={view} />;
}

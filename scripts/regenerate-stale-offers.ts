// ─────────────────────────────────────────────────────────────────────────────
// REGENERATE STALE OFFER SCOPE COPY (Mandate Parts N/O/AB)
//
// A prior production Breakbot batch found ~9 stored offers BLOCKED solely on
// customerLanguage: their `offer.scope` copy was FROZEN before the plain-language
// capability copy shipped. This script finds every stored offer that still needs
// its scope copy regenerated (jargon in the copy OR a stale persuasion-policy stamp)
// and, with --apply, rebuilds each one's scope from the CURRENT capabilities via the
// pure regeneratePlainScope() + store.replaceOfferScope() (which preserves prior
// scope in scopeHistory, re-opens review, clears the frozen subject, and re-stamps
// the policy). It NEVER changes price / SKU / capabilityKeys / findings / evidence,
// and NEVER sends or charges anything.
//
// DRY-RUN by default: with no flags it only REPORTS. Pass --apply to write.
//
// RUN AGAINST PRODUCTION (read-only report):
//   railway run pnpm tsx scripts/regenerate-stale-offers.ts
// RUN AGAINST PRODUCTION (apply the regeneration):
//   railway run pnpm tsx scripts/regenerate-stale-offers.ts --apply
//
// `railway run` injects the service env (DATABASE_URL etc.) WITHOUT printing any
// secret. The script itself only ever talks to the store abstraction — no direct
// SQL, no Stripe/Resend/Twilio, no outbound.
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";
import * as store from "../src/lib/quick-fix/store";
import { assessOfferCustomerLanguage } from "../src/lib/quick-fix/customer-language";
import { PERSUASION_POLICY_VERSION } from "../src/lib/quick-fix/offer-readiness";
import {
  regeneratePlainScope,
  offerNeedsScopeRegeneration,
} from "../src/lib/quick-fix/scope-regeneration";

const APPLY = process.argv.includes("--apply");
const ACTOR = "regenerate-stale-offers";

async function main() {
  const offers = await store.listOffers();
  const stale = offers.filter((o) => offerNeedsScopeRegeneration(o).needs);

  console.log(`\n=== REGENERATE STALE OFFER SCOPE COPY (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`current persuasion-policy: ${PERSUASION_POLICY_VERSION}`);
  console.log(`offers total: ${offers.length} · needing regeneration: ${stale.length}\n`);

  if (stale.length === 0) {
    console.log("Nothing to regenerate — every stored offer's scope copy is current. ✅");
    return;
  }

  let applied = 0;
  let stillProblematic = 0;

  for (const offer of stale) {
    const need = offerNeedsScopeRegeneration(offer);
    const before = assessOfferCustomerLanguage(offer);
    const oldPolicy = offer.persuasionPolicyVersion ?? "(unstamped)";

    console.log(`— ${offer.companyName} (${offer.offerId})`);
    console.log(`  band=${offer.band} priceCents=${offer.priceCents} capabilities=[${(offer.capabilityKeys ?? []).join(", ")}]`);
    console.log(`  policy: ${oldPolicy} -> ${PERSUASION_POLICY_VERSION}`);
    console.log(`  reasons: ${need.reasons.join(" | ")}`);
    if (before.problems.length) {
      console.log(`  customer-language problems (${before.problems.length}):`);
      for (const p of before.problems) console.log(`    · ${p}`);
    }

    // Compute the regenerated (plain) scope. Semantics preserved by construction.
    const nextScope = regeneratePlainScope(offer);
    const previewAfter = assessOfferCustomerLanguage({ ...offer, scope: nextScope });
    console.log(`  regenerated scope → customer-language problems: ${previewAfter.problems.length}`);
    console.log(`  offerName: "${offer.scope.offerName}" -> "${nextScope.offerName}"`);

    if (!APPLY) {
      console.log(`  (dry-run — no write)\n`);
      continue;
    }

    const updated = await store.replaceOfferScope(offer.offerId, nextScope, {
      actor: ACTOR,
      now: new Date().toISOString(),
      reason: "customer-language regeneration (Mandate N/O/AB): re-source frozen scope copy from current plain-language capabilities",
    });

    if (!updated) {
      console.log(`  ⚠️  replaceOfferScope returned null (offer vanished?) — SKIPPED\n`);
      continue;
    }
    applied += 1;

    // Re-assess the ACTUAL persisted offer to prove the fix landed.
    const persisted = await store.getOffer(offer.offerId);
    const after = persisted ? assessOfferCustomerLanguage(persisted) : previewAfter;
    if (after.problems.length > 0) {
      stillProblematic += 1;
      console.log(`  ❌ AFTER apply — STILL has ${after.problems.length} customer-language problem(s):`);
      for (const p of after.problems) console.log(`    · ${p}`);
    } else {
      console.log(`  ✅ AFTER apply — 0 customer-language problems; policy=${persisted?.persuasionPolicyVersion}`);
    }
    console.log("");
  }

  console.log("=== SUMMARY ===");
  console.log(`needed regeneration: ${stale.length}`);
  if (APPLY) {
    console.log(`applied: ${applied}`);
    console.log(`still problematic after apply: ${stillProblematic}`);
    if (stillProblematic === 0) console.log("All applied offers now pass the customer-language gate. ✅");
  } else {
    console.log("DRY-RUN only — no offers were modified. Re-run with --apply to write.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack || e);
    process.exit(1);
  });

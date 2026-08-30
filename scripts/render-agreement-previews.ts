// Render regular + long-name/high-value agreement previews through the REAL generator,
// with internally-consistent commercial terms (asserted before render). Writes PDFs
// for visual inspection. No network, no DB.
import "./loadEnv";
import fs from "fs";
import { renderAgreementPdf } from "../src/lib/pdf/render-agreement";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";
import { assertAgreementConsistent } from "../src/lib/agreement/consistency";

const OUT = process.env.HOME + "/acq-os-audit/agreement-previews";

function withTerms(a: ReturnType<typeof makeAgreement>, totalCents: number, pct: number) {
  const deposit = Math.round((totalCents * pct) / 100);
  a.contentSnapshot = {
    ...a.contentSnapshot,
    totalPriceCents: totalCents, depositPercent: pct, depositAmountCents: deposit,
    remainingBalanceCents: totalCents - deposit, generatedAt: new Date().toISOString(),
  };
  return a;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Regular sample — 50% deposit, consistent.
  const a = makeAgreement({ status: "sent", agreementNumber: "AL-A-2026-014" });
  a.agreementNumber = "AL-A-2026-014"; a.contentSnapshot.agreementNumber = "AL-A-2026-014";
  withTerms(a, 1_450_000, 50);
  assertAgreementConsistent(a);
  fs.writeFileSync(`${OUT}/agreement-draft.pdf`, await renderAgreementPdf(a, true));

  // Long-name / high-value — 30% deposit + monthly retainer, consistent.
  const b = makeAgreement({ status: "sent", agreementNumber: "AL-A-2026-015" });
  b.agreementNumber = "AL-A-2026-015"; b.contentSnapshot.agreementNumber = "AL-A-2026-015";
  b.contentSnapshot = {
    ...b.contentSnapshot,
    clientBusinessName: "Northwestern Metropolitan Hospitality Group International Holdings LLC",
    clientLegalName: "Northwestern Metropolitan Hospitality Group International Holdings LLC",
    clientContactName: "Alexandria Constantinople-Worthington III",
    monthlyPartnershipCents: 350_000,
    scope: Array.from({ length: 8 }, (_, i) => `Phase ${i + 1}: ${"detailed modernization workstream ".repeat(3)}`),
  };
  withTerms(b, 100_150_000, 30);
  assertAgreementConsistent(b);
  fs.writeFileSync(`${OUT}/agreement-longname.pdf`, await renderAgreementPdf(b, true));

  console.log("rendered both previews (both assert-consistent):");
  console.log(`  regular:  ${a.contentSnapshot.agreementNumber}  total ${a.contentSnapshot.totalPriceCents}  deposit ${a.contentSnapshot.depositPercent}% = ${a.contentSnapshot.depositAmountCents}`);
  console.log(`  longname: ${b.contentSnapshot.agreementNumber}  total ${b.contentSnapshot.totalPriceCents}  deposit ${b.contentSnapshot.depositPercent}% = ${b.contentSnapshot.depositAmountCents}`);
}
main().catch((e) => { console.error("PREVIEW RENDER ERROR:", e.message); process.exit(1); });

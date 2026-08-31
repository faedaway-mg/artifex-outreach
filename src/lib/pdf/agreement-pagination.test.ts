import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { renderAgreementPdf } from "./render-agreement";
import { makeAgreement } from "../agreement/test-fixtures";
import { assertAgreementConsistent } from "../agreement/consistency";

/** True when the poppler `pdftotext` binary is on PATH (skip the check otherwise). */
function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Extract selectable text for a single 1-based page via poppler. */
function pageText(pdf: Buffer, page: number): string {
  const tmp = path.join(os.tmpdir(), `agr-pg-${process.pid}-${page}.pdf`);
  fs.writeFileSync(tmp, pdf);
  try {
    return execFileSync("pdftotext", ["-f", String(page), "-l", String(page), "-layout", tmp, "-"], {
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function pageCount(pdf: Buffer): number {
  const tmp = path.join(os.tmpdir(), `agr-info-${process.pid}.pdf`);
  fs.writeFileSync(tmp, pdf);
  try {
    const out = execFileSync("pdfinfo", [tmp], { encoding: "utf8" });
    return Number(/^Pages:\s*(\d+)/m.exec(out)?.[1] ?? "0");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Build the exact conditions that produced the orphaned-cover defect: a very long
 * client name (title wraps to multiple lines), the optional monthly-partnership row,
 * and a multi-phase scope — everything that inflates the cover.
 */
function longNameAgreement() {
  const a = makeAgreement({ status: "sent", agreementNumber: "AL-A-2026-015" });
  a.agreementNumber = "AL-A-2026-015";
  a.contentSnapshot = {
    ...a.contentSnapshot,
    agreementNumber: "AL-A-2026-015",
    clientBusinessName: "Northwestern Metropolitan Hospitality Group International Holdings LLC",
    clientLegalName: "Northwestern Metropolitan Hospitality Group International Holdings LLC",
    clientContactName: "Alexandria Constantinople-Worthington III",
    monthlyPartnershipCents: 350_000,
    totalPriceCents: 100_150_000,
    depositPercent: 30,
    depositAmountCents: 30_045_000,
    remainingBalanceCents: 70_105_000,
    scope: Array.from({ length: 8 }, (_, i) => `Phase ${i + 1}: ${"detailed modernization workstream ".repeat(3)}`),
  };
  assertAgreementConsistent(a);
  return a;
}

// Distinctive fragments — one per step. `-layout` wraps text inside the narrow step
// columns, so we match short fragments against whitespace-normalized page text rather
// than the full sentence.
// The TAIL of each step description — the exact fragments that spilled onto page 2 in
// the original orphan defect. `-layout` interleaves the three step columns per visual
// row, so each fragment is chosen to fit on a single column line (stays contiguous
// after whitespace-normalization).
const STEP_DESCRIPTIONS = [
  "numbered sections that follow", // step 1 (Review)
  "on the signature page", // step 2 (Sign)
  "on signature to start work", // step 3 (Begin)
];

/** Collapse all runs of whitespace so column-wrapped fragments match contiguously. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ");
}

describe("agreement cover pagination — 'What happens next' must not orphan", () => {
  const run = hasPdftotext() ? it : it.skip;

  run(
    "keeps the heading + all three step descriptions together on ONE page (long name + monthly row)",
    async () => {
      const pdf = await renderAgreementPdf(longNameAgreement(), true);
      const pages = pageCount(pdf);
      expect(pages).toBeGreaterThan(0);

      // Locate the page each fragment lands on (whitespace-normalized).
      const texts = Array.from({ length: pages }, (_, i) => flat(pageText(pdf, i + 1)));
      const headingPage = texts.findIndex((t) => /what happens next/i.test(t));
      expect(headingPage, "heading must render").toBeGreaterThanOrEqual(0);

      for (const desc of STEP_DESCRIPTIONS) {
        const onPage = texts.findIndex((t) => t.includes(desc));
        expect(onPage, `step description must render: "${desc}"`).toBeGreaterThanOrEqual(0);
        // The exact regression: every step description must sit on the SAME page as the heading.
        expect(onPage, `"${desc}" must not orphan away from the heading`).toBe(headingPage);
      }

      // And the section must live on the cover (page 1), not be pushed onto its own page.
      expect(headingPage).toBe(0);
    },
    20_000,
  );

  run(
    "produces no near-empty orphan page between the cover and the terms",
    async () => {
      const pdf = await renderAgreementPdf(longNameAgreement(), true);
      const pages = pageCount(pdf);
      // Every page must carry real content — an orphaned cover fragment leaves a page
      // with almost nothing on it. Require a modest minimum of alphanumeric lines.
      for (let p = 1; p <= pages; p++) {
        const lines = pageText(pdf, p)
          .split("\n")
          .filter((l) => /[A-Za-z0-9]/.test(l))
          .filter((l) => !/^\s*(Page \d+ of \d+|DRAFT — pending)/.test(l));
        expect(lines.length, `page ${p} must not be a near-empty orphan`).toBeGreaterThan(6);
      }
    },
    20_000,
  );
});

/* eslint-disable jsx-a11y/alt-text */
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Agreement } from "@/lib/types";
import { ARTIFEX_IDENTITY } from "@/lib/identity";
import { buildAgreementSections } from "@/lib/agreement/template";

const INK = "#0D0F13";
const MUTE = "#5B6270";
const LINE = "#E4E7EC";
const ACCENT = "#3E75E6";
const AMBER = "#E89B3B";
const DRAFT = "#B4531A";
const BG = "#FFFFFF";

const s = StyleSheet.create({
  page: { backgroundColor: BG, paddingTop: 56, paddingBottom: 56, paddingHorizontal: 56, fontSize: 9.5, color: INK, fontFamily: "Helvetica", lineHeight: 1.5 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  brand: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 1 },
  brandTag: { fontSize: 7.5, color: MUTE },
  footer: { position: "absolute", bottom: 26, left: 56, right: 56, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTE, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 },
  draftBanner: { backgroundColor: "#FBEEE2", borderWidth: 1, borderColor: "#F0CBA6", borderRadius: 5, padding: 7, marginBottom: 14 },
  draftText: { color: DRAFT, fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 0.4 },
  eyebrow: { fontSize: 8, letterSpacing: 1.6, color: ACCENT, fontFamily: "Helvetica-Bold", textTransform: "uppercase", marginBottom: 6 },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 8 },
  meta: { fontSize: 9, color: MUTE, marginBottom: 3 },
  sectionHeading: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, marginTop: 12, marginBottom: 5 },
  para: { fontSize: 9.5, color: "#22262E", marginBottom: 6 },
  bullet: { fontSize: 9.5, color: "#22262E", marginBottom: 3, marginLeft: 10 },
  termsCard: { borderWidth: 1, borderColor: LINE, borderRadius: 7, padding: 12, marginBottom: 8 },
  termRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  termLabel: { fontSize: 9, color: MUTE },
  termValue: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: INK },
});

function usd(cents: number, currency: string): string {
  const amount = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

function Header() {
  return (
    <View style={s.brandRow} fixed>
      <Text style={s.brand}>{ARTIFEX_IDENTITY.companyName.toUpperCase()}</Text>
      <Text style={s.brandTag}>Professional Services Agreement</Text>
    </View>
  );
}

function Footer({ note }: { note: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{note}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

/**
 * Render the master PSA. `showDraftMarking` prints a legal-review banner on every
 * page — driven by whether production sending is enabled (see route/actions).
 */
export function AgreementDocument({ agreement, showDraftMarking }: { agreement: Agreement; showDraftMarking: boolean }) {
  const c = agreement.contentSnapshot;
  const sections = buildAgreementSections(c);
  const generated = new Date(c.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const footerNote = `${c.agreementNumber} · ${agreement.templateVersion} · ${c.clientBusinessName} · Confidential`;

  const DraftBanner = () =>
    showDraftMarking ? (
      <View style={s.draftBanner}>
        <Text style={s.draftText}>DRAFT — REQUIRES LEGAL REVIEW BEFORE CLIENT USE. Not attorney-approved.</Text>
      </View>
    ) : null;

  return (
    <Document title={`Professional Services Agreement — ${c.agreementNumber}`} author="Artifex Labs">
      {/* Cover + key terms */}
      <Page size="A4" style={s.page}>
        <Header />
        <DraftBanner />
        <Text style={s.eyebrow}>Professional Services Agreement</Text>
        <Text style={s.h1}>{c.clientBusinessName}</Text>
        <Text style={s.meta}>Agreement: {c.agreementNumber} · Template {agreement.templateVersion} · Version {c.version}</Text>
        <Text style={s.meta}>
          Proposal reference: {c.proposalNumber ? `${c.proposalNumber} (v${c.proposalVersion})` : c.proposalId}
        </Text>
        <Text style={s.meta}>Generated: {generated}</Text>
        <Text style={s.meta}>Effective date: {c.effectiveDate || "Date of last signature"}</Text>

        <View style={{ height: 1, backgroundColor: LINE, marginVertical: 16 }} />

        <Text style={s.eyebrow}>Key commercial terms</Text>
        <View style={s.termsCard}>
          <View style={s.termRow}><Text style={s.termLabel}>Total project fee</Text><Text style={s.termValue}>{usd(c.totalPriceCents, c.currency)}</Text></View>
          <View style={s.termRow}><Text style={s.termLabel}>Deposit ({c.depositPercent}%)</Text><Text style={s.termValue}>{usd(c.depositAmountCents, c.currency)}</Text></View>
          <View style={s.termRow}><Text style={s.termLabel}>Remaining balance</Text><Text style={s.termValue}>{usd(c.remainingBalanceCents, c.currency)}</Text></View>
          {c.monthlyPartnershipCents != null && c.monthlyPartnershipCents > 0 && (
            <View style={s.termRow}><Text style={s.termLabel}>Ongoing partnership</Text><Text style={[s.termValue, { color: AMBER }]}>{usd(c.monthlyPartnershipCents, c.currency)}/mo</Text></View>
          )}
          <View style={s.termRow}><Text style={s.termLabel}>Estimated timeline</Text><Text style={s.termValue}>{c.timeline}</Text></View>
          <View style={s.termRow}><Text style={s.termLabel}>Governing law</Text><Text style={s.termValue}>{c.governingLaw}</Text></View>
        </View>
        <Text style={[s.para, { color: MUTE, fontSize: 8.5 }]}>
          The complete terms follow. This summary is for convenience only; the numbered sections govern.
        </Text>
        <Footer note={footerNote} />
      </Page>

      {/* Body — all numbered clauses, wrapping naturally across pages */}
      <Page size="A4" style={s.page} wrap>
        <Header />
        <DraftBanner />
        {sections.map((sec) => (
          <View key={sec.number} style={{ marginBottom: 2 }}>
            <Text style={s.sectionHeading}>{sec.number}. {sec.heading}</Text>
            {sec.body.map((line, i) =>
              line.startsWith("• ") ? (
                <Text key={i} style={s.bullet}>{line}</Text>
              ) : (
                <Text key={i} style={s.para}>{line}</Text>
              ),
            )}
          </View>
        ))}
        <Footer note={footerNote} />
      </Page>
    </Document>
  );
}

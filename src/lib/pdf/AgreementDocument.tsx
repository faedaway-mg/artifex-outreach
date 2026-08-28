/* eslint-disable jsx-a11y/alt-text */
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Agreement, AgreementContentSnapshot } from "@/lib/types";
import { buildAgreementSections } from "@/lib/agreement/template";
import { color, space, radius, page, HAIRLINE } from "./design/tokens";
import { type as T, registerPdfFonts } from "./design/typography";
import { Wordmark } from "./design/primitives";

registerPdfFonts();

const s = StyleSheet.create({
  page: {
    backgroundColor: color.paper,
    paddingTop: 46,
    paddingBottom: 54,
    paddingHorizontal: page.marginX,
    color: color.textBody,
  },
  // Running header / footer
  topbar: { position: "absolute", top: 20, left: page.marginX, right: page.marginX, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topbarLabel: { ...T.label, color: color.textFaint },
  topRule: { position: "absolute", top: 38, left: page.marginX, right: page.marginX, borderBottomWidth: HAIRLINE, borderBottomColor: color.hairline },
  footer: { position: "absolute", bottom: 26, left: page.marginX, right: page.marginX, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: HAIRLINE, borderTopColor: color.hairline, paddingTop: 6 },
  footerText: { ...T.fine, color: color.textFaint },

  draftBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FBEEDF", borderWidth: HAIRLINE, borderColor: color.heatSoft, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 10, marginBottom: space.lg },
  draftDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.heat },
  draftText: { ...T.caption, color: "#8A4B18", fontFamily: T.bodyStrong.fontFamily },

  // Cover
  coverEyebrow: { ...T.eyebrow, color: color.accentDeep, marginBottom: 6 },
  coverTitle: { ...T.displayLg, color: color.textPrimary },
  coverSub: { ...T.subtitle, color: color.textMuted, marginTop: 4 },

  partiesRow: { flexDirection: "row", gap: space.md, marginTop: space.xl },
  partyCard: { flex: 1, borderWidth: HAIRLINE, borderColor: color.hairlineStrong, borderRadius: radius.md, padding: space.md, backgroundColor: color.surface },
  partyRole: { ...T.label, color: color.accentDeep, marginBottom: 5 },
  partyName: { ...T.h3, color: color.textPrimary },
  partyLine: { ...T.caption, color: color.textMuted, marginTop: 2 },

  metaGrid: { flexDirection: "row", marginTop: space.xl, borderWidth: HAIRLINE, borderColor: color.hairline, borderRadius: radius.md },
  metaCell: { flex: 1, paddingVertical: space.sm, paddingHorizontal: space.md, borderRightWidth: HAIRLINE, borderRightColor: color.hairline },
  metaCellLast: { borderRightWidth: 0 },
  metaLabel: { ...T.label, color: color.textFaint, marginBottom: 3 },
  metaValue: { ...T.bodyStrong, color: color.textPrimary, fontSize: 9.5 },

  termsWrap: { marginTop: space.xl },
  termsHead: { ...T.label, color: color.textMuted, marginBottom: 7 },
  termsCard: { borderWidth: HAIRLINE, borderColor: color.hairlineStrong, borderRadius: radius.md, backgroundColor: color.surface, paddingHorizontal: space.md },
  termRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: HAIRLINE, borderBottomColor: color.hairline },
  termRowLast: { borderBottomWidth: 0 },
  termLabel: { ...T.body, color: color.textMuted },
  termValue: { ...T.bodyStrong, color: color.textPrimary },
  depositRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, paddingHorizontal: space.md, marginHorizontal: -space.md, backgroundColor: color.accentBgTint, borderBottomWidth: HAIRLINE, borderBottomColor: color.hairline },
  depositLabel: { ...T.bodyStrong, color: color.accentDeep },
  depositValue: { ...T.statSm, color: color.accentDeep, fontSize: 13 },
  convenience: { ...T.fine, color: color.textFaint, marginTop: space.sm },

  stepsWrap: { marginTop: space.xxl },
  stepsRow: { flexDirection: "row", gap: space.md },
  step: { flex: 1, flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  stepNum: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.accentBgTint, alignItems: "center", justifyContent: "center" },
  stepNumText: { ...T.label, color: color.accentDeep, fontSize: 8 },
  stepTitle: { ...T.bodyStrong, color: color.textPrimary, fontSize: 9.5, marginBottom: 1 },
  stepDesc: { ...T.caption, color: color.textMuted },

  // Body
  bodyEyebrow: { ...T.label, color: color.accentDeep, marginBottom: space.sm },
  section: { marginBottom: space.md },
  secHeadRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 4 },
  secNum: { ...T.h4, color: color.accentDeep, fontSize: 9 },
  secHeading: { ...T.h3, color: color.textPrimary },
  para: { ...T.body, color: color.textBody, marginBottom: 5 },
  bullet: { ...T.body, color: color.textBody, marginBottom: 3, marginLeft: 12 },

  // Signature
  sigWrap: { marginTop: space.lg },
  sigIntro: { ...T.body, color: color.textBody, marginBottom: space.md },
  sigRow: { flexDirection: "row", gap: space.lg },
  sigPanel: { flex: 1, borderWidth: HAIRLINE, borderColor: color.hairlineStrong, borderRadius: radius.md, padding: space.md, backgroundColor: color.surface },
  sigRole: { ...T.label, color: color.accentDeep, marginBottom: 3 },
  sigEntity: { ...T.bodyStrong, color: color.textPrimary, marginBottom: space.md },
  sigFieldLabel: { ...T.fine, color: color.textFaint, marginBottom: 2 },
  sigLine: { borderBottomWidth: HAIRLINE, borderBottomColor: color.hairlineStrong, paddingBottom: 14, marginBottom: 3 },
  sigTag: { ...T.caption, color: color.textFaint },
  sigMetaLabel: { ...T.fine, color: color.textFaint },
  sigMetaValue: { ...T.bodySm, color: color.textPrimary, marginBottom: 6 },
});

function usd(cents: number, currency: string): string {
  const amount = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

function TopBar({ number }: { number: string }) {
  return (
    <>
      <View style={s.topbar} fixed>
        <Wordmark size={12} />
        <Text style={s.topbarLabel}>Professional Services Agreement · {number}</Text>
      </View>
      <View style={s.topRule} fixed />
    </>
  );
}

function Footer({ note, draft }: { note: string; draft: boolean }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>{draft ? "DRAFT — pending legal review · " : ""}{note}</Text>
      <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function DraftBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <View style={s.draftBanner}>
      <View style={s.draftDot} />
      <Text style={s.draftText}>DRAFT — requires legal review before client use. Not attorney-approved; visual review is not legal approval.</Text>
    </View>
  );
}

function Party({ role, name, lines }: { role: string; name: string; lines: string[] }) {
  return (
    <View style={s.partyCard}>
      <Text style={s.partyRole}>{role}</Text>
      <Text style={s.partyName}>{name}</Text>
      {lines.filter(Boolean).map((l, i) => <Text key={i} style={s.partyLine}>{l}</Text>)}
    </View>
  );
}

function SignaturePanel({ role, entity, sigTag, dateTag, name, title }: { role: string; entity: string; sigTag: string; dateTag: string; name: string; title?: string }) {
  return (
    <View style={s.sigPanel} wrap={false}>
      <Text style={s.sigRole}>{role}</Text>
      <Text style={s.sigEntity}>{entity}</Text>
      <Text style={s.sigFieldLabel}>Signature</Text>
      {/* The {{sig_*}} text anchor is where SignWell places the signature field. */}
      <View style={s.sigLine}><Text style={s.sigTag}>{sigTag}</Text></View>
      <Text style={s.sigMetaLabel}>Name</Text>
      <Text style={s.sigMetaValue}>{name || "—"}</Text>
      {title != null && (<><Text style={s.sigMetaLabel}>Title / Company</Text><Text style={s.sigMetaValue}>{title || "—"}</Text></>)}
      <Text style={s.sigMetaLabel}>Date</Text>
      <Text style={s.sigMetaValue}>{dateTag}</Text>
    </View>
  );
}

/**
 * Render the master PSA using the Artifex PDF design system. `showDraftMarking`
 * prints the legal-review disclosure (driven by !agreementSendingEnabled()).
 * All content is read from the frozen contentSnapshot — the single source of truth.
 */
export function AgreementDocument({ agreement, showDraftMarking }: { agreement: Agreement; showDraftMarking: boolean }) {
  const c: AgreementContentSnapshot = agreement.contentSnapshot;
  const sections = buildAgreementSections(c);
  const bodySections = sections.filter((sec) => sec.heading !== "Signature Blocks");
  const generated = new Date(c.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const number = c.agreementNumber;
  const footerNote = `${number} · v${c.version} · ${c.clientBusinessName} · Confidential`;
  const proposalRef = c.proposalNumber ? `${c.proposalNumber} · v${c.proposalVersion}` : c.proposalId;

  return (
    <Document title={`Professional Services Agreement — ${number}`} author="Artifex Labs Systems LLC" subject={`Agreement ${number} v${c.version}`}>
      {/* ── Cover + key terms ── */}
      <Page size="A4" style={s.page}>
        <TopBar number={number} />
        <View style={{ marginTop: 26 }}>
          <DraftBanner show={showDraftMarking} />
          <Text style={s.coverEyebrow}>Professional Services Agreement</Text>
          <Text style={s.coverTitle}>{c.clientBusinessName}</Text>
          <Text style={s.coverSub}>Prepared by {c.artifexLegalEntity} d/b/a Artifex Labs</Text>

          <View style={s.partiesRow}>
            <Party role="Provider" name={c.artifexLegalEntity} lines={["d/b/a Artifex Labs", c.artifexSignatory, "Los Angeles, CA"]} />
            <Party role="Client" name={c.clientLegalName} lines={[c.clientContactName, c.clientEmail, c.clientBusinessAddress]} />
          </View>

          <View style={s.metaGrid}>
            <View style={s.metaCell}><Text style={s.metaLabel}>Agreement</Text><Text style={s.metaValue}>{number}</Text></View>
            <View style={s.metaCell}><Text style={s.metaLabel}>Version</Text><Text style={s.metaValue}>v{c.version} · {agreement.templateVersion}</Text></View>
            <View style={s.metaCell}><Text style={s.metaLabel}>Generated</Text><Text style={s.metaValue}>{generated}</Text></View>
            <View style={[s.metaCell, s.metaCellLast]}><Text style={s.metaLabel}>Effective</Text><Text style={s.metaValue}>{c.effectiveDate || "Last signature"}</Text></View>
          </View>

          <View style={s.termsWrap}>
            <Text style={s.termsHead}>Key commercial terms</Text>
            <View style={s.termsCard}>
              <View style={s.termRow}><Text style={s.termLabel}>Total project fee</Text><Text style={s.termValue}>{usd(c.totalPriceCents, c.currency)}</Text></View>
              <View style={s.depositRow}><Text style={s.depositLabel}>Deposit ({c.depositPercent}%) — due on signature</Text><Text style={s.depositValue}>{usd(c.depositAmountCents, c.currency)}</Text></View>
              <View style={s.termRow}><Text style={s.termLabel}>Remaining balance</Text><Text style={s.termValue}>{usd(c.remainingBalanceCents, c.currency)}</Text></View>
              {c.monthlyPartnershipCents != null && c.monthlyPartnershipCents > 0 && (
                <View style={s.termRow}><Text style={s.termLabel}>Optional ongoing partnership</Text><Text style={s.termValue}>{usd(c.monthlyPartnershipCents, c.currency)}/mo</Text></View>
              )}
              <View style={s.termRow}><Text style={s.termLabel}>Estimated timeline</Text><Text style={s.termValue}>{c.timeline}</Text></View>
              <View style={[s.termRow, s.termRowLast]}><Text style={s.termLabel}>Governing law</Text><Text style={s.termValue}>{c.governingLaw}</Text></View>
            </View>
            <Text style={s.convenience}>Proposal reference {proposalRef}. This summary is for convenience only; the numbered sections below govern.</Text>
          </View>

          <View style={s.stepsWrap}>
            <Text style={s.termsHead}>What happens next</Text>
            <View style={s.stepsRow}>
              <View style={s.step}>
                <View style={s.stepNum}><Text style={s.stepNumText}>1</Text></View>
                <View style={{ flex: 1 }}><Text style={s.stepTitle}>Review</Text><Text style={s.stepDesc}>Read the full terms in the numbered sections that follow.</Text></View>
              </View>
              <View style={s.step}>
                <View style={s.stepNum}><Text style={s.stepNumText}>2</Text></View>
                <View style={{ flex: 1 }}><Text style={s.stepTitle}>Sign</Text><Text style={s.stepDesc}>Both parties sign electronically on the signature page.</Text></View>
              </View>
              <View style={s.step}>
                <View style={s.stepNum}><Text style={s.stepNumText}>3</Text></View>
                <View style={{ flex: 1 }}><Text style={s.stepTitle}>Begin</Text><Text style={s.stepDesc}>The {usd(c.depositAmountCents, c.currency)} deposit is due on signature to start work.</Text></View>
              </View>
            </View>
          </View>
        </View>
        <Footer note={footerNote} draft={showDraftMarking} />
      </Page>

      {/* ── Numbered terms (wrap naturally) ── */}
      <Page size="A4" style={s.page} wrap>
        <TopBar number={number} />
        <View style={{ marginTop: 26 }}>
          <Text style={s.bodyEyebrow}>Terms &amp; conditions</Text>
          {bodySections.map((sec) => (
            <View key={sec.number} style={s.section} wrap={false}>
              <View style={s.secHeadRow}>
                <Text style={s.secNum}>{sec.number}</Text>
                <Text style={s.secHeading}>{sec.heading}</Text>
              </View>
              {sec.body.map((line, i) =>
                line.startsWith("• ") ? (
                  <Text key={i} style={s.bullet}>{line}</Text>
                ) : (
                  <Text key={i} style={s.para}>{line}</Text>
                ),
              )}
            </View>
          ))}

          {/* ── Signature blocks (kept together; preserves the {{sig_*}} anchors) ── */}
          <View style={s.sigWrap} break wrap={false}>
            <View style={s.secHeadRow}>
              <Text style={s.secHeading}>Signatures</Text>
            </View>
            <Text style={s.sigIntro}>IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.</Text>
            <View style={s.sigRow}>
              <SignaturePanel role="Provider" entity={`${c.artifexLegalEntity} d/b/a Artifex Labs`} sigTag="{{sig_artifex}}" dateTag="{{date_artifex}}" name={c.artifexSignatory} />
              <SignaturePanel role="Client" entity={c.clientLegalName} sigTag="{{sig_client}}" dateTag="{{date_client}}" name={c.clientContactName || ""} title={c.clientBusinessName || ""} />
            </View>
          </View>
        </View>
        <Footer note={footerNote} draft={showDraftMarking} />
      </Page>
    </Document>
  );
}

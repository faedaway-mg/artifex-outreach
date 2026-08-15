/* eslint-disable jsx-a11y/alt-text */
// The Artifex Quick Review — a bespoke, editorial mini-audit. Not a report template with copy
// swapped in: the composition is art-directed around EVIDENCE. Big editorial finding numerals, a
// strong type hierarchy, hairline structure (no cards/pills/badges/gradients), an evidence line with
// real authority, and a decisive "Where we'd start" close. Legible at phone scale; one page normally,
// paginates to two only when three rich findings need the room. Renders through the existing
// @react-pdf stack with embedded Helvetica (no fragile font dependency).
import React from "react";
import { Document, Page, Text, View, Image, Svg, Path, Circle, StyleSheet } from "@react-pdf/renderer";
import type { QuickReview } from "@/lib/outreach/quick-review";

const C = {
  ink: "#1A1712", body: "#39332B", paper: "#FCFBF8", mute: "#6E665A", faint: "#A49B8A",
  gold: "#C0872B", goldSoft: "#D8B37A", hair: "#E6E0D5", hairSoft: "#EFEAE0", numeral: "#EAE2D2",
};

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, color: C.body, paddingTop: 46, paddingBottom: 56, paddingHorizontal: 54, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.5 },

  // Masthead — small, restrained. Artifex is the author; the business is the subject.
  masthead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  markTile: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 9.5, letterSpacing: 2.4, color: C.ink },
  bizRight: { alignItems: "flex-end", maxWidth: 210 },
  logo: { maxWidth: 130, maxHeight: 34, objectFit: "contain" },
  bizNameSm: { fontFamily: "Helvetica-Bold", fontSize: 10, color: C.mute, letterSpacing: 0.3 },
  hairline: { height: 1, backgroundColor: C.hair, marginTop: 16 },

  // Opening — the strong first moment.
  eyebrow: { fontSize: 8.5, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginTop: 30 },
  bizTitle: { fontFamily: "Helvetica-Bold", fontSize: 30, color: C.ink, marginTop: 8, lineHeight: 1.05 },
  lede: { fontSize: 13.5, color: C.mute, marginTop: 10, lineHeight: 1.45, maxWidth: 400 },
  meta: { fontSize: 9, color: C.faint, letterSpacing: 0.4, marginTop: 10, textTransform: "uppercase" },

  // Findings — editorial numbered blocks. No containers; hairline + big numeral do the structure.
  finding: { marginTop: 26, flexDirection: "row", gap: 16 },
  numeralCol: { width: 46 },
  numeral: { fontFamily: "Helvetica-Bold", fontSize: 40, color: C.numeral, lineHeight: 1 },
  findingBody: { flex: 1, borderTopWidth: 1.5, borderTopColor: C.ink, paddingTop: 10 },
  findingTitle: { fontFamily: "Helvetica-Bold", fontSize: 14.5, color: C.ink, lineHeight: 1.2 },
  found: { fontSize: 11.5, color: C.body, lineHeight: 1.5, marginTop: 7 },

  // Evidence — given real authority: a labelled line with source + confidence. Screenshot-ready.
  evWrap: { marginTop: 11, flexDirection: "row", alignItems: "flex-start", gap: 9 },
  evBar: { width: 2.5, alignSelf: "stretch", backgroundColor: C.gold, borderRadius: 2 },
  evInner: { flex: 1 },
  evLabel: { fontSize: 7.5, letterSpacing: 2, color: C.gold, textTransform: "uppercase" },
  evSource: { fontSize: 10, color: C.ink, fontFamily: "Helvetica-Bold", marginTop: 3 },
  evConf: { fontSize: 8, color: C.mute, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  evShot: { marginTop: 6, maxWidth: 300, maxHeight: 150, objectFit: "contain", borderWidth: 1, borderColor: C.hair },

  subGrid: { marginTop: 12, flexDirection: "row", gap: 22 },
  subCol: { flex: 1 },
  subLabel: { fontSize: 7.5, letterSpacing: 2, color: C.faint, textTransform: "uppercase" },
  subText: { fontSize: 10.5, color: C.body, lineHeight: 1.5, marginTop: 4 },

  // Where we'd start — the decisive conclusion. Heavy gold rule, large label. No box.
  start: { marginTop: 30 },
  startRule: { height: 2.5, backgroundColor: C.gold, width: 54 },
  startEyebrow: { fontSize: 8.5, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginTop: 12 },
  startLabel: { fontFamily: "Helvetica-Bold", fontSize: 19, color: C.ink, marginTop: 7, lineHeight: 1.1 },
  startWhy: { fontSize: 11, color: C.body, lineHeight: 1.5, marginTop: 7, maxWidth: 430 },

  footer: { position: "absolute", left: 54, right: 54, bottom: 30, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 8 },
  footerText: { fontSize: 8.5, color: C.mute, letterSpacing: 0.3 },
});

function ArtifexMark() {
  return (
    <View style={s.markTile}>
      <Svg viewBox="0 0 32 32" style={{ width: 15, height: 15 }}>
        <Path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" stroke="#F7F6F4" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={16} cy={4} r={2.6} fill="#F7F6F4" />
        <Circle cx={5} cy={27} r={2.4} fill="#F7F6F4" />
        <Circle cx={27} cy={27} r={2.4} fill="#E8A24A" />
      </Svg>
    </View>
  );
}

// Honest, editorial lede — never claims more than the evidence supports.
function ledeFor(n: number): string {
  if (n <= 0) return "A short read of your public buying experience.";
  const word = n === 1 ? "One opportunity" : n === 2 ? "Two opportunities" : "Three opportunities";
  return `${word} we found across your public buying experience — each one we could point to directly.`;
}

export function QuickReviewDocument({ review, dateStr }: { review: QuickReview; dateStr: string }) {
  const meta = [review.industryLabel, review.location, review.website].filter(Boolean).join("   ·   ");
  return (
    <Document title={`Artifex Quick Review — ${review.businessName}`} author="Artifex Labs">
      <Page size="A4" style={s.page}>
        {/* Masthead */}
        <View style={s.masthead}>
          <View style={s.brandLeft}>
            <ArtifexMark />
            <Text style={s.wordmark}>ARTIFEX LABS</Text>
          </View>
          <View style={s.bizRight}>
            {review.brand ? <Image src={review.brand.logoUrl} style={s.logo} /> : <Text style={s.bizNameSm}>{review.businessName}</Text>}
          </View>
        </View>
        <View style={s.hairline} />

        {/* Opening moment */}
        <Text style={s.eyebrow}>Quick Review</Text>
        <Text style={s.bizTitle}>{review.businessName}</Text>
        <Text style={s.lede}>{ledeFor(review.findings.length)}</Text>
        {meta ? <Text style={s.meta}>{meta}</Text> : null}

        {/* Findings — editorial, numbered, evidence-forward */}
        {review.findings.map((f, i) => (
          <View key={i} style={s.finding} wrap={false}>
            <View style={s.numeralCol}><Text style={s.numeral}>{String(i + 1).padStart(2, "0")}</Text></View>
            <View style={s.findingBody}>
              <Text style={s.findingTitle}>{f.title}</Text>
              <Text style={s.found}>{f.observation}</Text>

              <View style={s.evWrap}>
                <View style={s.evBar} />
                <View style={s.evInner}>
                  <Text style={s.evLabel}>Evidence</Text>
                  <Text style={s.evSource}>{f.evidence.displayLabel}</Text>
                  <Text style={s.evConf}>{f.evidence.confidence === "Observed" ? "Directly observed" : "Reported by third parties"}</Text>
                  {f.evidence.screenshotRef ? <Image src={f.evidence.screenshotRef} style={s.evShot} /> : null}
                </View>
              </View>

              <View style={s.subGrid}>
                <View style={s.subCol}>
                  <Text style={s.subLabel}>Why it matters</Text>
                  <Text style={s.subText}>{f.whyItMatters}</Text>
                </View>
                {f.whatWedDo ? (
                  <View style={s.subCol}>
                    <Text style={s.subLabel}>What we'd do</Text>
                    <Text style={s.subText}>{f.whatWedDo}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ))}

        {/* Decisive conclusion */}
        {review.start ? (
          <View style={s.start} wrap={false}>
            <View style={s.startRule} />
            <Text style={s.startEyebrow}>Where we'd start</Text>
            <Text style={s.startLabel}>{review.start.label}</Text>
            <Text style={s.startWhy}>{review.start.why}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Artifex Labs · artifexlabs.tech</Text>
          <Text style={s.footerText}>{dateStr}</Text>
        </View>
      </Page>
    </Document>
  );
}

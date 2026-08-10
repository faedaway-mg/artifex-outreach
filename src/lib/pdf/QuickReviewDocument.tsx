/* eslint-disable jsx-a11y/alt-text */
// The Artifex Quick Review — one page, bespoke-feeling, business-specific.
// Co-brands Artifex Labs with the business (neutral side-by-side — never a "×" that could
// imply a formal partnership). The Artifex mark is drawn as vector (no image dependency);
// the business logo is embedded only when reliably resolved, else an elegant name treatment.
// A visual-evidence slot is left in place so Increment C (real screenshots) can drop in later
// without redesigning the page.
import React from "react";
import { Document, Page, Text, View, Image, Svg, Path, Circle, StyleSheet } from "@react-pdf/renderer";
import type { QuickReview } from "@/lib/outreach/quick-review";

const C = {
  ink: "#211C15", paper: "#FCFBF8", mute: "#6E665A", gold: "#E8A24A",
  goldLink: "#A9741B", hair: "#E7E2D8", tile: "#14110C", faint: "#8B8577",
};

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, color: C.ink, paddingVertical: 44, paddingHorizontal: 48, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.5 },
  masthead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  markTile: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.tile, alignItems: "center", justifyContent: "center" },
  artifexName: { fontFamily: "Helvetica-Bold", fontSize: 12, letterSpacing: 0.4, color: C.ink },
  artifexSub: { fontSize: 8, color: C.mute, marginTop: 1 },
  bizBox: { alignItems: "flex-end", maxWidth: 240 },
  bizName: { fontFamily: "Helvetica-Bold", fontSize: 12.5, color: C.ink, textAlign: "right" },
  bizMeta: { fontSize: 8.5, color: C.mute, marginTop: 2, textAlign: "right" },
  logo: { maxWidth: 150, maxHeight: 46, objectFit: "contain" },
  rule: { height: 1, backgroundColor: C.hair, marginTop: 18, marginBottom: 18 },
  eyebrow: { fontSize: 8.5, letterSpacing: 1.6, color: C.goldLink, textTransform: "uppercase" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, color: C.ink, marginTop: 6, lineHeight: 1.15 },
  titleMeta: { fontSize: 9.5, color: C.mute, marginTop: 6 },
  evidenceSlot: { marginTop: 16, borderWidth: 0.75, borderColor: C.hair, borderRadius: 8, borderStyle: "dashed", paddingVertical: 10, paddingHorizontal: 12 },
  evidenceCaption: { fontSize: 8.5, color: C.faint },
  section: { marginTop: 18 },
  sectionLabel: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1.2, color: C.goldLink, textTransform: "uppercase" },
  item: { flexDirection: "row", marginTop: 7, gap: 7 },
  bullet: { color: C.gold, fontFamily: "Helvetica-Bold", fontSize: 11 },
  itemText: { flex: 1, fontSize: 11, color: C.ink, lineHeight: 1.45 },
  why: { marginTop: 7, fontSize: 11, color: "#3A342B", lineHeight: 1.5 },
  close: { marginTop: 22, fontSize: 11, color: C.ink, fontFamily: "Helvetica-Oblique" },
  footer: { position: "absolute", left: 48, right: 48, bottom: 30, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 8 },
  footerText: { fontSize: 8.5, color: C.mute },
});

function ArtifexMark() {
  return (
    <View style={s.markTile}>
      <Svg viewBox="0 0 32 32" style={{ width: 20, height: 20 }}>
        <Path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" stroke="#F7F6F4" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={16} cy={4} r={2.6} fill="#F7F6F4" />
        <Circle cx={5} cy={27} r={2.4} fill="#F7F6F4" />
        <Circle cx={27} cy={27} r={2.4} fill="#F5B95C" />
      </Svg>
    </View>
  );
}

export function QuickReviewDocument({ review, dateStr }: { review: QuickReview; dateStr: string }) {
  const meta = [review.industryLabel, review.location].filter(Boolean).join("  ·  ");
  return (
    <Document title={`Artifex Quick Review — ${review.businessName}`} author="Artifex Labs">
      <Page size="A4" style={s.page}>
        {/* Masthead: Artifex (left) — business (right). Neutral pairing, not "×". */}
        <View style={s.masthead}>
          <View style={s.brandLeft}>
            <ArtifexMark />
            <View>
              <Text style={s.artifexName}>Artifex Labs</Text>
              <Text style={s.artifexSub}>Business technology partner</Text>
            </View>
          </View>
          <View style={s.bizBox}>
            {review.brand ? (
              <Image src={review.brand.logoUrl} style={s.logo} />
            ) : (
              <>
                <Text style={s.bizName}>{review.businessName}</Text>
                {review.website ? <Text style={s.bizMeta}>{review.website}</Text> : null}
              </>
            )}
          </View>
        </View>

        <View style={s.rule} />

        <Text style={s.eyebrow}>Quick Review</Text>
        <Text style={s.title}>Quick Review for {review.businessName}</Text>
        {meta ? <Text style={s.titleMeta}>{meta}{review.website ? `  ·  ${review.website}` : ""}</Text> : null}

        {/* Visual-evidence slot (kept minimal until Increment C provides real screenshots). */}
        <View style={s.evidenceSlot}>
          <Text style={s.evidenceCaption}>Prepared for {review.businessName} from a review of your public online presence.</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>What stood out</Text>
          {review.observations.map((o, i) => (
            <View key={i} style={s.item}><Text style={s.bullet}>›</Text><Text style={s.itemText}>{o}</Text></View>
          ))}
        </View>

        {review.whyItMatters ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Why it matters</Text>
            <Text style={s.why}>{review.whyItMatters}</Text>
          </View>
        ) : null}

        {review.recommendations.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>What we'd prioritize</Text>
            {review.recommendations.map((r, i) => (
              <View key={i} style={s.item}><Text style={s.bullet}>›</Text><Text style={s.itemText}>{r}</Text></View>
            ))}
          </View>
        ) : null}

        <Text style={s.close}>If useful, I'd be happy to walk through what I'd prioritize first.</Text>

        <View style={s.footer}>
          <Text style={s.footerText}>Artifex Labs · artifexlabs.tech</Text>
          <Text style={s.footerText}>{dateStr}</Text>
        </View>
      </Page>
    </Document>
  );
}

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

// Density-aware styles. `compact` tightens VERTICAL RHYTHM only (margins/gaps and a couple of display
// sizes) so three text-only findings + the conclusion hold ONE page — without shrinking body copy to
// an unreadable size or touching the visual system. Non-compact keeps the airier rhythm for 1–2
// findings or any review carrying screenshot evidence (which may legitimately run to two pages).
function makeStyles(compact: boolean) {
  const d = compact
    ? { padTop: 30, padBottom: 36, eyebrowTop: 11, title: 23, hookTop: 3, hookSize: 14, ledeSize: 10.5, ledeTop: 5, metaTop: 4, findTop: 8, bodyPad: 6, hkTop: 0, hkSize: 12, foundTop: 4, foundLH: 1.3, evTop: 5, subTop: 5, subLH: 1.3, startTop: 9, startLabel: 17, startWhyTop: 4 }
    : { padTop: 46, padBottom: 56, eyebrowTop: 28, title: 29, hookTop: 10, hookSize: 18, ledeSize: 12.5, ledeTop: 9, metaTop: 9, findTop: 24, bodyPad: 10, hkTop: 0, hkSize: 13.5, foundTop: 6, foundLH: 1.5, evTop: 10, subTop: 11, subLH: 1.5, startTop: 26, startLabel: 19, startWhyTop: 7 };
  return StyleSheet.create({
    page: { backgroundColor: C.paper, color: C.body, paddingTop: d.padTop, paddingBottom: d.padBottom, paddingHorizontal: 54, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.5 },

    // Masthead — small, restrained. Artifex is the author; the business is the subject.
    masthead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    brandLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
    wordmark: { fontFamily: "Helvetica-Bold", fontSize: 9.5, letterSpacing: 2.4, color: C.ink },
    bizRight: { alignItems: "flex-end", maxWidth: 210 },
    logo: { maxWidth: 130, maxHeight: 34, objectFit: "contain" },
    bizNameSm: { fontFamily: "Helvetica-Bold", fontSize: 10, color: C.mute, letterSpacing: 0.3 },
    hairline: { height: 1, backgroundColor: C.hair, marginTop: 16 },

    // Opening — the strong first moment, now led by a primary curiosity hook from the strongest finding.
    eyebrow: { fontSize: 8.5, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginTop: d.eyebrowTop },
    bizTitle: { fontFamily: "Helvetica-Bold", fontSize: d.title, color: C.ink, marginTop: 8, lineHeight: 1.05 },
    openHookRule: { height: 2.5, width: 40, backgroundColor: C.gold, marginTop: d.hookTop + 4 },
    openHook: { fontFamily: "Helvetica-Bold", fontSize: d.hookSize, color: C.ink, marginTop: 8, lineHeight: 1.2, maxWidth: 440 },
    lede: { fontSize: d.ledeSize, color: C.mute, marginTop: d.ledeTop, lineHeight: 1.45, maxWidth: 400 },
    meta: { fontSize: 9, color: C.faint, letterSpacing: 0.4, marginTop: d.metaTop, textTransform: "uppercase" },

    // Findings — editorial blocks. A LEFT RAIL carries the numeral + the finding's one visual hook
    // (a receipt: a measured number, a contrast, a source excerpt) so evidence is seen, not just read.
    finding: { marginTop: d.findTop, flexDirection: "row", gap: compact ? 12 : 16 },
    rail: { width: compact ? 82 : 104, alignItems: "flex-start" },
    railNum: { fontFamily: "Helvetica-Bold", fontSize: 18, color: C.numeral, lineHeight: 1 },
    findingBody: { flex: 1, borderTopWidth: 1.5, borderTopColor: C.ink, paddingTop: d.bodyPad },
    textHook: { fontFamily: "Helvetica-Bold", fontSize: d.hkSize, color: C.ink, lineHeight: 1.22, marginTop: d.hkTop },
    findingTag: { fontSize: 8.5, letterSpacing: 1.4, color: C.gold, textTransform: "uppercase", marginTop: compact ? 3 : 6, fontFamily: "Helvetica-Bold" },
    found: { fontSize: compact ? 10.5 : 11, color: C.body, lineHeight: d.foundLH, marginTop: d.foundTop },

    // Evidence — a labelled line with source + confidence. Multi-line (airy) or one-line (compact).
    evWrap: { marginTop: d.evTop, flexDirection: "row", alignItems: "flex-start", gap: 9 },
    evBar: { width: 2.5, alignSelf: "stretch", backgroundColor: C.gold, borderRadius: 2 },
    evInner: { flex: 1 },
    evLabel: { fontSize: 7.5, letterSpacing: 2, color: C.gold, textTransform: "uppercase" },
    evSource: { fontSize: 10, color: C.ink, fontFamily: "Helvetica-Bold", marginTop: 3 },
    evConf: { fontSize: 8, color: C.mute, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
    evOne: { flex: 1, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 5 },
    evOneLabel: { fontSize: 7.5, letterSpacing: 2, color: C.gold, textTransform: "uppercase" },
    evOneSource: { fontSize: 9.5, color: C.ink, fontFamily: "Helvetica-Bold" },
    evOneConf: { fontSize: 8, color: C.mute, letterSpacing: 0.6, textTransform: "uppercase" },

    subGrid: { marginTop: d.subTop, flexDirection: "row", gap: compact ? 16 : 22 },
    subCol: { flex: 1 },
    subLabel: { fontSize: 7.5, letterSpacing: 2, color: C.faint, textTransform: "uppercase" },
    subText: { fontSize: compact ? 9.5 : 10.5, color: C.body, lineHeight: d.subLH, marginTop: 3 },

    // ── Visual-hook objects (rendered in the rail) — each maps directly to measured evidence. ──
    statBig: { fontFamily: "Helvetica-Bold", fontSize: compact ? 30 : 38, color: C.ink, lineHeight: 0.95, marginTop: 8 },
    statLabel: { fontSize: 8, color: C.mute, letterSpacing: 0.6, marginTop: 4, lineHeight: 1.25 },
    structRow: { marginTop: 3 },
    structText: { fontSize: 8.5, color: C.body, lineHeight: 1.2 },
    structArrow: { fontSize: 8.5, color: C.goldSoft, lineHeight: 1 },
    cmpTop: { marginTop: 8 },
    cmpVal: { fontFamily: "Helvetica-Bold", fontSize: 22, color: C.ink, lineHeight: 1 },
    cmpValMute: { fontFamily: "Helvetica-Bold", fontSize: 22, color: C.faint, lineHeight: 1 },
    cmpLabel: { fontSize: 7.5, color: C.mute, letterSpacing: 0.4, marginTop: 2, lineHeight: 1.2 },
    cmpDiv: { fontSize: 8, color: C.faint, letterSpacing: 1, marginVertical: 4 },
    exLabel: { fontSize: 7.5, letterSpacing: 2, color: C.gold, textTransform: "uppercase", marginTop: 8 },
    exBox: { borderLeftWidth: 2.5, borderLeftColor: C.gold, paddingLeft: 6, marginTop: 4 },
    exText: { fontFamily: "Courier-Bold", fontSize: 10.5, color: C.ink, lineHeight: 1.25 },
    railShot: { maxWidth: 104, maxHeight: 132, objectFit: "contain", borderWidth: 1, borderColor: C.hair, marginTop: 8 },

    // Where we'd start — the PAYOFF. Heavy gold rule, large label, and the receipt it rests on.
    start: { marginTop: d.startTop },
    startRule: { height: 2.5, backgroundColor: C.gold, width: 54 },
    startEyebrow: { fontSize: 8.5, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginTop: compact ? 7 : 12 },
    startLabel: { fontFamily: "Helvetica-Bold", fontSize: d.startLabel, color: C.ink, marginTop: compact ? 5 : 7, lineHeight: 1.1 },
    startWhy: { fontSize: compact ? 10.5 : 11, color: C.body, lineHeight: compact ? 1.4 : 1.5, marginTop: d.startWhyTop, maxWidth: 430 },
    startProof: { fontSize: 8, letterSpacing: 1, color: C.mute, textTransform: "uppercase", marginTop: compact ? 5 : 8 },

    footer: { position: "absolute", left: 54, right: 54, bottom: 30, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 8 },
    footerText: { fontSize: 8.5, color: C.mute, letterSpacing: 0.3 },
  });
}

type S = ReturnType<typeof makeStyles>;

// The rail's visual hook — one deterministic composition per evidence-derived type. Each is a receipt.
function VisualRail({ hook, s }: { hook: import("@/lib/outreach/review-hooks").VisualHook; s: S }) {
  switch (hook.type) {
    case "STAT":
      return (<>
        <Text style={s.statBig}>{hook.primaryValue}</Text>
        <Text style={s.statLabel}>{hook.supportingLabel}</Text>
      </>);
    case "STRUCTURE":
      return (<>
        <Text style={s.statBig}>{hook.primaryValue}</Text>
        <Text style={s.statLabel}>{hook.supportingLabel}</Text>
        {(hook.structure ?? []).slice(1).map((line, i) => (
          <View key={i} style={s.structRow}><Text style={s.structArrow}>↓</Text><Text style={s.structText}>{line}</Text></View>
        ))}
      </>);
    case "COMPARISON":
      return (<View style={s.cmpTop}>
        <Text style={s.cmpVal}>{hook.comparison?.left}</Text>
        <Text style={s.cmpLabel}>{hook.comparison?.leftLabel}</Text>
        <Text style={s.cmpDiv}>vs</Text>
        <Text style={s.cmpValMute}>{hook.comparison?.right}</Text>
        <Text style={s.cmpLabel}>{hook.comparison?.rightLabel}</Text>
      </View>);
    case "EXCERPT":
      return (<>
        <Text style={s.exLabel}>Found live</Text>
        <View style={s.exBox}><Text style={s.exText}>{hook.evidenceExcerpt}</Text></View>
      </>);
    case "SCREENSHOT":
      return hook.screenshotRef ? <Image src={hook.screenshotRef} style={s.railShot} /> : null;
    default:
      return null; // TEXT_ONLY — the text hook carries it; the rail stays quiet.
  }
}

const markTileStyle = { width: 26, height: 26, borderRadius: 13, backgroundColor: C.ink, alignItems: "center" as const, justifyContent: "center" as const };

function ArtifexMark() {
  return (
    <View style={markTileStyle}>
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
// When a primary hook already leads, the lede is a single tight orientation line (no redundancy).
function countLede(n: number): string {
  const word = n === 1 ? "One" : n === 2 ? "Two" : "Three";
  return `${word} evidence-backed ${n === 1 ? "opportunity" : "opportunities"} from your public buying experience — each one we could point to directly.`;
}

export function QuickReviewDocument({ review, dateStr }: { review: QuickReview; dateStr: string }) {
  const meta = [review.industryLabel, review.location, review.website].filter(Boolean).join("   ·   ");
  // Compact the vertical rhythm ONLY when three text-only findings would otherwise spill a near-empty
  // second page. Any screenshot evidence keeps the airier layout (and may legitimately run two pages).
  const hasScreenshot = review.findings.some((f) => !!f.evidence.screenshotRef);
  const compact = review.findings.length >= 2 && !hasScreenshot;
  const s = makeStyles(compact);
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

        {/* Opening moment — orientation, then a primary curiosity hook drawn from the strongest finding */}
        <Text style={s.eyebrow}>Quick Review</Text>
        <Text style={s.bizTitle}>{review.businessName}</Text>
        {review.openingHook ? (<>
          <View style={s.openHookRule} />
          <Text style={s.openHook}>{review.openingHook}</Text>
          {!compact ? <Text style={s.lede}>{countLede(review.findings.length)}</Text> : null}
        </>) : (
          <Text style={s.lede}>{ledeFor(review.findings.length)}</Text>
        )}
        {meta ? <Text style={s.meta}>{meta}</Text> : null}

        {/* Findings — each a miniature content arc: text hook → visual receipt (rail) → what we found →
            evidence → why it matters → what we'd do. The rail's hook changes per finding (pattern
            interruption), and every hook maps to evidence the finding already carries. */}
        {review.findings.map((f, i) => {
          const p = review.presentations[i];
          return (
            <View key={i} style={s.finding} wrap={false}>
              <View style={s.rail}>
                <Text style={s.railNum}>{String(i + 1).padStart(2, "0")}</Text>
                {p ? <VisualRail hook={p.visualHook} s={s} /> : null}
              </View>
              <View style={s.findingBody}>
                {/* Hook (curiosity) leads. A compact clarity tag names the opportunity; in the tight
                    three-finding composition it folds into the evidence line to save a full row. */}
                <Text style={s.textHook}>{p?.textHook ?? f.title}</Text>
                {!compact ? <Text style={s.findingTag}>{f.title}</Text> : null}
                <Text style={s.found}>{f.observation}</Text>

                <View style={s.evWrap}>
                  <View style={s.evBar} />
                  {compact ? (
                    <View style={s.evOne}>
                      <Text style={s.evOneLabel}>Evidence</Text>
                      <Text style={s.evOneSource}>{f.evidence.displayLabel}</Text>
                      <Text style={s.evOneConf}>· {f.evidence.confidence === "Observed" ? "Directly observed" : "Reported by third parties"}</Text>
                    </View>
                  ) : (
                    <View style={s.evInner}>
                      <Text style={s.evLabel}>Evidence</Text>
                      <Text style={s.evSource}>{f.evidence.displayLabel}</Text>
                      <Text style={s.evConf}>{f.evidence.confidence === "Observed" ? "Directly observed" : "Reported by third parties"}</Text>
                    </View>
                  )}
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
          );
        })}

        {/* The payoff — the answer to "so what would you do first?", tied to one finding + its receipt */}
        {review.start ? (
          <View style={s.start} wrap={false}>
            <View style={s.startRule} />
            <Text style={s.startEyebrow}>Where we'd start</Text>
            <Text style={s.startLabel}>{review.start.label}</Text>
            <Text style={s.startWhy}>{review.start.why}</Text>
            <Text style={s.startProof}>Proof · {review.start.proofReference}</Text>
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

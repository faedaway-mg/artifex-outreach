/* eslint-disable jsx-a11y/alt-text */
/**
 * Business Technology Review — the prospect-facing deliverable.
 * ------------------------------------------------------------------
 * Rebuilt on the Artifex Labs PDF design system (src/lib/pdf/design):
 * a dark, branded cover & closing; warm-paper editorial body; serif
 * display type (Playfair) over Inter, mono accents (JetBrains); crisp
 * vector iconography; and section-by-section visual storytelling.
 *
 * Data contract is unchanged — renderBriefPdf(lead, deliverable,
 * settings) → BriefDocument({ lead, deliverable, settings }).
 */
import React from "react";
import { Document, Page, Text, View, Svg, Path, Circle } from "@react-pdf/renderer";
import type { Lead, Deliverable, Settings } from "@/lib/types";
import { ARTIFEX_IDENTITY } from "@/lib/identity";
import {
  color, space, radius, type,
  Row, Eyebrow, Title, Label, Caption,
  Wordmark, Icon, IconChip,
  pageStyles, RunningHeader, RunningFooter, SectionHeader,
  Card, InsightCell, RatingDots, Chip, Callout,
  JourneyColumn, RecommendationCard, InvestmentBlock, ContactRow,
  PageField, HeroAtmosphere,
} from "@/lib/pdf/design";
import { InvestmentSection } from "./InvestmentSection";
import { engagementLabel, sharesInvestmentModel } from "./investment-view";

const clean = (s: string | null | undefined) => (s ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

/* ================================================================== *
 * COVER — dark, branded hero
 * ================================================================== */

function Cover({ lead, subtitle, confidentiality, dateStr }: { lead: Lead; subtitle: string; confidentiality: string; dateStr: string }) {
  return (
    <Page size="A4" style={pageStyles.hero}>
      <HeroAtmosphere variant="cover" />
      {/* oversized brand mark watermark, bottom-right — quiet structural texture */}
      <View style={{ position: "absolute", right: -30, bottom: -22 }}>
        <Svg viewBox="0 0 32 32" style={{ width: 288, height: 288 }}>
          <Path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" stroke={color.hairlineOnInkStrong} strokeWidth={0.45} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={27} cy={27} r={0.85} fill={color.accentDeep} />
        </Svg>
      </View>

      {/* inset bronze hairline frame */}
      <View style={{ position: "absolute", top: 22, left: 22, right: 22, bottom: 22, borderWidth: 0.75, borderColor: color.hairlineOnInk, borderRadius: radius.md }} />
      {/* top accent bar */}
      <View style={{ position: "absolute", top: 22, left: 22, width: 64, height: 3, backgroundColor: color.accent, borderTopLeftRadius: radius.md }} />

      <View style={{ flexGrow: 1, paddingHorizontal: 52, paddingTop: 54, paddingBottom: 50 }}>
        {/* header */}
        <Row style={{ alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark tone={color.onInkPrimary} size={16} />
          <View style={{ borderWidth: 0.75, borderColor: color.hairlineOnInkStrong, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 11 }}>
            <Text style={[type.fine, { color: color.onInkMuted, letterSpacing: 1.4, textTransform: "uppercase" }]}>Confidential</Text>
          </View>
        </Row>

        {/* title block */}
        <View style={{ flexGrow: 1, justifyContent: "center" }}>
          <Eyebrow color={color.accentSoft}>{subtitle}</Eyebrow>
          <View style={{ height: 18 }} />
          <Text style={[type.displayXl, { color: color.onInkPrimary, maxWidth: 430 }]}>{lead.businessName}</Text>
          <View style={{ height: 18 }} />
          <Row style={{ alignItems: "center", gap: 7 }}>
            <Icon name="mapPin" size={13} color={color.accentSoft} strokeWidth={1.8} />
            <Text style={[type.subtitle, { color: color.onInkBody }]}>
              {[lead.industry, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join("  ·  ")}
            </Text>
          </Row>
          <View style={{ height: 22 }} />
          <View style={{ width: 54, height: 2.5, backgroundColor: color.accent, borderRadius: 2 }} />
        </View>

        {/* footer meta */}
        <Row style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
          <View style={{ maxWidth: 320 }}>
            <Text style={[type.label, { color: color.onInkFaint }]}>Prepared exclusively for</Text>
            <Text style={[type.bodyStrong, { color: color.onInkPrimary, fontSize: 10.5, marginTop: 3 }]}>{lead.businessName}</Text>
            <Text style={[type.caption, { color: color.onInkMuted, marginTop: 6 }]}>{confidentiality}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[type.label, { color: color.onInkFaint }]}>Date prepared</Text>
            <Text style={[type.bodyStrong, { color: color.onInkPrimary, fontSize: 10.5, marginTop: 3 }]}>{dateStr}</Text>
            <Text style={[type.mono, { color: color.onInkMuted, marginTop: 6, fontSize: 8 }]}>{clean(ARTIFEX_IDENTITY.publicWebsite)}</Text>
          </View>
        </Row>
      </View>
    </Page>
  );
}

/* ================================================================== *
 * EXECUTIVE SUMMARY
 * ================================================================== */

function ExecutiveSummary({ lead, c, footerNote, index }: { lead: Lead; c: Deliverable["content"]; footerNote: string; index: string }) {
  const hasRating = typeof lead.rating === "number" && lead.rating > 0;
  const hasReviews = typeof lead.reviewCount === "number" && (lead.reviewCount ?? 0) > 0;
  const showRep = hasRating || hasReviews;

  return (
    <Page size="A4" style={pageStyles.content}>
      <PageField variant="exec" numeral={index.split(" ")[0]} />
      <RunningHeader businessName={lead.businessName} />
      <RunningFooter note={footerNote} />

      <SectionHeader index={index} eyebrow="Executive Summary" title="The opportunity in brief" intro={c.executiveSnapshot.overview} icon="compass" />

      {/* reputation band — real, verifiable signal */}
      {showRep && (
        <Card style={{ marginBottom: space.lg }} padding={space.lg} wrap={false}>
          <Row style={{ alignItems: "center" }}>
            {hasRating && (
              <View style={{ flex: 1 }}>
                <Row style={{ alignItems: "flex-end", gap: 8 }}>
                  <Text style={[type.stat, { color: color.textPrimary }]}>{(lead.rating as number).toFixed(1)}</Text>
                  <View style={{ marginBottom: 5 }}><RatingDots rating={lead.rating as number} /></View>
                </Row>
                <Label style={{ marginTop: 5 }}>Public rating</Label>
              </View>
            )}
            {hasReviews && (
              <>
                <View style={{ width: 0.75, height: 40, backgroundColor: color.hairline, marginHorizontal: space.lg }} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.stat, { color: color.textPrimary }]}>{(lead.reviewCount as number).toLocaleString()}</Text>
                  <Label style={{ marginTop: 5 }}>Customer reviews</Label>
                </View>
              </>
            )}
            <View style={{ width: 0.75, height: 40, backgroundColor: color.hairline, marginHorizontal: space.lg }} />
            <View style={{ flex: 1.4 }}>
              <Text style={[type.h3, { color: color.textPrimary }]}>{lead.industry}</Text>
              <Label style={{ marginTop: 5 }}>{[lead.city, lead.state].filter(Boolean).join(", ")}</Label>
            </View>
          </Row>
        </Card>
      )}

      {/* primary opportunity — the headline of the whole review */}
      <View wrap={false} style={{ backgroundColor: color.inkBg, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg }}>
        <Row style={{ alignItems: "center", gap: 8, marginBottom: 9 }}>
          <Icon name="target" size={14} color={color.accentSoft} strokeWidth={1.9} />
          <Label color={color.accentSoft}>Primary opportunity</Label>
        </Row>
        <Text style={[type.subtitle, { color: color.onInkPrimary, lineHeight: 1.5 }]}>{c.executiveSnapshot.primaryOpportunity}</Text>
      </View>

      {/* supporting insight grid */}
      <Row style={{ gap: space.md }}>
        <InsightCell icon="check" label="What's working" body={c.executiveSnapshot.whatIsWorking} accent={color.positive} tint={color.positiveBgTint} />
        <InsightCell icon="trend" label="Potential impact" body={c.executiveSnapshot.potentialImpact} accent={color.heat} tint="#FBEBDD" />
      </Row>
      <View style={{ height: space.md }} />
      <Callout icon="chat" label="Recommended first conversation" variant="info">
        {c.executiveSnapshot.recommendedFirstConversation}
      </Callout>
    </Page>
  );
}

/* ================================================================== *
 * STRENGTHS
 * ================================================================== */

function Strengths({ lead, c, footerNote, index }: { lead: Lead; c: Deliverable["content"]; footerNote: string; index: string }) {
  return (
    <Page size="A4" style={pageStyles.content}>
      <PageField variant="strengths" numeral={index.split(" ")[0]} />
      <RunningHeader businessName={lead.businessName} />
      <RunningFooter note={footerNote} />
      <SectionHeader
        index={index}
        eyebrow="Strengths"
        title="What's working well"
        intro={`An honest look at the foundations ${lead.businessName} can build on.`}
        icon="shield"
      />
      <Row style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
        {c.strengths.map((str, i) => (
          <View key={i} wrap={false} style={{ width: "48.5%", marginBottom: space.md, backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.lg, borderLeftWidth: 3, borderLeftColor: color.positive, paddingVertical: space.lg, paddingHorizontal: space.lg, minHeight: 88 }}>
            <IconChip name="check" size={26} icon={13} bg={color.positiveBgTint} fg={color.positive} />
            <View style={{ height: 10 }} />
            <Text style={[type.body, { color: color.textBody, fontSize: 9.5 }]}>{str}</Text>
          </View>
        ))}
      </Row>
    </Page>
  );
}

/* ================================================================== *
 * OPPORTUNITIES
 * ================================================================== */

function Opportunities({ lead, c, footerNote, index }: { lead: Lead; c: Deliverable["content"]; footerNote: string; index: string }) {
  return (
    <Page size="A4" style={pageStyles.content}>
      <PageField variant="opps" numeral={index.split(" ")[0]} />
      <RunningHeader businessName={lead.businessName} />
      <RunningFooter note={footerNote} />
      <SectionHeader
        index={index}
        eyebrow="Key Opportunities"
        title="Where modernization would help most"
        intro="Each observation pairs what we saw with its likely business consequence and a concrete direction forward."
        icon="search"
      />
      {c.opportunities.map((o, i) => (
        <RecommendationCard
          key={i}
          index={i + 1}
          emphasis={i === 0 ? "primary" : "secondary"}
          title={o.observation}
          rows={[
            { label: "Evidence", text: o.evidence, icon: "monitor", accent: color.textFaint },
            { label: "Consequence", text: o.businessConsequence, icon: "bolt", accent: color.heat },
            { label: "Direction", text: o.modernizationDirection, icon: "route", accent: color.accentDeep },
          ]}
        />
      ))}
    </Page>
  );
}

/* ================================================================== *
 * CUSTOMER JOURNEY
 * ================================================================== */

function CustomerJourney({ lead, c, footerNote, index }: { lead: Lead; c: Deliverable["content"]; footerNote: string; index: string }) {
  return (
    <Page size="A4" style={pageStyles.content}>
      <PageField variant="journey" numeral={index.split(" ")[0]} />
      <RunningHeader businessName={lead.businessName} />
      <RunningFooter note={footerNote} />
      <SectionHeader
        index={index}
        eyebrow="Customer Journey"
        title="From today's experience to an improved flow"
        intro="The same customer, before and after — where friction lives now, and how the experience could feel instead."
        icon="route"
      />
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <JourneyColumn title="Today" steps={c.customerJourney.currentState} variant="current" />
        </View>
        <View style={{ width: 34, paddingTop: 18, alignItems: "center" }}>
          <View style={{ width: 26, height: 26, borderRadius: 26, backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairlineStrong, alignItems: "center", justifyContent: "center" }}>
            <Icon name="arrowRight" size={13} color={color.accentDeep} strokeWidth={1.9} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <JourneyColumn title="With modernization" steps={c.customerJourney.futureState} variant="future" />
        </View>
      </Row>
    </Page>
  );
}

/* ================================================================== *
 * RECOMMENDED PATH + INVESTMENT
 * ================================================================== */

function RecommendedPath({ lead, c, footerNote, index, hasSharedModel }: { lead: Lead; c: Deliverable["content"]; footerNote: string; index: string; hasSharedModel: boolean }) {
  const mp = c.modernizationPath;
  return (
    <Page size="A4" style={pageStyles.content}>
      <PageField variant="path" numeral={index.split(" ")[0]} />
      <RunningHeader businessName={lead.businessName} />
      <RunningFooter note={footerNote} />
      <SectionHeader
        index={index}
        eyebrow="Recommended Path"
        title="A clear, staged way forward"
        icon="layers"
      />

      {/* engagement card */}
      <View wrap={false} style={{ backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.lg, borderTopWidth: 3, borderTopColor: color.accent, padding: space.lg, marginBottom: space.lg }}>
        <Label color={color.accentDeep}>Recommended engagement</Label>
        <View style={{ height: 6 }} />
        <Title style={{ fontSize: 17 }}>{engagementLabel(mp.primaryEngagement)}</Title>
        <View style={{ height: space.md }} />
        <Label style={{ marginBottom: 8 }}>Potential components</Label>
        <Row style={{ flexWrap: "wrap" }}>
          {mp.components.map((comp, i) => (
            <Chip key={i}>{comp}</Chip>
          ))}
        </Row>
      </View>

      {mp.secondaryOpportunity ? (
        <View style={{ marginBottom: space.lg }}>
          <Callout icon="spark" label="Optional secondary opportunity" variant="accent">
            {mp.secondaryOpportunity}
          </Callout>
        </View>
      ) : null}

      {/* When a full explainable model is shared, the investment gets its own
          dedicated section; otherwise show the legacy range block / neutral note here. */}
      {hasSharedModel ? (
        <Callout icon="gauge" label="Investment" variant="accent">
          A full, itemized investment breakdown follows on the next page — every figure tied to a specific piece of work.
        </Callout>
      ) : mp.investmentRange ? (
        <InvestmentBlock range={mp.investmentRange} disclaimer={mp.disclaimer} />
      ) : (
        <Callout icon="clock" label="Investment" variant="neutral">
          {mp.disclaimer || "A tailored investment range is shared during discovery, once the right scope is confirmed together."}
        </Callout>
      )}
    </Page>
  );
}

/* ================================================================== *
 * NEXT STEPS / CTA — dark closing
 * ================================================================== */

function NextSteps({ lead, c, settings }: { lead: Lead; c: Deliverable["content"]; settings: Settings }) {
  return (
    <Page size="A4" style={pageStyles.hero}>
      <HeroAtmosphere variant="closing" />
      <View style={{ position: "absolute", right: -30, bottom: -22 }}>
        <Svg viewBox="0 0 32 32" style={{ width: 288, height: 288 }}>
          <Path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" stroke={color.hairlineOnInkStrong} strokeWidth={0.45} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={27} cy={27} r={0.85} fill={color.accentDeep} />
        </Svg>
      </View>
      <View style={{ position: "absolute", top: 22, left: 22, right: 22, bottom: 22, borderWidth: 0.75, borderColor: color.hairlineOnInk, borderRadius: radius.md }} />

      <View style={{ flexGrow: 1, paddingHorizontal: 52, paddingTop: 54, paddingBottom: 50 }}>
        <Wordmark tone={color.onInkPrimary} size={16} />

        <View style={{ flexGrow: 1, justifyContent: "center" }}>
          <Eyebrow color={color.accentSoft}>Next step</Eyebrow>
          <View style={{ height: 16 }} />
          <Text style={[type.displayLg, { color: color.onInkPrimary, maxWidth: 420 }]}>{c.cta.headline}</Text>
          <View style={{ height: 14 }} />
          <Text style={[type.lede, { color: color.onInkBody, maxWidth: 430 }]}>{c.cta.body}</Text>
          <View style={{ height: 26 }} />
          <View style={{ width: 54, height: 2.5, backgroundColor: color.accent, borderRadius: 2, marginBottom: 24 }} />

          <View style={{ maxWidth: 400 }}>
            <ContactRow icon="calendar" label="Schedule a discovery call" value={clean(settings.calendarLink)} />
            <ContactRow icon="globe" label="Website" value={clean(settings.website)} />
            <ContactRow icon="mail" label="Email" value={settings.contactEmail} />
          </View>
        </View>

        <Row style={{ alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[type.caption, { color: color.onInkMuted }]}>{settings.businessAddress}</Text>
          <Text style={[type.mono, { color: color.onInkFaint, fontSize: 8 }]}>{ARTIFEX_IDENTITY.brandTagline}</Text>
        </Row>
      </View>
    </Page>
  );
}

/* ================================================================== *
 * DOCUMENT
 * ================================================================== */

export function BriefDocument({ lead, deliverable, settings }: { lead: Lead; deliverable: Deliverable; settings: Settings }) {
  const c = deliverable.content;
  const dateStr = new Date(deliverable.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const footerNote = `Prepared for ${lead.businessName}  ·  Confidential`;

  const hasJourney = (c.customerJourney?.currentState?.length ?? 0) > 0 || (c.customerJourney?.futureState?.length ?? 0) > 0;

  // Numbered content sections are assembled conditionally, then labelled
  // "0N / 0T" against the real total — so a brief with no strengths/opps
  // never shows a misleading denominator.
  const two = (n: number) => String(n).padStart(2, "0");
  const sections: Array<(index: string) => React.ReactElement> = [
    (index) => <ExecutiveSummary key="exec" lead={lead} c={c} footerNote={footerNote} index={index} />,
  ];
  if (c.strengths.length > 0) sections.push((index) => <Strengths key="strengths" lead={lead} c={c} footerNote={footerNote} index={index} />);
  if (c.opportunities.length > 0) sections.push((index) => <Opportunities key="opps" lead={lead} c={c} footerNote={footerNote} index={index} />);
  if (hasJourney) sections.push((index) => <CustomerJourney key="journey" lead={lead} c={c} footerNote={footerNote} index={index} />);

  // The explainable investment breakdown is surfaced to the prospect only when a
  // range has been approved for sharing AND a model exists behind it.
  const shareModel = sharesInvestmentModel(c.modernizationPath);
  sections.push((index) => <RecommendedPath key="path" lead={lead} c={c} footerNote={footerNote} index={index} hasSharedModel={shareModel} />);
  if (shareModel) sections.push((index) => <InvestmentSection key="investment" lead={lead} model={c.modernizationPath.investmentModel!} footerNote={footerNote} index={index} />);

  const total = sections.length;
  const pages: React.ReactElement[] = [
    <Cover key="cover" lead={lead} subtitle={c.cover.subtitle} confidentiality={c.cover.confidentialityNote} dateStr={dateStr} />,
    ...sections.map((render, i) => render(`${two(i + 1)} / ${two(total)}`)),
    <NextSteps key="cta" lead={lead} c={c} settings={settings} />,
  ];

  return (
    <Document title={`${c.cover.subtitle} — ${lead.businessName}`} author="Artifex Labs">
      {pages}
    </Document>
  );
}

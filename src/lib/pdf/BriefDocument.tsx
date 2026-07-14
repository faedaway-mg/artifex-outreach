/* eslint-disable jsx-a11y/alt-text */
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Lead, Deliverable, Settings } from "@/lib/types";
import { ARTIFEX_IDENTITY } from "@/lib/identity";

// Premium, minimal, calm brief — light document for easy sharing/printing.
const INK = "#0D0F13";
const MUTE = "#5B6270";
const LINE = "#E4E7EC";
const ACCENT = "#3E75E6";
const INDIGO = "#6D6FE0";
const AMBER = "#E89B3B";
const BG = "#FBFBFD";

const s = StyleSheet.create({
  page: { backgroundColor: BG, paddingTop: 54, paddingBottom: 54, paddingHorizontal: 54, fontSize: 10.5, color: INK, fontFamily: "Helvetica", lineHeight: 1.5 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  brand: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 1 },
  brandTag: { fontSize: 8, color: MUTE },
  footer: { position: "absolute", bottom: 26, left: 54, right: 54, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTE, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  eyebrow: { fontSize: 8, letterSpacing: 1.6, color: ACCENT, fontFamily: "Helvetica-Bold", textTransform: "uppercase", marginBottom: 6 },
  h1: { fontSize: 26, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 8 },
  h2: { fontSize: 15, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 10 },
  p: { fontSize: 10.5, color: "#2A2F39", marginBottom: 8 },
  muted: { color: MUTE },
  card: { borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 14, marginBottom: 10, backgroundColor: "#FFFFFF" },
  label: { fontSize: 7.5, letterSpacing: 1, color: MUTE, textTransform: "uppercase", fontFamily: "Helvetica-Bold", marginBottom: 3 },
  bullet: { flexDirection: "row", marginBottom: 5 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: INDIGO, marginTop: 5, marginRight: 8 },
  // minWidth:0 lets flex text wrap correctly inside row bullets / two-column cards.
  bulletText: { flex: 1, minWidth: 0 },
  journeyCol: { flex: 1, minWidth: 0 },
  chip: { fontSize: 8, color: ACCENT, borderWidth: 1, borderColor: "#CBD9F5", borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6, marginRight: 4, marginBottom: 4 },
});

function Header() {
  return (
    <View style={s.brandRow} fixed>
      <Text style={s.brand}>{ARTIFEX_IDENTITY.companyName.toUpperCase()}</Text>
      <Text style={s.brandTag}>{ARTIFEX_IDENTITY.brandTagline} · {ARTIFEX_IDENTITY.publicWebsite.replace(/^https?:\/\//, "")}</Text>
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

export function BriefDocument({ lead, deliverable, settings }: { lead: Lead; deliverable: Deliverable; settings: Settings }) {
  const c = deliverable.content;
  const dateStr = new Date(deliverable.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const footerNote = `Prepared for ${lead.businessName} · Confidential`;

  // Build pages conditionally so a section with no approved content never
  // produces a blank page (fixes the empty "Key Opportunities" page).
  const hasJourney = (c.customerJourney?.currentState?.length ?? 0) > 0 || (c.customerJourney?.futureState?.length ?? 0) > 0;
  const pages: React.ReactElement[] = [];

  pages.push(
    <Page key="cover" size="A4" style={s.page}>
      <Header />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={s.eyebrow}>{c.cover.subtitle}</Text>
        <Text style={s.h1}>{lead.businessName}</Text>
        <Text style={[s.p, s.muted]}>{lead.industry} · {lead.city}, {lead.state}</Text>
        <View style={{ height: 1, backgroundColor: LINE, marginVertical: 18 }} />
        <Text style={s.p}>Prepared specifically for {lead.businessName}</Text>
        <Text style={[s.p, s.muted]}>Date prepared: {dateStr}</Text>
        <Text style={[s.p, s.muted]}>{c.cover.confidentialityNote}</Text>
      </View>
      <Footer note={footerNote} />
    </Page>
  );

  pages.push(
    <Page key="exec" size="A4" style={s.page}>
      <Header />
      <Text style={s.eyebrow}>Executive snapshot</Text>
      <Text style={s.h2}>The opportunity in brief</Text>
      <Text style={s.p}>{c.executiveSnapshot.overview}</Text>
      <View style={s.card}>
        <Text style={s.label}>What's already working</Text>
        <Text style={s.p}>{c.executiveSnapshot.whatIsWorking}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Primary opportunity</Text>
        <Text style={s.p}>{c.executiveSnapshot.primaryOpportunity}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Potential business impact</Text>
        <Text style={s.p}>{c.executiveSnapshot.potentialImpact}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Recommended first conversation</Text>
        <Text style={s.p}>{c.executiveSnapshot.recommendedFirstConversation}</Text>
      </View>
      <Footer note={footerNote} />
    </Page>
  );

  if (c.strengths.length > 0) {
    pages.push(
      <Page key="strengths" size="A4" style={s.page}>
        <Header />
        <Text style={s.eyebrow}>Strengths</Text>
        <Text style={s.h2}>What's working well</Text>
        <Text style={[s.p, s.muted]}>An honest look at what already sets {lead.businessName} apart.</Text>
        <View style={{ marginTop: 8 }}>
          {c.strengths.map((str, i) => (
            <View key={i} style={s.bullet} wrap={false}>
              <View style={[s.dot, { backgroundColor: "#2FA97D" }]} />
              <Text style={[s.bulletText, { color: "#2A2F39" }]}>{str}</Text>
            </View>
          ))}
        </View>
        <Footer note={footerNote} />
      </Page>
    );
  }

  if (c.opportunities.length > 0) {
    pages.push(
      <Page key="opps" size="A4" style={s.page}>
        <Header />
        <Text style={s.eyebrow}>Key opportunities</Text>
        <Text style={s.h2}>Where modernization would help most</Text>
        {c.opportunities.map((o, i) => (
          <View key={i} style={s.card} wrap={false}>
            <Text style={[s.label, { color: ACCENT }]}>Opportunity {i + 1}</Text>
            <Text style={{ fontSize: 11.5, fontFamily: "Helvetica-Bold", marginBottom: 6 }}>{o.observation}</Text>
            <Text style={s.p}><Text style={s.muted}>Evidence: </Text>{o.evidence}</Text>
            <Text style={s.p}><Text style={s.muted}>Possible consequence: </Text>{o.businessConsequence}</Text>
            <Text style={s.p}><Text style={s.muted}>Modernization direction: </Text>{o.modernizationDirection}</Text>
          </View>
        ))}
        <Footer note={footerNote} />
      </Page>
    );
  }

  if (hasJourney) {
    pages.push(
      <Page key="journey" size="A4" style={s.page}>
        <Header />
        <Text style={s.eyebrow}>Customer journey</Text>
        <Text style={s.h2}>From current experience to modernized flow</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={[s.card, s.journeyCol]}>
            <Text style={s.label}>Current state</Text>
            {c.customerJourney.currentState.map((step, i) => (
              <View key={i} style={s.bullet}><View style={[s.dot, { backgroundColor: MUTE }]} /><Text style={s.bulletText}>{step}</Text></View>
            ))}
          </View>
          <View style={[s.card, s.journeyCol, { borderColor: "#CBD9F5" }]}>
            <Text style={[s.label, { color: ACCENT }]}>Modernized state</Text>
            {c.customerJourney.futureState.map((step, i) => (
              <View key={i} style={s.bullet}><View style={[s.dot, { backgroundColor: ACCENT }]} /><Text style={s.bulletText}>{step}</Text></View>
            ))}
          </View>
        </View>
        <Footer note={footerNote} />
      </Page>
    );
  }

  pages.push(
    <Page key="path" size="A4" style={s.page}>
      <Header />
      <Text style={s.eyebrow}>Recommended path</Text>
      <Text style={s.h2}>{c.modernizationPath.primaryEngagement}</Text>
      <Text style={s.label}>Potential components</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 12, marginTop: 4 }}>
        {c.modernizationPath.components.map((comp, i) => (
          <Text key={i} style={s.chip}>{comp}</Text>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.label}>Optional secondary opportunity</Text>
        <Text style={s.p}>{c.modernizationPath.secondaryOpportunity}</Text>
      </View>
      {c.modernizationPath.investmentRange && (
        <View style={[s.card, { borderColor: "#F0D9B5" }]}>
          <Text style={[s.label, { color: AMBER }]}>Preliminary investment range</Text>
          <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: INK }}>{c.modernizationPath.investmentRange}</Text>
        </View>
      )}
      <Text style={[s.p, s.muted, { fontSize: 9 }]}>{c.modernizationPath.disclaimer}</Text>
      <Footer note={footerNote} />
    </Page>
  );

  pages.push(
    <Page key="cta" size="A4" style={s.page}>
      <Header />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={s.eyebrow}>Next step</Text>
        <Text style={s.h1}>{c.cta.headline}</Text>
        <Text style={s.p}>{c.cta.body}</Text>
        <View style={{ height: 1, backgroundColor: LINE, marginVertical: 18 }} />
        <Text style={s.p}><Text style={s.muted}>Schedule a discovery call: </Text>{settings.calendarLink}</Text>
        <Text style={s.p}><Text style={s.muted}>Website: </Text>{settings.website}</Text>
        <Text style={s.p}><Text style={s.muted}>Email: </Text>{settings.contactEmail}</Text>
        <Text style={[s.p, s.muted, { marginTop: 16, fontSize: 9 }]}>{settings.businessAddress}</Text>
      </View>
      <Footer note={footerNote} />
    </Page>
  );

  return (
    <Document title={`${c.cover.subtitle} — ${lead.businessName}`} author="Artifex Labs">
      {pages}
    </Document>
  );
}

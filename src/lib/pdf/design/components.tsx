/* eslint-disable jsx-a11y/alt-text */
/**
 * Artifex Labs — PDF Design System · Components
 * ------------------------------------------------------------------
 * Composed, reusable building blocks assembled from primitives.tsx.
 * A document is written almost entirely in these: page chrome, section
 * openers, cards, callouts, charts, journey rails, recommendation
 * cards, the investment block, and the next-steps panel.
 */
import React from "react";
import { View, Text, Image } from "@react-pdf/renderer";
import { color, space, radius, page } from "./tokens";
import { type } from "./typography";
import {
  Row, Col, Eyebrow, Title, Lede, Body, Label, Caption,
  Wordmark, Icon, IconChip, AccentTick, type IconName,
} from "./primitives";

/* ==================================================================
 * PAGE CHROME
 * ================================================================== */

/**
 * Page style presets for the <Page> element (which BriefDocument owns,
 * since @react-pdf requires <Page> to be a direct child of <Document>).
 *  - `content`: warm paper with room reserved for header/footer chrome.
 *  - `hero`: full-bleed dark ink, no chrome (cover / CTA).
 */
export const pageStyles = {
  content: {
    backgroundColor: color.paper,
    paddingTop: 58,
    paddingBottom: 52,
    paddingHorizontal: page.marginX,
    color: color.textBody,
  },
  hero: {
    backgroundColor: color.inkBg,
    padding: 0,
    color: color.onInkBody,
  },
} as const;

/** Fixed running header — wordmark + document label + hairline. */
export function RunningHeader({ businessName, on = "light" }: { businessName: string; on?: "light" | "dark" }) {
  const tone = on === "dark" ? color.onInkPrimary : color.textPrimary;
  const muted = on === "dark" ? color.onInkMuted : color.textFaint;
  const line = on === "dark" ? color.hairlineOnInk : color.hairline;
  return (
    <View fixed style={{ position: "absolute", top: 26, left: page.marginX, right: page.marginX }}>
      <Row style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <Wordmark tone={tone} size={13} />
        <Text style={[type.kicker, { color: muted, letterSpacing: 1.3 }]}>BUSINESS TECHNOLOGY REVIEW</Text>
      </Row>
      <View style={{ height: 0.75, backgroundColor: line }} />
    </View>
  );
}

/** Fixed running footer — confidential note + page x / y. */
export function RunningFooter({ note, on = "light" }: { note: string; on?: "light" | "dark" }) {
  const muted = on === "dark" ? color.onInkMuted : color.textFaint;
  const line = on === "dark" ? color.hairlineOnInk : color.hairline;
  return (
    <View fixed style={{ position: "absolute", bottom: 24, left: page.marginX, right: page.marginX }}>
      <View style={{ height: 0.75, backgroundColor: line, marginBottom: 7 }} />
      <Row style={{ alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[type.fine, { color: muted, letterSpacing: 0.4 }]}>{note}</Text>
        <Text style={[type.fine, { color: muted, letterSpacing: 0.6 }]} render={({ pageNumber, totalPages }) => `${pad(pageNumber)} / ${pad(totalPages)}`} />
      </Row>
    </View>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/* ==================================================================
 * SECTION OPENER (inside a content page)
 * ================================================================== */

export function SectionHeader({
  index,
  eyebrow,
  title,
  intro,
  icon,
}: {
  index?: string;
  eyebrow: string;
  title: string;
  intro?: string;
  icon?: IconName;
}) {
  return (
    <View style={{ marginBottom: space.xl }}>
      <Row style={{ alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
        <Row style={{ alignItems: "center", gap: 9 }}>
          {icon && <IconChip name={icon} size={30} icon={15} />}
          <Eyebrow>{eyebrow}</Eyebrow>
        </Row>
        {index && <Text style={[type.eyebrow, { color: color.textFaint, fontSize: 9 }]}>{index}</Text>}
      </Row>
      <Title style={{ maxWidth: 430 }}>{title}</Title>
      {intro && (
        <>
          <View style={{ height: space.sm }} />
          <Lede color={color.textMuted} style={{ maxWidth: 458 }}>{intro}</Lede>
        </>
      )}
      <View style={{ height: space.md }} />
      <AccentTick />
    </View>
  );
}

/* ==================================================================
 * SURFACES
 * ================================================================== */

export function Card({
  children,
  accent,
  tint,
  style,
  padding = space.lg,
  wrap = true,
}: {
  children: React.ReactNode;
  accent?: string; // draws a left accent bar
  tint?: string; // fill color (default white surface)
  style?: Record<string, any>;
  padding?: number;
  wrap?: boolean;
}) {
  return (
    <View
      wrap={wrap}
      style={{
        backgroundColor: tint ?? color.surface,
        borderWidth: 0.75,
        borderColor: color.hairline,
        borderRadius: radius.lg,
        borderLeftWidth: accent ? 3 : 0.75,
        borderLeftColor: accent ?? color.hairline,
        padding,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

/** Two-tone insight cell used in grids (icon + label + body). */
export function InsightCell({
  icon,
  label,
  body,
  accent = color.accentDeep,
  tint = color.accentBgTint,
  style,
}: {
  icon: IconName;
  label: string;
  body: string;
  accent?: string;
  tint?: string;
  style?: Record<string, any>;
}) {
  return (
    <View wrap={false} style={{ flex: 1, minWidth: 0, backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.lg, padding: space.lg, ...style }}>
      <Row style={{ alignItems: "center", gap: 8, marginBottom: 9 }}>
        <IconChip name={icon} size={26} icon={13} bg={tint} fg={accent} />
        <Label color={color.textMuted}>{label}</Label>
      </Row>
      <Body style={{ fontSize: 9.5 }}>{body}</Body>
    </View>
  );
}

/* ==================================================================
 * STATS / DATA
 * ================================================================== */

/** A large serif figure with a caption — for real metrics. */
export function Stat({
  value,
  label,
  sub,
  accent = color.textPrimary,
  align = "flex-start",
}: {
  value: string;
  label: string;
  sub?: string;
  accent?: string;
  align?: "flex-start" | "center";
}) {
  return (
    <View style={{ alignItems: align }}>
      <Text style={[type.stat, { color: accent }]}>{value}</Text>
      <View style={{ height: 4 }} />
      <Label>{label}</Label>
      {sub && <Caption style={{ marginTop: 2 }}>{sub}</Caption>}
    </View>
  );
}

/** Five dots that fill according to a 0–5 rating. */
export function RatingDots({ rating, size = 6, on = "light" }: { rating: number; size?: number; on?: "light" | "dark" }) {
  const filled = Math.round(Math.max(0, Math.min(5, rating)));
  const empty = on === "dark" ? color.hairlineOnInkStrong : color.hairlineStrong;
  return (
    <Row style={{ gap: 4, alignItems: "center" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: size, height: size, borderRadius: size, backgroundColor: i < filled ? color.accent : empty }} />
      ))}
    </Row>
  );
}

/* ==================================================================
 * LISTS
 * ================================================================== */

/** A single check/dot bullet row. */
export function Bullet({
  children,
  icon = "check",
  accent = color.positive,
  on = "light",
}: {
  children: React.ReactNode;
  icon?: IconName | null;
  accent?: string;
  on?: "light" | "dark";
}) {
  const body = on === "dark" ? color.onInkBody : color.textBody;
  return (
    <Row style={{ marginBottom: 8, alignItems: "flex-start" }} wrap={false}>
      <View style={{ marginTop: 1.5, marginRight: 9 }}>
        {icon ? <Icon name={icon} size={12} color={accent} strokeWidth={2} /> : <View style={{ width: 4, height: 4, borderRadius: 4, backgroundColor: accent, marginTop: 4 }} />}
      </View>
      <Text style={[type.body, { color: body, flex: 1, minWidth: 0 }]}>{children}</Text>
    </Row>
  );
}

/** A pill tag. */
export function Chip({ children, accent = color.accentDeep, tint = color.accentBgTint }: { children: React.ReactNode; accent?: string; tint?: string }) {
  return (
    <View style={{ backgroundColor: tint, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 11, marginRight: 6, marginBottom: 6 }}>
      <Text style={[type.h4, { color: accent, fontSize: 8.5, letterSpacing: 0.2 }]}>{children}</Text>
    </View>
  );
}

/* ==================================================================
 * CALLOUT
 * ================================================================== */

type Variant = "accent" | "info" | "heat" | "positive" | "neutral";

const VARIANTS: Record<Variant, { fg: string; tint: string; border: string }> = {
  accent: { fg: color.accentDeep, tint: color.accentBgTint, border: "#EAD8B8" },
  info: { fg: color.info, tint: color.infoBgTint, border: "#CFDCFB" },
  heat: { fg: color.heat, tint: "#FBEBDD", border: "#F3D3B6" },
  positive: { fg: color.positive, tint: color.positiveBgTint, border: "#C9E3D6" },
  neutral: { fg: color.textBody, tint: color.surfaceSubtle, border: color.hairlineStrong },
};

export function Callout({
  icon,
  label,
  children,
  variant = "accent",
}: {
  icon?: IconName;
  label?: string;
  children: React.ReactNode;
  variant?: Variant;
}) {
  const v = VARIANTS[variant];
  return (
    <View wrap={false} style={{ backgroundColor: v.tint, borderWidth: 0.75, borderColor: v.border, borderRadius: radius.lg, padding: space.lg }}>
      {(icon || label) && (
        <Row style={{ alignItems: "center", gap: 8, marginBottom: 7 }}>
          {icon && <Icon name={icon} size={14} color={v.fg} strokeWidth={1.9} />}
          {label && <Label color={v.fg}>{label}</Label>}
        </Row>
      )}
      <Text style={[type.body, { color: color.textBody }]}>{children}</Text>
    </View>
  );
}

/* ==================================================================
 * CHART — horizontal bars (honest, labeled visual)
 * ================================================================== */

export function BarChart({
  data,
  height = 9,
}: {
  data: Array<{ label: string; value: number; caption?: string; color?: string }>;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <Col style={{ gap: 11 }}>
      {data.map((d, i) => (
        <View key={i}>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 }}>
            <Text style={[type.h4, { color: color.textBody, fontSize: 9 }]}>{d.label}</Text>
            {d.caption && <Text style={[type.mono, { color: color.textMuted, fontSize: 8 }]}>{d.caption}</Text>}
          </Row>
          <View style={{ height, backgroundColor: color.surfaceSunken, borderRadius: radius.pill }}>
            <View style={{ width: `${Math.max(4, (d.value / max) * 100)}%`, height, backgroundColor: d.color ?? color.accent, borderRadius: radius.pill }} />
          </View>
        </View>
      ))}
    </Col>
  );
}

/* ==================================================================
 * CUSTOMER JOURNEY RAIL
 * ================================================================== */

export function JourneyColumn({
  title,
  steps,
  variant,
}: {
  title: string;
  steps: string[];
  variant: "current" | "future";
}) {
  const isFuture = variant === "future";
  const accent = isFuture ? color.info : color.textFaint;
  const tint = isFuture ? color.infoBgTint : color.surfaceSubtle;
  const border = isFuture ? "#CFDCFB" : color.hairline;
  return (
    <View style={{ minWidth: 0, backgroundColor: color.surface, borderWidth: 0.75, borderColor: border, borderRadius: radius.lg }}>
      <View style={{ backgroundColor: tint, paddingVertical: 9, paddingHorizontal: space.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomWidth: 0.75, borderBottomColor: border }}>
        <Row style={{ alignItems: "center", gap: 7 }}>
          <Icon name={isFuture ? "spark" : "clock"} size={13} color={accent} strokeWidth={1.9} />
          <Label color={accent}>{title}</Label>
        </Row>
      </View>
      <View style={{ padding: space.lg }}>
        {steps.map((s, i) => (
          <Row key={i} style={{ marginBottom: i === steps.length - 1 ? 0 : 10, alignItems: "flex-start" }} wrap={false}>
            <View style={{ width: 16, height: 16, borderRadius: 16, backgroundColor: isFuture ? color.info : "transparent", borderWidth: isFuture ? 0 : 0.75, borderColor: color.hairlineStrong, alignItems: "center", justifyContent: "center", marginRight: 9, marginTop: 0.5 }}>
              <Text style={[type.mono, { fontSize: 7.5, color: isFuture ? "#FFFFFF" : color.textMuted }]}>{i + 1}</Text>
            </View>
            <Text style={[type.bodySm, { color: color.textBody, flex: 1, minWidth: 0 }]}>{s}</Text>
          </Row>
        ))}
      </View>
    </View>
  );
}

/* ==================================================================
 * RECOMMENDATION CARD (opportunity)
 * ================================================================== */

export function RecommendationCard({
  index,
  title,
  rows,
  emphasis = "primary",
}: {
  index: number;
  title: string;
  rows: Array<{ label: string; text: string; icon: IconName; accent?: string }>;
  /** The first recommendation reads as primary; the rest visibly recede. */
  emphasis?: "primary" | "secondary";
}) {
  const primary = emphasis === "primary";
  return (
    <View
      wrap={false}
      style={{
        backgroundColor: color.surface,
        borderWidth: 0.75,
        borderColor: color.hairline,
        borderRadius: radius.lg,
        borderLeftWidth: primary ? 3 : 1.5,
        borderLeftColor: primary ? color.accent : color.hairlineStrong,
        padding: space.lg,
        marginBottom: space.md,
      }}
    >
      <Row style={{ alignItems: "center", gap: 10, marginBottom: primary ? 12 : 11 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: primary ? color.inkBg : color.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
          <Text style={[type.stat, { fontSize: 12, color: primary ? color.accentSoft : color.textMuted }]}>{pad(index)}</Text>
        </View>
        <Text style={[type.h3, { color: color.textPrimary, flex: 1, minWidth: 0, fontSize: primary ? 13.5 : 12 }]}>{title}</Text>
        {primary && (
          <View style={{ backgroundColor: color.accentBgTint, borderRadius: radius.pill, paddingVertical: 2.5, paddingHorizontal: 9 }}>
            <Text style={[type.fine, { color: color.accentDeep, fontSize: 6.8, letterSpacing: 1.2, textTransform: "uppercase" }]}>Priority</Text>
          </View>
        )}
      </Row>
      <View style={{ gap: 8 }}>
        {rows.map((r, i) => (
          <Row key={i} style={{ alignItems: "flex-start" }} wrap={false}>
            <View style={{ width: 88, flexShrink: 0 }}>
              <Row style={{ alignItems: "center", gap: 6 }}>
                <Icon name={r.icon} size={11} color={r.accent ?? color.textFaint} strokeWidth={1.9} />
                <Label color={color.textMuted} style={{ fontSize: 7 }}>{r.label}</Label>
              </Row>
            </View>
            <Text style={[type.bodySm, { color: color.textBody, flex: 1, minWidth: 0 }]}>{r.text}</Text>
          </Row>
        ))}
      </View>
    </View>
  );
}

/* ==================================================================
 * INVESTMENT BLOCK (dark, ember-accented)
 * ================================================================== */

export function InvestmentBlock({ range, disclaimer }: { range: string; disclaimer: string }) {
  return (
    <View wrap={false} style={{ backgroundColor: color.inkBg, borderRadius: radius.xl, padding: space.xl, overflow: "hidden" }}>
      <Row style={{ alignItems: "center", gap: 8, marginBottom: space.md }}>
        <Icon name="bolt" size={14} color={color.heatSoft} strokeWidth={1.9} />
        <Text style={[type.label, { color: color.heatSoft }]}>Preliminary investment range</Text>
      </Row>
      <Row style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
        <Text style={[type.displayLg, { color: color.onInkPrimary, fontSize: 30 }]}>{range}</Text>
      </Row>
      <View style={{ height: 0.75, backgroundColor: color.hairlineOnInk, marginVertical: space.md }} />
      <Text style={[type.fine, { color: color.onInkMuted }]}>{disclaimer}</Text>
    </View>
  );
}

/* ==================================================================
 * NEXT STEP ITEM
 * ================================================================== */

export function ContactRow({ icon, label, value, on = "dark" }: { icon: IconName; label: string; value: string; on?: "light" | "dark" }) {
  const muted = on === "dark" ? color.onInkMuted : color.textMuted;
  const strong = on === "dark" ? color.onInkPrimary : color.textPrimary;
  const fg = on === "dark" ? color.accentSoft : color.accentDeep;
  return (
    <Row style={{ alignItems: "center", gap: 12, marginBottom: 12 }}>
      <View style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 0.75, borderColor: on === "dark" ? color.hairlineOnInkStrong : color.hairline, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={14} color={fg} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.fine, { color: muted, letterSpacing: 1, textTransform: "uppercase" }]}>{label}</Text>
        <Text style={[type.bodyStrong, { color: strong, fontSize: 10.5, marginTop: 1 }]}>{value}</Text>
      </View>
    </Row>
  );
}

/* ==================================================================
 * BROWSER FRAME (reusable screenshot chrome — ready for website shots)
 * ================================================================== */

export function BrowserFrame({ src, urlLabel }: { src: string; urlLabel?: string }) {
  return (
    <View wrap={false} style={{ borderWidth: 0.75, borderColor: color.hairlineStrong, borderRadius: radius.md, overflow: "hidden", backgroundColor: color.surface }}>
      <Row style={{ alignItems: "center", gap: 5, backgroundColor: color.surfaceSubtle, paddingVertical: 6, paddingHorizontal: 9, borderBottomWidth: 0.75, borderBottomColor: color.hairline }}>
        <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: "#E06A5A" }} />
        <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: "#E8B24A" }} />
        <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: "#5FB07A" }} />
        {urlLabel && <Text style={[type.mono, { fontSize: 7.5, color: color.textFaint, marginLeft: 6 }]}>{urlLabel}</Text>}
      </Row>
      <Image src={src} style={{ width: "100%" }} />
    </View>
  );
}

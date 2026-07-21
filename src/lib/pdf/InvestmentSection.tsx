/* eslint-disable jsx-a11y/alt-text */
/**
 * Business Technology Review — Investment section.
 * ------------------------------------------------------------------
 * Renders the stored InvestmentModel as an editorial breakdown in the
 * redesigned PDF's design language: an "at a glance" anchor, a plain-
 * language explanation of what moves the range, one calm card per
 * scoped component (observation → what it addresses → deliverables →
 * effort → investment → outcome), a reconciliation line proving the
 * components equal the total, and a clearly separated ongoing / third-
 * party costs panel.
 *
 * It consumes the same stored model the operator UI uses (via the pure
 * helpers in investment-view.ts) — no pricing is recomputed here.
 */
import React from "react";
import { Page, Text, View } from "@react-pdf/renderer";
import type { Lead, InvestmentModel, InvestmentLineItem, InvestmentOngoingCost } from "@/lib/types";
import {
  color, space, radius, type,
  Row, Icon, Label,
  pageStyles, RunningHeader, RunningFooter, SectionHeader,
} from "@/lib/pdf/design";
import {
  formatMoneyRange, cadenceLabel, engagementLabel, effortLabel,
  totalEffortHours, lineTitle, investmentReconciliation, rangeDeterminants,
  thirdPartyCosts, artifexOngoingCosts,
} from "@/lib/pdf/investment-view";

/* ---------------------------- glance anchor ---------------------------- */

function GlanceBlock({ model }: { model: InvestmentModel }) {
  const monthly = model.billing === "monthly";
  return (
    <View wrap={false} style={{ backgroundColor: color.inkBg, borderRadius: radius.xl, paddingVertical: space.lg, paddingHorizontal: space.xl, marginBottom: space.lg }}>
      <Row style={{ alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
        <Row style={{ alignItems: "center", gap: 8 }}>
          <Icon name="bolt" size={13} color={color.heatSoft} strokeWidth={1.9} />
          <Label color={color.heatSoft}>Investment at a glance</Label>
        </Row>
        <View style={{ borderWidth: 0.75, borderColor: color.hairlineOnInkStrong, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 }}>
          <Text style={[type.fine, { color: color.onInkBody, letterSpacing: 0.8, textTransform: "uppercase" }]}>{cadenceLabel(model.billing)}</Text>
        </View>
      </Row>

      <Text style={[type.displayLg, { color: color.onInkPrimary, fontSize: 29 }]}>
        {model.rangeLabel}
        {monthly ? <Text style={[type.subtitle, { color: color.onInkMuted }]}>  / month</Text> : null}
      </Text>
      <Text style={[type.caption, { color: color.onInkMuted, marginTop: 4 }]}>
        Preliminary {monthly ? "monthly engagement" : "implementation"} range · {engagementLabel(model.engagement)}
      </Text>

      <View style={{ height: 0.75, backgroundColor: color.hairlineOnInk, marginVertical: space.md }} />
      <Text style={[type.bodySm, { color: color.onInkBody }]}>{model.explanation}</Text>
    </View>
  );
}

/* -------------------- what determines the range ----------------------- */

function Determinants({ model }: { model: InvestmentModel }) {
  const d = rangeDeterminants(model);
  const hrs = totalEffortHours(model);
  const cell = (label: string, text: string, dot: string) => (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.md, padding: space.md }}>
      <Row style={{ alignItems: "center", gap: 7, marginBottom: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: dot }} />
        <Label color={color.textMuted}>{label}</Label>
      </Row>
      <Text style={[type.bodySm, { color: color.textBody, fontSize: 8.8 }]}>{text}</Text>
    </View>
  );
  return (
    <View style={{ marginBottom: space.lg }}>
      <Row style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
        <Label color={color.textMuted}>What determines the range</Label>
        <Text style={[type.mono, { color: color.textFaint, fontSize: 8 }]}>
          {hrs.low === hrs.high ? hrs.low : `${hrs.low}–${hrs.high}`} hrs total · {model.lineItems.length} components
        </Text>
      </Row>
      <Row style={{ gap: space.md }}>
        {cell("Lower end", d.lower, color.positive)}
        {cell("Upper end", d.upper, color.heat)}
      </Row>
    </View>
  );
}

/* ---------------------------- line item card -------------------------- */

function LineItemCard({ index, item }: { index: number; item: InvestmentLineItem }) {
  const two = String(index).padStart(2, "0");
  return (
    <View wrap={false} style={{ backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.lg, borderLeftWidth: 3, borderLeftColor: color.accent, paddingVertical: space.md, paddingHorizontal: space.lg, marginBottom: 10 }}>
      {/* header: number · title · investment */}
      <Row style={{ alignItems: "flex-start", justifyContent: "space-between", marginBottom: 7 }}>
        <Row style={{ alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: color.inkBg, alignItems: "center", justifyContent: "center" }}>
            <Text style={[type.stat, { fontSize: 12, color: color.accentSoft }]}>{two}</Text>
          </View>
          <Text style={[type.h3, { color: color.textPrimary, fontSize: 12, flex: 1, minWidth: 0 }]}>{lineTitle(item)}</Text>
        </Row>
        <View style={{ alignItems: "flex-end", marginLeft: 10 }}>
          <Text style={[type.statSm, { color: color.textPrimary, fontSize: 14 }]}>{formatMoneyRange(item.investmentLow, item.investmentHigh)}</Text>
          <Text style={[type.fine, { color: color.textFaint, marginTop: 1 }]}>estimated investment</Text>
        </View>
      </Row>

      {/* effort + complexity */}
      <Row style={{ alignItems: "center", gap: 7, marginBottom: 8 }}>
        <Icon name="clock" size={11} color={color.textFaint} strokeWidth={1.9} />
        <Text style={[type.mono, { color: color.textMuted, fontSize: 8 }]}>{effortLabel(item)}</Text>
        <View style={{ backgroundColor: color.surfaceSubtle, borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 }}>
          <Text style={[type.fine, { color: color.textMuted, letterSpacing: 0.6, textTransform: "uppercase" }]}>{item.effort.complexity}</Text>
        </View>
      </Row>

      {/* what it addresses (observation → impact, condensed) */}
      <View style={{ marginBottom: 8 }}>
        <Label color={color.textMuted} style={{ marginBottom: 4 }}>What it addresses</Label>
        <Text style={[type.bodySm, { color: color.textBody, fontSize: 9 }]}>{item.observation}</Text>
        {item.businessImpact ? <Text style={[type.bodySm, { color: color.textMuted, fontSize: 8.6, marginTop: 3 }]}>{item.businessImpact}</Text> : null}
      </View>

      {/* deliverables + outcome, two columns */}
      <Row style={{ gap: space.lg }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label color={color.textMuted} style={{ marginBottom: 5 }}>Included deliverables</Label>
          {item.deliverables.map((d, i) => (
            <Row key={i} style={{ alignItems: "flex-start", marginBottom: 4 }} wrap={false}>
              <View style={{ marginTop: 1, marginRight: 7 }}><Icon name="check" size={10} color={color.accentDeep} strokeWidth={2.1} /></View>
              <Text style={[type.bodySm, { color: color.textBody, fontSize: 8.8, flex: 1, minWidth: 0 }]}>{d}</Text>
            </Row>
          ))}
        </View>
        <View style={{ flex: 1, minWidth: 0, backgroundColor: color.positiveBgTint, borderRadius: radius.md, padding: space.md }}>
          <Row style={{ alignItems: "center", gap: 6, marginBottom: 5 }}>
            <Icon name="trend" size={11} color={color.positive} strokeWidth={1.9} />
            <Label color={color.positive}>Expected outcome</Label>
          </Row>
          <Text style={[type.bodySm, { color: color.textBody, fontSize: 8.8 }]}>{item.expectedOutcome}</Text>
        </View>
      </Row>
    </View>
  );
}

/* --------------------------- reconciliation --------------------------- */

function ReconciliationBar({ model }: { model: InvestmentModel }) {
  const r = investmentReconciliation(model);
  const componentsRange = formatMoneyRange(r.componentsLow, r.componentsHigh);
  return (
    <View wrap={false} style={{ flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: color.surfaceSubtle, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: space.lg, marginBottom: space.lg }}>
      <Icon name={r.ok ? "check" : "target"} size={13} color={r.ok ? color.positive : color.heat} strokeWidth={2} />
      <Text style={[type.bodySm, { color: color.textBody, fontSize: 9, flex: 1, minWidth: 0 }]}>
        <Text style={{ color: color.textPrimary, ...type.bodyStrong, fontSize: 9 }}>{r.count} component{r.count === 1 ? "" : "s"}</Text>
        {"  ·  "}sum to {componentsRange}
        {r.ok ? <Text>{"  ·  "}reconciling exactly to the {r.rangeLabel} total above.</Text> : <Text>.</Text>}
      </Text>
    </View>
  );
}

/* ----------------------- ongoing / third-party ------------------------ */

function OngoingCosts({ model }: { model: InvestmentModel }) {
  const third = thirdPartyCosts(model);
  const artifex = artifexOngoingCosts(model);
  const monthly = model.billing === "monthly";
  const hasDeclared = third.length > 0 || artifex.length > 0;

  const costRow = (c: InvestmentOngoingCost, i: number) => (
    <Row key={i} style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 7 }} wrap={false}>
      <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
        <Row style={{ alignItems: "center", gap: 7 }}>
          <Text style={[type.bodySm, { color: color.textBody, fontSize: 9 }]}>{c.label}</Text>
          <View style={{ backgroundColor: c.paidTo === "third-party" ? color.infoBgTint : color.accentBgTint, borderRadius: radius.pill, paddingVertical: 1.5, paddingHorizontal: 7 }}>
            <Text style={[type.fine, { color: c.paidTo === "third-party" ? color.info : color.accentDeep, fontSize: 6.8, letterSpacing: 0.5, textTransform: "uppercase" }]}>{c.paidTo === "third-party" ? "Third party" : "Artifex"}</Text>
          </View>
        </Row>
        {c.note ? <Text style={[type.fine, { color: color.textFaint, marginTop: 2 }]}>{c.note}</Text> : null}
      </View>
      <Text style={[type.mono, { color: color.textPrimary, fontSize: 9 }]}>{c.amount}</Text>
    </Row>
  );

  return (
    <View wrap={false} style={{ backgroundColor: color.surface, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md }}>
      <Row style={{ alignItems: "center", gap: 8, marginBottom: 9 }}>
        <Icon name="layers" size={13} color={color.info} strokeWidth={1.9} />
        <Label color={color.info}>Ongoing &amp; third-party costs</Label>
      </Row>

      {monthly && (
        <Text style={[type.bodySm, { color: color.textBody, fontSize: 9, marginBottom: hasDeclared ? 9 : 6 }]}>
          The figure above is a <Text style={type.bodyStrong}>recurring monthly</Text> Artifex engagement fee, not a one-time build.
        </Text>
      )}

      {hasDeclared ? (
        <>
          <View style={{ marginBottom: 8 }}>{[...third, ...artifex].map(costRow)}</View>
          <View style={{ height: 0.75, backgroundColor: color.hairline, marginBottom: 8 }} />
        </>
      ) : null}

      <Text style={[type.fine, { color: color.textMuted }]}>
        {third.length > 0
          ? "Third-party amounts are billed directly by those providers and are not included in the Artifex investment above."
          : "Any third-party software, hosting, or usage-based costs are billed directly by those providers and are separate from the Artifex investment above — we'll identify the specific tools together during discovery."}
      </Text>
    </View>
  );
}

function ComponentsLabel() {
  return <Label color={color.textMuted} style={{ marginBottom: 10 }}>Investment by component</Label>;
}

function DiscoveryNote({ model }: { model: InvestmentModel }) {
  return <Text style={[type.fine, { color: color.textFaint, marginTop: 10 }]}>{model.discoveryNote}</Text>;
}

/* ------------------------------ the page ------------------------------ */

export function InvestmentSection({ lead, model, footerNote, index }: { lead: Lead; model: InvestmentModel; footerNote: string; index: string }) {
  return (
    <Page size="A4" style={pageStyles.content}>
      <RunningHeader businessName={lead.businessName} />
      <RunningFooter note={footerNote} />
      <SectionHeader
        index={index}
        eyebrow="Investment"
        title="What this would take — and why"
        intro="Every figure below is a scoped piece of work — here is exactly what makes up the range."
        icon="gauge"
      />

      <GlanceBlock model={model} />
      <Determinants model={model} />

      {model.lineItems.length === 1 ? (
        // Single component: the glance + determinants make a clean overview page,
        // then the one card and its reconciliation/costs open a fresh, full page —
        // avoids a nearly-empty trailing page.
        <View break>
          <ComponentsLabel />
          <LineItemCard index={1} item={model.lineItems[0]} />
          <ReconciliationBar model={model} />
          <OngoingCosts model={model} />
          <DiscoveryNote model={model} />
        </View>
      ) : (
        <>
          {/* Glue the label to the first card so it fills the overview page and never orphans. */}
          <View wrap={false}>
            <ComponentsLabel />
            <LineItemCard index={1} item={model.lineItems[0]} />
          </View>
          {model.lineItems.slice(1).map((item, i) => (
            <LineItemCard key={item.id ?? i + 1} index={i + 2} item={item} />
          ))}
          {/* Keep the reconciliation and cost separation together beneath the last card. */}
          <View wrap={false}>
            <ReconciliationBar model={model} />
            <OngoingCosts model={model} />
            <DiscoveryNote model={model} />
          </View>
        </>
      )}
    </Page>
  );
}

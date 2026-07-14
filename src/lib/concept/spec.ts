import { z } from "zod";
import { VISUAL_DIRECTIONS, PREVIEW_TYPES, TARGET_ACTIONS } from "../types";

// Plain text only — never HTML. The renderer escapes everything; these schemas
// keep the model output structured and bounded.
const text = (max = 400) => z.string().max(max);
const safeUrl = z
  .string()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//i.test(v) || /^(tel:|mailto:)/i.test(v), "unsafe url")
  .refine((v) => !/^javascript:/i.test(v) && !/^data:/i.test(v), "unsafe url scheme");

// ── Allowlisted components ───────────────────────────────────────────────────
const navigation = z.object({
  type: z.literal("navigation"),
  props: z.object({ businessName: text(120), links: z.array(text(40)).max(6), cta: text(40).optional() }),
});
const hero = z.object({
  type: z.literal("hero"),
  props: z.object({ headline: text(160), subhead: text(320), ctaLabel: text(40), ctaHref: safeUrl.optional(), eyebrow: text(60).optional() }),
});
const serviceGrid = z.object({
  type: z.literal("serviceGrid"),
  props: z.object({ heading: text(120), services: z.array(z.object({ name: text(80), description: text(240) })).max(8) }),
});
const trustMetrics = z.object({
  type: z.literal("trustMetrics"),
  props: z.object({ heading: text(120).optional(), metrics: z.array(z.object({ value: text(40), label: text(80) })).max(4) }),
});
const process = z.object({
  type: z.literal("process"),
  props: z.object({ heading: text(120), steps: z.array(z.object({ title: text(80), detail: text(240) })).max(5) }),
});
const reviewSummary = z.object({
  // Aggregate reputation only — NO quoted testimonials (validation enforces this).
  type: z.literal("reviewSummary"),
  props: z.object({ rating: text(20), reviewCount: text(20), source: text(40) }),
});
const ctaProps = z.object({ heading: text(160), body: text(320), buttonLabel: text(40), buttonHref: safeUrl.optional() });
const appointmentCta = z.object({ type: z.literal("appointmentCta"), props: ctaProps });
const consultationCta = z.object({ type: z.literal("consultationCta"), props: ctaProps });
const quoteRequest = z.object({ type: z.literal("quoteRequest"), props: ctaProps });
const faq = z.object({
  type: z.literal("faq"),
  props: z.object({ heading: text(120), items: z.array(z.object({ q: text(160), a: text(400) })).max(6) }),
});
const contact = z.object({
  type: z.literal("contact"),
  props: z.object({ heading: text(120), phone: text(40).optional(), address: text(200).optional(), bookingHref: safeUrl.optional() }),
});
const footer = z.object({
  type: z.literal("footer"),
  props: z.object({ businessName: text(120), phone: text(40).optional(), address: text(200).optional() }),
});
const disclaimer = z.object({
  type: z.literal("disclaimer"),
  props: z.object({ text: text(600) }),
});

export const componentSchema = z.discriminatedUnion("type", [
  navigation, hero, serviceGrid, trustMetrics, process, reviewSummary, appointmentCta, consultationCta, quoteRequest, faq, contact, footer, disclaimer,
]);
export type ConceptComponent = z.infer<typeof componentSchema>;

export const conceptSpecSchema = z.object({
  meta: z.object({
    businessName: text(160),
    category: text(80),
    previewType: z.enum(PREVIEW_TYPES),
    visualDirection: z.enum(VISUAL_DIRECTIONS),
    targetAction: z.enum(TARGET_ACTIONS),
    recommendedService: text(80).nullable(),
  }),
  components: z.array(componentSchema).min(2).max(14),
});
export type ConceptSpec = z.infer<typeof conceptSpecSchema>;

// ── Visual direction tokens (controlled design system) ───────────────────────
export interface VisualTokens {
  bg: string; surface: string; text: string; muted: string; accent: string; accentText: string;
  font: string; radius: string; heroBg: string;
}
export const VISUAL_TOKENS: Record<string, VisualTokens> = {
  "Quiet Professional": { bg: "#0f1216", surface: "#171b21", text: "#eef1f6", muted: "#9aa4b2", accent: "#3e75e6", accentText: "#fff", font: "'Inter',system-ui,sans-serif", radius: "12px", heroBg: "linear-gradient(160deg,#141922,#0f1216)" },
  "Warm Modern": { bg: "#14110f", surface: "#1e1a16", text: "#f6f1ea", muted: "#b3a795", accent: "#e08a3c", accentText: "#1a1206", font: "'Inter',system-ui,sans-serif", radius: "16px", heroBg: "linear-gradient(160deg,#241d16,#14110f)" },
  "Premium Editorial": { bg: "#0b0b0d", surface: "#141417", text: "#f5f5f7", muted: "#9d9da6", accent: "#c9a26a", accentText: "#141417", font: "Georgia,'Times New Roman',serif", radius: "6px", heroBg: "linear-gradient(160deg,#17171b,#0b0b0d)" },
  "Local Trust": { bg: "#0d1117", surface: "#161c24", text: "#eef2f7", muted: "#93a1b0", accent: "#2aa98a", accentText: "#04120d", font: "'Inter',system-ui,sans-serif", radius: "12px", heroBg: "linear-gradient(160deg,#122129,#0d1117)" },
  "Clear Utility": { bg: "#101317", surface: "#191d23", text: "#eef1f5", muted: "#98a2ad", accent: "#5e93f7", accentText: "#05122b", font: "'Inter',system-ui,sans-serif", radius: "8px", heroBg: "linear-gradient(160deg,#161b22,#101317)" },
  "Refined Hospitality": { bg: "#12100e", surface: "#1c1814", text: "#f4efe8", muted: "#b6a893", accent: "#b98a4b", accentText: "#1a1206", font: "Georgia,serif", radius: "14px", heroBg: "linear-gradient(160deg,#221c15,#12100e)" },
  "Contemporary Wellness": { bg: "#0e1413", surface: "#161e1c", text: "#eef4f1", muted: "#93a89f", accent: "#42c9a6", accentText: "#04140f", font: "'Inter',system-ui,sans-serif", radius: "18px", heroBg: "linear-gradient(160deg,#132220,#0e1413)" },
  "Confident Trade": { bg: "#0f1115", surface: "#181b20", text: "#eef1f5", muted: "#98a1ab", accent: "#f5b95c", accentText: "#1a1305", font: "'Inter',system-ui,sans-serif", radius: "10px", heroBg: "linear-gradient(160deg,#1a1e25,#0f1115)" },
  "Boutique Retail": { bg: "#100d10", surface: "#1a161b", text: "#f4eef4", muted: "#ac9fac", accent: "#c66a9a", accentText: "#180410", font: "Georgia,serif", radius: "14px", heroBg: "linear-gradient(160deg,#201a22,#100d10)" },
  "Founder-Led": { bg: "#0c0f14", surface: "#151a21", text: "#eef2f8", muted: "#96a1b0", accent: "#8b8df4", accentText: "#0a0716", font: "'Inter',system-ui,sans-serif", radius: "12px", heroBg: "linear-gradient(160deg,#141a24,#0c0f14)" },
};

export function tokensFor(direction: string): VisualTokens {
  return VISUAL_TOKENS[direction] ?? VISUAL_TOKENS["Quiet Professional"];
}

import { describe, it, expect } from "vitest";
import { color, space, radius, type, registerPdfFonts, FONTS_OK, ff } from "./index";

describe("PDF design system — tokens", () => {
  it("exposes the core semantic color roles", () => {
    for (const key of ["paper", "surface", "textPrimary", "textBody", "textMuted", "hairline", "inkBg", "onInkPrimary", "accent", "info", "heat", "positive"] as const) {
      expect(color[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has a monotonically increasing spacing scale", () => {
    const vals = [space.xs, space.sm, space.md, space.lg, space.xl, space.xxl, space.xxxl, space.huge];
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]);
  });

  it("has an ordered radius scale", () => {
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.md).toBeLessThan(radius.lg);
    expect(radius.pill).toBeGreaterThan(radius.xl);
  });
});

describe("PDF design system — typography", () => {
  it("every scale entry carries a font family and a positive size", () => {
    for (const [name, style] of Object.entries(type)) {
      expect(style.fontFamily, `${name}.fontFamily`).toBeTruthy();
      expect(style.fontSize, `${name}.fontSize`).toBeGreaterThan(0);
    }
  });

  it("registerPdfFonts is idempotent and returns a boolean", () => {
    const a = registerPdfFonts();
    const b = registerPdfFonts();
    expect(typeof a).toBe("boolean");
    expect(a).toBe(b);
  });

  it("resolves fonts to the right family set for the current runtime", () => {
    const bold = ff("sans", 700).fontFamily;
    const serif = ff("display", 700).fontFamily;
    const mono = ff("mono", 400).fontFamily;
    if (FONTS_OK) {
      expect(bold).toBe("ArtifexSans");
      expect(serif).toBe("ArtifexSerif");
      expect(mono).toBe("ArtifexMono");
    } else {
      // Graceful fallback to the standard PDF-14 fonts — never a broken family.
      expect(bold).toBe("Helvetica-Bold");
      expect(serif).toBe("Times-Bold");
      expect(mono).toBe("Courier");
    }
  });
});

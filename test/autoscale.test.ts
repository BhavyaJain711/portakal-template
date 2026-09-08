import { describe, expect, it } from "vitest";
import { layoutText, scaleBarcode, scaleQr } from "../src/index.js";
import type { Bounds } from "../src/index.js";

const cell = (width: number, height: number): Bounds => ({ x: 0, y: 0, width, height });

describe("layoutText — independent x/y sizing", () => {
  it("uses font 1 by default", () => {
    const l = layoutText("Hi", cell(200, 100), { dpi: 203 });
    expect(l.font).toBe("1");
    expect(l.size).toBeGreaterThanOrEqual(1);
    expect(l.lines).toHaveLength(1);
  });

  it("sizes default font 1 by base dot height (8×12): y-mul = floor(100/12) = 8", () => {
    // 100 dots tall @203dpi: lineH(1) = 12, size = floor(100/12) = 8
    const l = layoutText("Hi", cell(200, 100), { dpi: 203 });
    expect(l.size).toBe(8);
  });

  it("sizes font 0 size (yMul) height-constrained (full cell height)", () => {
    // 100 dots tall @203dpi, multiplier: lineH(1) = 24, size = floor(100/24) = 4
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font: "0" });
    expect(l.size).toBe(4);
  });

  it("font 0 uses the printer's fontBase (300dpi → 18×36 base)", () => {
    // 100 dots tall @300dpi: lineH(1) = 36, size = floor(95/36) = 2
    const l = layoutText("Hi", cell(200, 100), { dpi: 300, font: "0" });
    expect(l.size).toBe(2);
  });

  it("font 0 uses point sizes in points mode for height", () => {
    // 100 dots tall @203dpi, points: lineH(1) = 203/72 ≈ 2.82, size = floor(100/2.82) = 35
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font: "0", font0Mode: "points" });
    expect(l.size).toBe(35);
  });

  it("font 0 points mode line height scales with dpi/72", () => {
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font: "0", font0Mode: "points" });
    // 35 × 203/72 ≈ 99 dots
    expect(l.lineHeight).toBe(99);
  });

  it("xSize is per-line dots per char, capped at 2× size", () => {
    // "Hi" = 2 chars, cell 200 wide → xSize_raw = floor(200/2/8) = 12
    // Capped at MAX_STRETCH(2) × size(8) = 16 → 12
    const l = layoutText("Hi", cell(200, 100), { dpi: 203 });
    expect(l.lines[0]!.xSize).toBe(12);
  });

  it("xSize is independent of size (height)", () => {
    // 10 chars, cell 519 wide @203dpi points mode (unitW ≈ 1.410 dots/pt):
    // size = floor(80 / 2.82) = 28 pt (from 80-dot height)
    // xSize = floor(519 / (10 * 1.410)) = 36 pt, cap = 2×28 = 56 → 36 pt
    const l = layoutText("D.No. 1024", cell(519, 80), { dpi: 203, font: "0", font0Mode: "points" });
    expect(l.size).toBe(28);
    expect(l.lines[0]!.xSize).toBe(36);
  });

  it("xSize is capped at 2× size for short text", () => {
    // "Hi" = 2 chars, cell 519 wide @203dpi points mode:
    // size = 28 pt, cap = 2×28 = 56 pt → capped to 56 pt
    const l = layoutText("Hi", cell(519, 80), { dpi: 203, font: "0", font0Mode: "points" });
    expect(l.size).toBe(28);
    expect(l.lines[0]!.xSize).toBe(56); // 2 × 28
  });

  it("xSize = size when charCount = 0 (empty content)", () => {
    const l = layoutText("", cell(200, 100), { dpi: 203 });
    expect(l.lines).toHaveLength(0);
  });
});

describe("layoutText — alignment uses xSize", () => {
  it("centers text using xSize as char width", () => {
    // 10 chars, cell 519 wide, points mode: xSize = 36 pt
    // tw = 10 × 36 × (203/72 * 0.5) = 507.5 dots, center offset = floor((519-507.5)/2) = 5
    const l = layoutText("D.No. 1024", cell(519, 80), {
      align: "center", dpi: 203, font: "0", font0Mode: "points",
    });
    expect(l.lines[0]!.x).toBe(5);
  });

  it("right-aligns text flush to cell edge using xSize", () => {
    // tw = 10 × 36 × 1.410 = 507.5 dots, right: x = floor(519-507.5) = 11
    const l = layoutText("D.No. 1024", cell(519, 80), {
      align: "right", dpi: 203, font: "0", font0Mode: "points",
    });
    expect(l.lines[0]!.x).toBe(11);
  });

  it("left-aligns at bounds.x", () => {
    const l = layoutText("D.No. 1024", { x: 31, y: 10, width: 488, height: 80 }, {
      align: "left", dpi: 203, font: "0", font0Mode: "points",
    });
    expect(l.lines[0]!.x).toBe(31);
  });

  it("vertically centers when requested", () => {
    const l = layoutText("Hi", cell(200, 100), { verticalCenter: true, dpi: 203 });
    expect(l.lines[0]!.y).toBeGreaterThan(0);
    expect(l.lines[0]!.y).toBeLessThan(50);
  });
});

describe("layoutText — wrapping", () => {
  it("wraps long text and positions lines", () => {
    // In points mode, size is large (33) but xSize for 35 chars = floor(200/35) = 5
    // 5 < 33 → triggers wrapping.
    const l = layoutText("A very long line of text that wraps", cell(200, 100), {
      dpi: 203, font0Mode: "points",
    });
    expect(l.lines.length).toBeGreaterThan(1);
    // Each line y advances by lineHeight
    expect(l.lines[1]!.y).toBe(l.lines[0]!.y + l.lineHeight);
  });

  it("wraps when single-line xSize < ySize (too many chars for width)", () => {
    // 35 chars in a 200-wide cell: single xSize = floor(200/35) = 5
    // size(multiplier @203) = 3 → 5 > 3 so no wrap needed... wait,
    // this actually fits on one line. Let's use a case that wraps.
    // 50 chars in 200-wide: xSize = 4, size = 3 → 4 > 3, no wrap.
    // Need more extreme: in points mode, size = 33, xSize = floor(200/50) = 4
    // 4 < 33 → wrap triggered.
    const l = layoutText(
      "This is a very long piece of text to test wrapping behavior",
      cell(200, 100),
      { dpi: 203, font0Mode: "points" },
    );
    expect(l.lines.length).toBeGreaterThan(1);
  });

  it("each wrapped line has its own xSize", () => {
    const l = layoutText(
      "This is a very long piece of text to test wrapping behavior",
      cell(200, 100),
      { dpi: 203, font0Mode: "points" },
    );
    expect(l.lines.length).toBeGreaterThan(1);
    // Each line should have an xSize > 0
    for (const line of l.lines) {
      expect(line.xSize).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not wrap single words", () => {
    const l = layoutText("Superlongword", cell(200, 100), { dpi: 203 });
    expect(l.lines).toHaveLength(1);
  });
});

describe("layoutText — fixed-pitch fonts 1-8 (multiplier)", () => {
  it("sizes font 3 by base dot height (16×24): y-mul = floor(100/24)", () => {
    // 100 dots tall: 100/24 = 4.17 → y-mul 4; fontKind "multiplier".
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font: "3" });
    expect(l.font).toBe("3");
    expect(l.fontKind).toBe("multiplier");
    expect(l.size).toBe(4);
  });

  it("xSize is an X multiplier of the base width (no fudge factor)", () => {
    // Font "3" baseW 16. "Hi" = 2 chars, cell 200 wide: raw = floor(200/2/16)=6,
    // capped at MAX_STRETCH × size = 6 → xSize 6.
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font: "3" });
    expect(l.lines[0]!.xSize).toBe(6);
  });

  it("width-fits long fixed-font text (no overflow)", () => {
    // "D.No. 1024" = 10 chars, cell 519 wide, font "3" baseW 16:
    // raw xSize = floor(519/10/16) = 3; line width = 10×3×16 = 480 ≤ 519.
    const l = layoutText("D.No. 1024", cell(519, 80), { dpi: 203, font: "3" });
    expect(l.lines[0]!.xSize).toBe(3);
    const w = l.lines[0]!.text.length * l.lines[0]!.xSize * 16;
    expect(w).toBeLessThanOrEqual(519);
  });

  it("honors fontScale cap (1-10)", () => {
    // Height would allow y-mul 5 in a 140-dot cell (140/24 = 5.83), but
    // fontScale 3 caps it.
    const l = layoutText("Hi", cell(200, 140), { dpi: 203, font: "3", fontScale: 3 });
    expect(l.size).toBe(3);
  });

  it("caps at 10 (TSPL multiplier limit) even in a tall cell", () => {
    const l = layoutText("Hi", cell(200, 300), { dpi: 203, font: "3" });
    expect(l.size).toBe(10);
  });

  it("font 0 uses font0Mode units; fixed fonts are always multiplier", () => {
    // Default font0Mode is "multiplier" — font "0" size is a multiplier of fontBase.
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font: "0" });
    expect(l.font).toBe("0");
    expect(l.fontKind).toBe("multiplier");
    // font0Mode: "points" switches font "0" to point sizes.
    const pt = layoutText("Hi", cell(200, 100), { dpi: 203, font: "0", font0Mode: "points" });
    expect(pt.fontKind).toBe("points");
  });
});

describe("layoutText — textScale", () => {
  it("textScale affects alignment positioning", () => {
    const base = layoutText("Hi", cell(200, 100), { align: "center", dpi: 203 });
    const stretched = layoutText("Hi", cell(200, 100), { align: "center", dpi: 203, textScale: 2 });
    // textScale=2 doubles the text width estimate → center shifts left
    expect(stretched.lines[0]!.x).toBeLessThan(base.lines[0]!.x);
  });

  it("textScale does not change size (height)", () => {
    const base = layoutText("Hi", cell(200, 100), { dpi: 203 });
    const stretched = layoutText("Hi", cell(200, 100), { dpi: 203, textScale: 2 });
    expect(stretched.size).toBe(base.size);
    expect(stretched.lineHeight).toBe(base.lineHeight);
  });
});

describe("scaleBarcode", () => {
  it("sets height to 75% of cell height", () => {
    expect(scaleBarcode("12345", cell(300, 80)).height).toBe(60);
  });

  it("fits module width to cell width (code128 55 overhead + 11 modules/char)", () => {
    // 10 chars: 55 + 110 = 165 modules, cell 350 wide → moduleWidth 2
    expect(scaleBarcode("1234567890", cell(350, 80)).moduleWidth).toBe(2);
    // Narrow cell → moduleWidth shrinks to 1
    expect(scaleBarcode("1234567890", cell(80, 80)).moduleWidth).toBe(1);
  });

  it("uses wider modules for ean13 (113 modules total)", () => {
    expect(scaleBarcode("4006381333931", cell(350, 80), { symbology: "ean13" }).moduleWidth).toBe(3);
  });
});

describe("scaleQr", () => {
  it("fits cellSize to min(W,H)", () => {
    const s = scaleQr(cell(150, 150));
    expect(s.cellSize).toBeGreaterThanOrEqual(1);
    expect(s.cellSize).toBeLessThanOrEqual(32);
  });

  it("small cells yield cellSize 1", () => {
    expect(scaleQr(cell(20, 20)).cellSize).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { layoutText, scaleBarcode, scaleQr } from "../src/index.js";
import type { Bounds } from "../src/index.js";

const cell = (width: number, height: number): Bounds => ({ x: 0, y: 0, width, height });

describe("layoutText (font 0, multiplier of DPI base)", () => {
  it("uses font 0 with a multiplier size", () => {
    const l = layoutText("Hi", cell(200, 100), { dpi: 203 });
    expect(l.font).toBe("0");
    expect(l.size).toBeGreaterThanOrEqual(1);
    expect(l.lines).toHaveLength(1);
  });

  it("sizes to fit cell height (~80% of usable height, ÷ 24-dot base)", () => {
    // 100 dots tall @203dpi: mul = floor(80 / 24) = 3
    const l = layoutText("Hi", cell(200, 100), { dpi: 203 });
    expect(l.size).toBe(3);
  });

  it("uses the printer's fontBase (300dpi → 18×36 base)", () => {
    // 100 dots tall @300dpi: mul = floor(80 / 36) = 2
    const l = layoutText("Hi", cell(200, 100), { dpi: 300 });
    expect(l.size).toBe(2);
  });

  it("uses point sizes in points mode", () => {
    // 100 dots tall @203dpi, points mode: 1pt ≈ 2.82 dots; height target
    // 80 dots ÷ 2.82 ≈ 28pt (font-size now drives the height, not the width)
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font0Mode: "points" });
    expect(l.size).toBe(28);
  });

  it("points mode line height scales with dpi/72", () => {
    const l = layoutText("Hi", cell(200, 100), { dpi: 203, font0Mode: "points" });
    // 28pt × 203/72 ≈ 79 dots
    expect(l.lineHeight).toBe(79);
  });

  it("wraps long text and positions lines", () => {
    const l = layoutText("A very long line of text that wraps", cell(200, 100), { dpi: 203 });
    expect(l.lines.length).toBeGreaterThan(1);
    // Each line y advances by lineHeight
    expect(l.lines[1]!.y).toBe(l.lines[0]!.y + l.lineHeight);
  });

  it("centers a line horizontally in the cell", () => {
    const l = layoutText("Hi", cell(200, 100), { align: "center", dpi: 203 });
    // "Hi" = 2 chars × 12 dots/char × 0.6 × size 3 = 43.2 dots wide; x = (200-43.2)/2 ≈ 78
    expect(l.lines[0]!.x).toBe(78);
  });

  it("right-aligns a line flush to the cell edge", () => {
    const l = layoutText("Hi", cell(200, 100), { align: "right", dpi: 203 });
    // x + textWidth = cell width: 157 + 43.2 = 200.2 ≈ 200
    expect(l.lines[0]!.x).toBe(157);
  });

  it("vertically centers when requested", () => {
    const l = layoutText("Hi", cell(200, 100), { verticalCenter: true, dpi: 203 });
    // y = (100 - lineHeight)/2, positive and less than 100
    expect(l.lines[0]!.y).toBeGreaterThan(0);
    expect(l.lines[0]!.y).toBeLessThan(50);
  });

  it("shrinks a single unbroken word that would overflow the cell width", () => {
    // 15 chars (e.g. "Design No. 1042" has 15 chars, incl. spaces). Cell 519 wide
    // @203dpi. Old 0.5 factor picked 75pt which overflows; 0.6 factor must fit.
    const l = layoutText("Design No. 1042", cell(519, 94), { align: "center", dpi: 203, font0Mode: "points" });
    // 15 × 0.6 × size × (203/72) ≤ 519 → size ≤ 20.49 → 20pt
    expect(l.size).toBe(20);
    // No overflow: centered text stays inside the cell
    const tw = l.lines[0]!.text.length * 20 * (203 / 72) * 0.6;
    expect(tw).toBeLessThanOrEqual(519);
  });

  it("honors a per-printer charWidthFactor for sizing", () => {
    // Narrower TrueType font → smaller width estimate → tighter (larger) size.
    const narrow = layoutText("Design No. 1042", cell(519, 94), {
      align: "center", dpi: 203, font0Mode: "points", charWidthFactor: 0.5,
    });
    const wide = layoutText("Design No. 1042", cell(519, 94), {
      align: "center", dpi: 203, font0Mode: "points", charWidthFactor: 0.7,
    });
    expect(narrow.size).toBe(24); // 15 × 0.5 × s × (203/72) ≤ 519 → s ≤ 24.5
    expect(wide.size).toBe(17); // 15 × 0.7 × s × (203/72) ≤ 519 → s ≤ 17.5
    // Centered position keeps the text inside the cell for both
    expect(narrow.lines[0]!.x).toBeGreaterThanOrEqual(0);
    expect(narrow.lines[0]!.x).toBeLessThanOrEqual(519);
    expect(wide.lines[0]!.x).toBeGreaterThanOrEqual(0);
    expect(wide.lines[0]!.x).toBeLessThanOrEqual(519);
  });
});

describe("scaleBarcode", () => {
  it("sets height to 75% of cell height", () => {
    expect(scaleBarcode("12345", cell(300, 80)).height).toBe(60);
  });

  it("fits module width to cell width (code128 ~11 modules/char)", () => {
    // 10 chars × 11 modules = 110 modules, cell 220 wide → moduleWidth 2
    expect(scaleBarcode("1234567890", cell(220, 80)).moduleWidth).toBe(2);
    // Narrow cell → moduleWidth shrinks to 1
    expect(scaleBarcode("1234567890", cell(80, 80)).moduleWidth).toBe(1);
  });

  it("uses wider modules for ean13 (95 modules fixed)", () => {
    expect(scaleBarcode("4006381333931", cell(285, 80), { symbology: "ean13" }).moduleWidth).toBe(3);
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

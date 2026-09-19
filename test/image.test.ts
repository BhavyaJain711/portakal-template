import { describe, expect, it } from "vitest";
import { toMonochromeBitmap } from "portakal-lite";
import { bitmapToDescriptor, compileTemplate, parseBitmap, TemplateError } from "../src/index.js";
import type { TemplateSchema } from "../src/index.js";

/** Decode Uint8Array to string for text-command assertions. */
const decode = (buf: Uint8Array): string => new TextDecoder().decode(buf);

describe("image descriptor", () => {
  it("round-trips a bitmap through the descriptor", () => {
    const bitmap = toMonochromeBitmap(Uint8Array.from([0, 255, 0, 255, 0, 255, 0, 255]), 8, 1);
    const parsed = parseBitmap(bitmapToDescriptor(bitmap));

    expect(parsed).toEqual(bitmap);
  });

  it("rejects malformed descriptors", () => {
    expect(() => parseBitmap("8,2,1,2,3")).toThrow(TemplateError);
    expect(() => parseBitmap("nope")).toThrow(TemplateError);
  });
});

describe("compileTemplate image element", () => {
  it("emits a BITMAP with the pixel payload", () => {
    const bitmap = toMonochromeBitmap(Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 255]), 8, 1);
    const schema: TemplateSchema = {
      id: "img",
      name: "Img",
      rows: [
        {
          heightPercent: 100,
          cells: [{ widthPercent: 100, element: { type: "image", src: bitmapToDescriptor(bitmap) } }],
        },
      ],
    };

    const result = compileTemplate(schema, {}, { spec: { width: 40, height: 20, unit: "mm", dpi: 203 } });

    // 0b11110000 = 240 = 0xF0 — the raw byte must be present in the binary output.
    const tscStr = decode(result.tsc);
    expect(tscStr).toMatch(/BITMAP \d+,\d+,1,1,0,/);  // header is text
    // Verify the actual raw byte 0x0F (~0xF0 in TSPL inverse polarity) follows the header
    const headerBytes = new TextEncoder().encode("0,");  // end of the BITMAP header
    let found = false;
    for (let i = 0; i < result.tsc.length - 2; i++) {
      if (result.tsc[i] === headerBytes[0] && result.tsc[i + 1] === headerBytes[1]) {
        // Check if 0x0F byte follows
        if (result.tsc[i + 2] === 0x0F) { found = true; break; }
      }
    }
    expect(found).toBe(true);
    expect(result.zpl).toMatch(/\^GFA,1,1,1,F0\^FS/);
  });

  it("centers the bitmap within its cell", () => {
    const bitmap = toMonochromeBitmap(Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 255]), 8, 1);
    const schema: TemplateSchema = {
      id: "img",
      name: "Img",
      rows: [
        {
          heightPercent: 100,
          cells: [{ widthPercent: 100, element: { type: "image", src: bitmapToDescriptor(bitmap) } }],
        },
      ],
    };

    const result = compileTemplate(schema, {}, { spec: { width: 40, height: 20, unit: "mm", dpi: 203 } });
    const bounds = result.layout.cells[0]!;
    const expectedX = bounds.x + Math.floor((bounds.width - bitmap.width) / 2);
    const expectedY = bounds.y + Math.floor((bounds.height - bitmap.height) / 2);

    const tscStr = decode(result.tsc);
    expect(tscStr).toContain(`BITMAP ${expectedX},${expectedY},1,1,0,`);
  });
});

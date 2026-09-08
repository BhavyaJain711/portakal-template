/**
 * portakal-template — percentage-layout label templates on top of portakal-lite.
 * Declarative JSON template + data → TSC/TSPL2 + ZPL II printer-ready strings,
 * with auto-scaling layout. Device-agnostic: label size/DPI are supplied at
 * compile time via PrintSpec, so one template adapts to any printer.
 */

export { TemplateError, interpolate, resolvePath, resolveTemplate, itemContext, ITEM_THIS } from "./templating.js";
export type { ItemContext } from "./templating.js";
export { layoutTemplate, toDots, validatePercentages } from "./layout.js";
export type { Bounds, Layout } from "./layout.js";
export { compileTemplate, buildLabel } from "./compile.js";
export type { CompiledTemplate, CompileOptions } from "./compile.js";
export { scaleBarcode, scaleQr, layoutText } from "./autoscale.js";
export type { ScaledBarcode, ScaledQr, TextLine, TextLayout } from "./autoscale.js";
export { TSC_DOT_FONTS, type TSCTextFont } from "portakal-lite";
export { validateTemplate, extractPlaceholders } from "./validate.js";
export type { ValidationIssue, ValidationResult, AllowedVariable } from "./validate.js";
export type {
  PrintSpec,
  TemplateSchema,
  TemplateRow,
  TemplateCell,
  TemplateElement,
  TemplateData,
  ResolvedTemplate,
  ResolvedRow,
  ResolvedCell,
  ResolvedTemplateElement,
} from "./types.js";

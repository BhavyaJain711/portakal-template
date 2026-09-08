import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // portakal-lite is a real dependency (not bundled) — consumers install it.
  external: ["portakal-lite"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});

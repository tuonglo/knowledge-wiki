import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // @kw/shared ships TypeScript source, so it must be bundled, not required at runtime.
  noExternal: ["@kw/shared"],
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    // Test files share one database and reset it between tests, so run files
    // one at a time to stop them wiping each other's data mid-test.
    fileParallelism: false,
  },
});

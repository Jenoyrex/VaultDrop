import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  // Matches this project's actual JSX runtime (the same automatic runtime
  // Next.js/React 18 already use everywhere — no component in this repo
  // imports React explicitly). Without this, Vitest's esbuild transform
  // defaults to the classic runtime and any .tsx test fails at runtime
  // with "React is not defined".
  esbuild: {
    jsx: "automatic"
  },
  test: {
    // Default stays "node" for the existing crypto/api-client/logic
    // tests, which never touch the DOM. Component tests that need one
    // (e.g. CreateVaultDialog.test.tsx) opt in per-file via a
    // `// @vitest-environment jsdom` comment at the top of the file,
    // rather than switching every test in this project to jsdom.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
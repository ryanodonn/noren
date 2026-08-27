import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Module boundaries (see CLAUDE.md / docs/services.md): a module's
    // internals (db.ts, queries.ts, ...) are private. Only its index.ts —
    // or its client.ts, for the client-safe subset a module exposes to
    // client components without pulling in server-only code — is a valid
    // cross-module import.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/*", "!@/modules/*/index", "!@/modules/*/client"],
              message:
                "Import another module only through its index.ts (or client.ts) public interface, not its internals.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

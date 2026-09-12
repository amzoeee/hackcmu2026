import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-local/**",
    ".next-devnet/**",
    "next-env.d.ts",
    ".tools/**",
    ".anchor/**",
    "target/**",
    "src/lib/anchor/generated/**",
  ]),
]);

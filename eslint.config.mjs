import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  js.configs.recommended,

  // TypeScript (includes the TS parser automatically)
  ...tseslint.configs.recommended,

  // Next.js rules
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,

      // Stop whining about explicit any
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Browser globals for client files
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Ignore build output
  {
    ignores: [".next/**", "node_modules/**"],
  },
];

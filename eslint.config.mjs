// Local compliance check — the same rules Obsidian's review uses.
// Not shipped: devDependencies only. Run with `npx eslint src` (or `npm run lint`).
//
// Deliberate downgrades for a large, Obsidian-API-heavy plugin (documented so a
// reader knows they are choices, not oversights):
//  · no-unsafe-* / no-explicit-any — the Obsidian API and the mock harness are
//    `any`-bound at the edges; the code narrows real behaviour, not the boundary.
//  · no-static-styles-assignment — we set computed geometry/colour (grid x/y/w/h,
//    chart widths, brand tints) that cannot live in a static class.
//  · sentence-case — the product names are "Trade Log", "Eval", "R-Multiples".
//  · prefer-create-el / prefer-window-timers — equivalent APIs, cosmetic.
//  · no-alert — confirm()/prompt() are used behind deliberate user actions.
//  · no-manual-html-headings — the Settings header is a custom, tokenised one.
//  · no-unsupported-api — kept as an error so a minAppVersion bump is never silent.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "docs/**", "tools/**", "tests/**", "previews/**", "eslint.config.mjs"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.*"] } },
    },
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "obsidianmd/no-static-styles-assignment": "off",
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-window-timers": "off",
      "obsidianmd/settings-tab/no-manual-html-headings": "off",
      "obsidianmd/no-tfile-tfolder-cast": "warn",
      "obsidianmd/prefer-file-manager-trash-file": "off",
      "obsidianmd/commands/no-plugin-name-in-command-name": "warn",
      "no-alert": "off",
    },
  },
]);

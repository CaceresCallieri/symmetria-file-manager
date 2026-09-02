import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "off",
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/.next/**",
    "**/.astro/**",
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
    // The Qt tree. Its `.js` files are QML-flavoured JavaScript — `.pragma
    // library`, QML type annotations — which oxlint cannot parse, so it reports
    // `Unexpected token` on three of them. They also already have an incumbent
    // gate: `tools/quality/check-qml.sh`, delta-based against the baseline in
    // `.claude/project-standards.md`. Two tools in one slot is worse than
    // either alone. Remove this line when the Qt tree is deleted at parity.
    "qml/**",
    "plugin/third_party/**",
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/no-conditional-empty-object-spread": "warn",
    "anti-slop/no-module-mocking": "warn",
    "anti-slop/no-runtime-typeof": ["warn", { allowInTypeGuards: true }],
    "anti-slop/no-shape-in-symbol-names": "warn",
    "anti-slop/no-unknown-parameters": "warn",
    "anti-slop/no-unsafe-dictionary-type": "warn",
    "anti-slop/require-safety-comment-for-type-assertion": "warn",
  },
});

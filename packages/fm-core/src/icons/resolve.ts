/**
 * Which symbol stands for a file, from its name alone.
 *
 * ── The art is borrowed; this cascade is not, and that is a deviation ───────
 * The plan expected to wrap `createFileTreeIconResolver` from `@pierre/trees`
 * rather than write this. That function turned out to handle only CUSTOM
 * remaps: the built-in name-to-token mapping lives in `resolveBuiltInFileIconToken`,
 * which the package's `exports` field does not publish, so reaching it would
 * mean importing a deep path the package forbids. The SPRITE — 58 symbols,
 * every drawing — still comes from the package. Only the naming does not.
 *
 * The token vocabulary below is the package's published `BuiltInFileIconToken`
 * union, so a name resolved here always addresses a symbol that exists.
 *
 * ── It never fails ─────────────────────────────────────────────────────────
 * An unknown extension resolves to `default`. A file manager that showed
 * nothing for an unrecognised file would show nothing for most of a source
 * tree.
 */

/** A symbol in the borrowed sprite. The package's own vocabulary. */
export type IconToken =
  | "astro"
  | "bash"
  | "biome"
  | "bun"
  | "c"
  | "claude"
  | "cpp"
  | "css"
  | "database"
  | "default"
  | "docker"
  | "eslint"
  | "font"
  | "git"
  | "go"
  | "graphql"
  | "html"
  | "image"
  | "javascript"
  | "json"
  | "markdown"
  | "npm"
  | "prettier"
  | "python"
  | "react"
  | "ruby"
  | "rust"
  | "sass"
  | "svelte"
  | "svg"
  | "swift"
  | "table"
  | "tailwind"
  | "terraform"
  | "text"
  | "typescript"
  | "vite"
  | "vue"
  | "wasm"
  | "yml"
  | "zig"
  | "zip";

/**
 * Whole names that carry a meaning no extension does.
 *
 * Matched first, and on the full lowercased name. `package.json` is npm's, not
 * JSON's, and a reader scanning a directory is helped more by the former.
 */
const BY_NAME: ReadonlyMap<string, IconToken> = new Map([
  ["package.json", "npm"],
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "npm"],
  ["pnpm-workspace.yaml", "npm"],
  ["dockerfile", "docker"],
  ["docker-compose.yml", "docker"],
  ["docker-compose.yaml", "docker"],
  ["makefile", "text"],
  ["cmakelists.txt", "text"],
  ["pkgbuild", "bash"],
  ["readme.md", "markdown"],
  ["license", "text"],
  [".gitignore", "git"],
  [".gitattributes", "git"],
  [".gitmodules", "git"],
  ["biome.json", "biome"],
  ["biome.jsonc", "biome"],
  [".prettierrc", "prettier"],
  ["vite.config.ts", "vite"],
  ["vite.config.js", "vite"],
  ["tailwind.config.ts", "tailwind"],
  ["bun.lockb", "bun"],
  ["claude.md", "claude"],
  ["agents.md", "claude"],
]);

/**
 * Extensions, matched LONGEST SUFFIX FIRST.
 *
 * `component.spec.ts` is a test before it is TypeScript, and `.env.local` is an
 * environment file before it is a `local`. Matching the shortest suffix first
 * would resolve both to the wrong thing — which is why the candidate list is
 * built longest-first and this table may hold multi-part keys.
 */
const BY_EXTENSION: ReadonlyMap<string, IconToken> = new Map([
  ["spec.ts", "typescript"],
  ["test.ts", "typescript"],
  ["spec.tsx", "react"],
  ["d.ts", "typescript"],
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "react"],
  ["jsx", "react"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["mdx", "markdown"],
  ["py", "python"],
  ["rs", "rust"],
  ["go", "go"],
  ["c", "c"],
  ["h", "c"],
  ["cpp", "cpp"],
  ["cc", "cpp"],
  ["hpp", "cpp"],
  ["rb", "ruby"],
  ["swift", "swift"],
  ["zig", "zig"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["zsh", "bash"],
  ["fish", "bash"],
  ["html", "html"],
  ["xhtml", "html"],
  ["css", "css"],
  ["scss", "sass"],
  ["sass", "sass"],
  ["svg", "svg"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["astro", "astro"],
  ["yml", "yml"],
  ["yaml", "yml"],
  ["toml", "text"],
  ["ini", "text"],
  ["conf", "text"],
  ["txt", "text"],
  ["log", "text"],
  ["sql", "database"],
  ["db", "database"],
  ["sqlite", "database"],
  ["csv", "table"],
  ["tsv", "table"],
  ["xlsx", "table"],
  ["graphql", "graphql"],
  ["gql", "graphql"],
  ["tf", "terraform"],
  ["wasm", "wasm"],
  ["png", "image"],
  ["jpg", "image"],
  ["jpeg", "image"],
  ["gif", "image"],
  ["webp", "image"],
  ["avif", "image"],
  ["bmp", "image"],
  ["ico", "image"],
  ["ttf", "font"],
  ["otf", "font"],
  ["woff", "font"],
  ["woff2", "font"],
  ["zip", "zip"],
  ["tar", "zip"],
  ["gz", "zip"],
  ["xz", "zip"],
  ["zst", "zip"],
  ["7z", "zip"],
  ["rar", "zip"],
]);

/**
 * Every dot-suffix of a name, longest first.
 *
 * `component.spec.ts` gives `["spec.ts", "ts"]`. A leading dot is not a
 * separator — `.env.local` gives `["env.local", "local"]`, not `["", …]` —
 * because a dotfile's first dot marks it hidden rather than starting an
 * extension.
 */
export function extensionCandidates(name: string): string[] {
  const parts = name.toLowerCase().split(".");
  const candidates: string[] = [];

  // From index 1: index 0 is the stem, and for a dotfile it is the empty
  // string before the leading dot.
  for (let i = 1; i < parts.length; i++) candidates.push(parts.slice(i).join("."));
  return candidates;
}

/**
 * The symbol for a filename.
 *
 * Whole names first, then extensions longest-suffix-first, then `default`.
 */
export function iconTokenFor(name: string): IconToken {
  const lower = name.toLowerCase();

  const byName = BY_NAME.get(lower);
  if (byName !== undefined) return byName;

  for (const candidate of extensionCandidates(lower)) {
    const byExtension = BY_EXTENSION.get(candidate);
    if (byExtension !== undefined) return byExtension;
  }

  return "default";
}

/**
 * The symbols the borrowed set does not carry.
 *
 * Folder, video, audio, document, symbolic link and executable have no drawing
 * in it — they are chrome, not file types, and they come from the general icon
 * library instead. Named here so the renderer's mapping is data rather than a
 * chain of conditionals.
 */
export type ChromeIcon = "folder" | "video" | "audio" | "document" | "symlink" | "binary";

/** What an entry needs drawn, when a file-type symbol is not the answer. */
export function chromeIconFor(
  kind: "file" | "directory" | "other",
  mime: string | null,
): ChromeIcon | null {
  if (kind === "directory") return "folder";
  if (kind === "other") return "binary";
  if (mime === null) return null;

  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "document";
  return null;
}

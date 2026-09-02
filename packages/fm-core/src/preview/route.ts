import type { EntrySummary } from "../entry.ts";
import { classify, inheritsFrom, isImageMime, type MimeTables } from "../mime.ts";

/**
 * One decision tree for what to show, shared by every consumer.
 *
 * The Qt original had exactly one router used by both the Miller pane and the
 * finder's info pane, and the rule that kept it honest was: a preview type
 * added here appears in both, and NO consumer re-implements the routing. The
 * same rule holds here.
 *
 * ── The branch order is a contract ──────────────────────────────────────────
 * none → directory → remote directory → image → video → audio → archive →
 * spreadsheet → markup → code → text → fallback.
 *
 * Image before text is the one that bites. `image/svg+xml` inherits from
 * `application/xml`, which inherits from `text/plain`, so an SVG *is* text
 * under the inheritance rules — test text first and every SVG previews as
 * source. `route.test.ts` pins that with an SVG.
 */

/** What the router is handed. Everything it needs, and nothing it must fetch. */
export interface PreviewTarget {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  /** How many entries a directory holds. Meaningless for a file. */
  readonly entryCount: number;
  /** The first entries, capped by whoever read them. Empty for a file. */
  readonly entries: readonly EntrySummary[];
  readonly size: number;
  readonly mime: string | null;
  /** The first bytes, for the sniff that catches an unregistered text file. */
  readonly head: Uint8Array;
}

/** A branch the shape keeps but this cycle does not build. */
export type UnbuiltKind = "video" | "audio" | "archive" | "spreadsheet";

export type PreviewRoute =
  /** Nothing under the cursor. */
  | { readonly kind: "none" }
  /**
   * `entries` is what the column draws; `entryCount` is the whole truth.
   *
   * They differ when the listing was capped, and that difference is the only
   * thing that lets the pane say how many it is not showing.
   */
  | {
      readonly kind: "directory";
      readonly entryCount: number;
      readonly entries: readonly EntrySummary[];
    }
  | { readonly kind: "image"; readonly mime: string }
  | { readonly kind: "document"; readonly mime: string }
  | { readonly kind: "code"; readonly language: string }
  | { readonly kind: "text" }
  /** The branch exists and says so, rather than falling through to garbage. */
  | { readonly kind: "unbuilt"; readonly what: UnbuiltKind; readonly mime: string }
  /** A binary with no branch of its own: name, size, type. */
  | { readonly kind: "fallback"; readonly mime: string | null };

/**
 * Extension to `highlight.js` language, explicitly.
 *
 * **Never call automatic language detection.** It was measured at 35 times the
 * explicit cost and it misidentified JavaScript as a DNS zone file. An
 * extension that is not here renders as plain text, which is a correct answer;
 * a guess that is wrong is not.
 */
const LANGUAGES: ReadonlyMap<string, string> = new Map([
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["py", "python"],
  ["rs", "rust"],
  ["go", "go"],
  ["c", "c"],
  ["h", "c"],
  ["cpp", "cpp"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["hpp", "cpp"],
  ["hxx", "cpp"],
  ["java", "java"],
  ["kt", "kotlin"],
  ["rb", "ruby"],
  ["php", "php"],
  ["cs", "csharp"],
  ["swift", "swift"],
  ["lua", "lua"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["zsh", "bash"],
  ["fish", "bash"],
  ["ps1", "powershell"],
  ["sql", "sql"],
  ["html", "xml"],
  ["xhtml", "xml"],
  ["xml", "xml"],
  ["svg", "xml"],
  ["css", "css"],
  ["scss", "scss"],
  ["less", "less"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "ini"],
  ["ini", "ini"],
  ["conf", "ini"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["qml", "qml"],
  ["cmake", "cmake"],
  ["dockerfile", "dockerfile"],
  ["diff", "diff"],
  ["patch", "diff"],
  ["vim", "vim"],
  ["nix", "nix"],
]);

/**
 * Files that carry a language but no extension.
 *
 * Matched on the whole name, lowercased. A `Makefile` is not `*.mk`.
 */
const BY_NAME: ReadonlyMap<string, string> = new Map([
  ["makefile", "makefile"],
  ["dockerfile", "dockerfile"],
  ["cmakelists.txt", "cmake"],
  ["pkgbuild", "bash"],
  [".bashrc", "bash"],
  [".zshrc", "bash"],
  [".gitconfig", "ini"],
  [".editorconfig", "ini"],
]);

/** The `highlight.js` language for a filename, or `null` for none. */
export function languageFor(name: string): string | null {
  const lower = name.toLowerCase();

  const byName = BY_NAME.get(lower);
  if (byName !== undefined) return byName;

  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return null;

  return LANGUAGES.get(lower.slice(dot + 1)) ?? null;
}

/** Types Chromium's own viewer renders better than anything we would write. */
function isDocument(tables: MimeTables, mime: string): boolean {
  return mime === "application/pdf" || inheritsFrom(tables, mime, "application/pdf");
}

function unbuiltKind(tables: MimeTables, mime: string): UnbuiltKind | null {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (isSpreadsheet(mime)) return "spreadsheet";
  if (isArchive(tables, mime)) return "archive";
  return null;
}

const SPREADSHEETS: readonly string[] = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
];

function isSpreadsheet(mime: string): boolean {
  return SPREADSHEETS.includes(mime);
}

const ARCHIVE_ROOTS: readonly string[] = [
  "application/zip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/gzip",
  "application/x-xz",
  "application/zstd",
  "application/x-bzip2",
];

function isArchive(tables: MimeTables, mime: string): boolean {
  return ARCHIVE_ROOTS.some((root) => mime === root || inheritsFrom(tables, mime, root));
}

/**
 * Decide what to show for one entry.
 *
 * Pure, so the whole decision tree is testable without a window and without a
 * filesystem: every branch is reachable from a constructed target.
 */
export function routePreview(tables: MimeTables, target: PreviewTarget | null): PreviewRoute {
  if (target === null) return { kind: "none" };
  if (target.isDirectory) {
    return { kind: "directory", entryCount: target.entryCount, entries: target.entries };
  }

  const mime = target.mime;

  // Before text, always. See the branch-order note above.
  if (mime !== null && isImageMime(tables, mime)) return { kind: "image", mime };
  if (mime !== null && isDocument(tables, mime)) return { kind: "document", mime };

  if (mime !== null) {
    const unbuilt = unbuiltKind(tables, mime);
    if (unbuilt !== null) return { kind: "unbuilt", what: unbuilt, mime };
  }

  // `classify` carries the content sniff, which is what makes an extensionless
  // config file preview as text instead of as bytes.
  if (classify(tables, mime, target.head) !== "text") return { kind: "fallback", mime };

  const language = languageFor(target.name);
  return language === null ? { kind: "text" } : { kind: "code", language };
}

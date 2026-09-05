import { getBuiltInSpriteSheet } from "@pierre/trees";
import { chromeIconFor, iconTokenFor } from "@symmetria/fm-core/icons/resolve";
import { Binary, FileAudio, FileText, FileVideo, Folder } from "lucide-react";
import { useEffect } from "react";

/**
 * One symbol for one entry.
 *
 * The file-type art is the borrowed sprite from `@pierre/trees` — 58 symbols,
 * installed as a published package and never copied. The gaps it leaves —
 * folder, video, audio, document, executable — come from `lucide-react`, which
 * is the same pairing Mesura Code uses.
 *
 * **Icons paint `currentColor`.** They inherit whatever the row's text is, so a
 * cursor row's icon brightens with its text and a marked row's takes the mark's
 * colour, with no per-icon colour to keep in step.
 *
 * ── Why this file sits in the FINDER's package ─────────────────────────────
 * It is not about searching, and it did live in the panel package. It moved
 * when the finder's rows needed icons: the finder must not import the panel —
 * a host mounts it without one, and an invariant test refuses the import — so
 * one of the two had to move, and copying the sprite wiring into both was
 * never an option.
 *
 * The NAMING is not here and never was. `@symmetria/fm-core/icons/resolve`
 * owns which extension draws which symbol, is pure, and is the one file to edit
 * to change an icon. This file only draws what that file names.
 *
 * `useOverlayList` is here for the same reason and is the second tenant that
 * is not about searching. A third is the signal to give these primitives their
 * own small package rather than widening this one further.
 */

/** Which set to draw from. `complete` is all 58 symbols. */
const ICON_SET = "complete";

/** The sprite's own id convention: `file-tree-builtin-<token>`. */
function spriteId(token: string): string {
  return `file-tree-builtin-${token}`;
}

/**
 * Put the sprite in the document, once.
 *
 * A `<use>` reference needs its `<symbol>` definitions present somewhere in the
 * document. Injecting per icon would put 37 kilobytes into the page for every
 * row; injecting once puts it there for all of them.
 */
function useSpriteSheet(): void {
  useEffect(() => {
    const id = "symmetria-fm-icon-sprite";
    if (document.getElementById(id) !== null) return;

    const host = document.createElement("div");
    host.id = id;
    host.hidden = true;
    host.innerHTML = getBuiltInSpriteSheet(ICON_SET);
    document.body.appendChild(host);
  }, []);
}

const CHROME = {
  folder: Folder,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  symlink: FileText,
  binary: Binary,
} as const;

export interface FileIconProps {
  readonly name: string;
  readonly kind: "file" | "directory" | "other";
  /** Known only once the entry has been described. Absent is normal. */
  readonly mime?: string | null;
}

export function FileIcon({ name, kind, mime = null }: FileIconProps) {
  useSpriteSheet();

  // The NAME is passed, so a caller with no MIME type still gets the right
  // chrome symbol. The finder's rows never have one — a search index carries no
  // type — and a listing row has none until it has been described.
  const chrome = chromeIconFor(kind, mime, name);
  if (chrome !== null) {
    // `Glyph`, not `Symbol`: the latter shadows the global of that name.
    const Glyph = CHROME[chrome];
    return <Glyph className="file-icon" size={14} aria-hidden="true" data-icon={chrome} />;
  }

  const token = iconTokenFor(name);
  return (
    <svg className="file-icon" width={14} height={14} aria-hidden="true" data-icon={token}>
      <use href={`#${spriteId(token)}`} />
    </svg>
  );
}

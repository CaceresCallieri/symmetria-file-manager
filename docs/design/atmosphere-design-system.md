# Atmosphere — the design system for the Electron renderer

Status: **chosen by the operator on 2026-10-11 and implemented in the
standalone application.** The Mesura Code layer's "Atmosphere, no glass"
variant is chosen but not implemented (see *Host profiles*).

Where it lives:

- `app/src/renderer/atmosphere.css` — every value and rule of the standalone's
  look. It is the source of truth for values; this document keeps the rationale.
- `packages/fm-ui/src/components/AtmosphereChrome.tsx` — the header and the rail.
- `App`'s `chrome="atmosphere"` prop — the switch. Only `app/src/renderer/main.tsx`
  passes it.
- `docs/design/prototypes/atmosphere/` — the HTML reference the design was
  judged on. Its token names (`--glass-*`, `--edge`, …) differ from the app's
  (`--atmo-*`).

## How the direction was chosen

Three directions were prototyped against the same mock file system and keymap
(`docs/design/prototypes/index.html` compares them with the current build):

- **Studio** — Mesura Code's vocabulary: hairline-split opaque surface, sidebar,
  inspector preview, light theme. Kept in the prototypes as the alternative.
- **Instrument** — warm graphite, amber, IBM Plex, relative line numbers.
  **Rejected and deleted.**
- **Atmosphere** — frosted glass, icon rail, hero preview, floating status bar.
  **Chosen**, after one revision.

The first Atmosphere carried rose and peach accents taken from the wallpaper.
The operator rejected that tint and asked for **black and white, very neutral,
with blue or a utility colour allowed**. Every rule below follows from that
instruction. Do not reintroduce a decorative hue.

## Principles

1. **Neutral ladder.** Every neutral is achromatic (`r = g = b`).
2. **Colour means something, or it is absent.**
   - Blue `oklch(66% 0.16 258)` (Mesura Code's accent) = selection (marked
     rows, Select mode), focus (focused overview card, focused field), search,
     progress.
   - Green `#73cf98` = yanked, success. Red `#ff5f66` = cut, destructive.
     Amber `#e9bd5b` = git modified. Blue also = git untracked.
   - Nothing else carries a hue. Content keeps its own colours: images, video,
     and code highlighted with the Wine palette (`syntax-wine.css`, which mirrors
     the operator's NeoVim theme).
3. **Monochrome icons; hierarchy by lightness.** Folders are full foreground,
   files are 55% foreground, the parent column is dimmer than the current one.
   The per-type `--icon-*` tints in today's `tokens.css` are retired. Pinned
   folders in the rail are letter monograms, not coloured dots.
4. **Glass over the desktop, lighter glass for panes.** See *Glass* below — the
   in-page effect and the real window effect are different mechanisms.
5. **Metadata in every row.** Size (or item count for a directory) and modified
   date, in the mono face with tabular figures. The date hides first when the
   column is narrower than 470px, the size below 300px (container queries).
6. **The preview is the hero.** The widest column. Identity block (icon tile,
   name, kind · size), then properties as chips, then the content.
7. **Nothing shifts.** The status bar swaps its contents (mode, counts, search
   field, transient message, progress) at a fixed height — the existing
   `StatusBar.tsx` contract, restyled.

## Host profiles — the standalone is full, Mesura Code is minimal

Operator decision, 2026-10-11: **the full Atmosphere design is for the
standalone application. Inside Mesura Code the panel stays minimal — no
preview and no extra chrome.**

Mesura Code consumes this repository as a git subtree
(`~/repos/mesura-code/vendor/symmetria-file-manager`, runbook
`docs/operations/vendor-symmetria-file-manager.md` there). A change here reaches
it only at the next manual `git subtree pull`, and then it arrives whole. It
uses two surfaces, and both must keep working after that pull:

1. **The file tree in the right panel** — `FileTree` and friends from
   `@symmetria/fm-ui/tree`, plus `tree.css` and `overview/styles.css`, hosted by
   `apps/web/src/components/files/mesuraTree/`. This is the "pane" the operator
   means. It stays minimal: names, icons, git badges, indent guides — no
   preview, no size/date columns, the host's font and density (Mesura Code sets
   12px type; its virtualizer measures rows at a fixed 24px, so row height is
   a host-supplied value, never a CSS-only change: `App`'s `rowHeight` prop,
   provided to every list through `RowHeightContext`, default 24. The
   standalone passes 31 and sets `--row-height` from the same number in
   `app/src/renderer/main.tsx`).
2. **The full file manager over the window on `Ctrl+Shift+E`** — the whole
   `@symmetria/fm-ui/App`, hosted by `MesuraFileManagerLayer.tsx` with
   `fileManager.css`. The operator chose "Atmosphere, no glass" on Mesura
   Code's own colours for it (2026-10-11). Not implemented: today it renders
   the previous layout, because it passes no `chrome` prop.

Rules that hold:

- **`styles.css` and `tree.css` never require a token Mesura Code does not
  define.** Mesura Code imports those sheets but NOT `theme/tokens.css`; they
  read its tokens (`--background`, `--border`, `--accent`, `--radius`, …) by
  name, in light and dark. Every new token gets a `var(--x, <fallback>)`
  fallback that reproduces today's look, and only the standalone's
  `tokens.css` sets the Atmosphere value.
- **Standalone-only chrome is opt-in.** The rail, pill tabs, floating status
  bar, the preview beside the tree, and window transparency render only when
  the host asks for them (`chrome="atmosphere"` and `atmosphere.css`, both set
  by the standalone host in `app/src/renderer`), never by default. New markup
  the standalone shows (row size and date, the mode pill, the preview head) is
  `display: none` in `styles.css`.
- **A bridge method only the standalone uses is optional on `Bridge`.**
  `diskUsage` and `places` are the examples: Mesura Code implements `Bridge`
  itself (`wsBridge.ts`) and must still compile without them.
- **Header controls press keys; they never call actions directly.** Each
  button runs its key through the cascade (`PressKey` from `useKeyDispatch`),
  so it is gated exactly as the key is: the picker refuses the overview and a
  new tab, a dialog swallows the click, and `/` in the overview opens the
  overview's own search. The view switch is `useViewSwitch`. Breadcrumb and
  rail clicks close the tree and the overview, then navigate, so the window
  never shows two places at once.
- **The header and the rail live outside `main`.** `main` turns inert while
  the overview or the reader is open; the view switch and the rail must stay
  clickable over the overview (`AtmosphereWindow` in `App.tsx`).
- **`FileTree` stays a tree.** The preview beside it is composed by the
  standalone's browsing view, not added inside `FileTree`.
- Before telling the operator a subtree pull is safe, run Mesura Code's four
  vendored suites per the runbook. Its server also registers this repository's
  IPC handlers, so a new channel (such as `symmetria-fm:disk-usage` and
  `symmetria-fm:places`) may need a line in its `channels.test.ts`.

## Glass — the porting risk

The prototype's window blurs the wallpaper with `backdrop-filter: blur(40px)
saturate(0)`, so any wallpaper arrives as greyscale and the window is neutral on
every wallpaper. **That only works inside a page.** A real Electron window cannot
apply `backdrop-filter` to the desktop: Chromium never receives the pixels behind
the window.

In the real app:

- The window is transparent: `BrowserWindow({ transparent: true,
  backgroundColor: WINDOW_BACKGROUND })` in `app/src/main/window.ts`, with
  `WINDOW_BACKGROUND = "#00000000"` (it was opaque `#0b0b0b`). A transparent
  first frame is not white either, so the first-frame rule still holds.
- The blur comes from Hyprland (`decoration:blur`). Hyprland's blur keeps the
  wallpaper's colour; `decoration:blur:vibrancy` only ADDS saturation (default
  0.1696). There is no desaturating option, so **the only lever against tint is
  the alpha of the neutral window fill.**
- Measured in the prototype's compositor emulation (`V` key; `?glass=c70|c82|c90`)
  on the warm "Dunes" wallpaper: 70% shows a clear warm cast, 82% a faint one,
  90% is close to neutral. **The operator chose 88%** (2026-10-11):
  `--atmo-window` in `atmosphere.css`.
- In-page glass (panes, popovers, overview cards, the scrim) blurs page content,
  not the desktop, so it keeps `saturate(0)` and works as prototyped.
- Hyprland blur is configured in the operator's dotfiles, not in this repo, and
  it is disabled on the headless server (`decoration:blur:enabled = 0`), so
  screenshots taken on the server show the fill without blur. Verify the glass
  on the laptop.
- Embedded in Mesura Code there is no desktop behind the panel; the window fill
  then sits on Mesura Code's own background. Keep the fill a token so the host
  can make it opaque.

## Tokens

Values from the HTML prototype's `atmosphere.css`. The app implements them in
`app/src/renderer/atmosphere.css`, partly as `--atmo-*` tokens and partly by
overriding the package tokens. The right column names the package token in
`packages/fm-ui/src/theme/tokens.css` each value maps to. Use it if the values
ever move into the package, for example for the Mesura Code variant:
`theme.test.ts` forbids colour literals outside `tokens.css` in the package
sheets.

| Token (prototype) | Value | Port target |
|---|---|---|
| `--glass-win` | `rgb(14 14 15 / 64%)` in-page; **88–90% in the real window** | new `--window-fill` |
| `--glass-pane` | `rgb(255 255 255 / 3.5%)` | `--card` |
| `--glass-pane-2` (preview) | `rgb(0 0 0 / 26%)` | new `--pane-preview` |
| `--glass-pop` | `rgb(24 24 25 / 82%)` + `blur(40px) saturate(0) brightness(0.8)` | `--popover`, `--glass-background`, `--glass-filter` |
| `--well` (inputs, segmented, status bar) | `rgb(0 0 0 / 26%)` | new `--well` |
| `--edge` / `--edge-2` | white 8% / 13% (as `inset 0 0 0 1px`) | `--border` / `--dialog-border` |
| `--shine` | `inset 0 1px 0 rgb(255 255 255 / 7%)` | new `--shine` |
| `--fg` / `--fg-2` / `--fg-3` | `#f4f4f4` / 64% / 40% | `--foreground` / `--muted-foreground` / new `--faint-foreground` |
| `--hover` / `--fill` | white 5% / 7% | `--muted` / new `--fill` |
| cursor (current column) | `linear-gradient(100deg, white 15%, white 8%)` + inset highlight + `0 6px 18px rgb(0 0 0 / 22%)` | `--accent` becomes this recipe |
| `--blue`, `--blue-ink`, `--blue-soft` 20%, `--blue-faint` 11% | `oklch(66% 0.16 258)`, `oklch(82% 0.08 258)` | `--primary` (+ ink/soft/faint) |
| `--marked` | was warm `oklch(75% 0.09 25)` | **becomes blue-ink** on a blue-faint row |
| `--ok` / `--danger` / `--warn` | `#73cf98` / `#ff5f66` / `#e9bd5b` | `--clipboard-yank` / `--destructive` + `--clipboard-cut` / new `--git-modified` |
| `--folder` / `--file` | foreground / 55% foreground | replaces `--icon-*` |
| flash labels | unchanged: monochrome chip (`--flash-*`) | already matches |

Type and shape:

| Token | Value | Today |
|---|---|---|
| `--font-sans` | `Instrument Sans` 13.5px / 1.4, weights 400–600 | Rubik 16px |
| `--font-mono` | `Fragment Mono` 11px, tabular figures | CaskaydiaCove NF |
| row height | 31px, radius 11px | 24px, 4px |
| pane radius / gap | 18px / 8px | 8px / 6px |
| window radius | 22px | — |
| pills | radius 99px (tabs, breadcrumb, search, segmented, buttons, chips) | — |
| dialog | radius 24px, padding 24px | — |
| status bar | 38px high, radius 14px, floating, left edge aligned to the panes | flat line |

Both faces are OFL and are vendored as woff2 (fontsource `latin` subsets,
~55 KB together), with their licence texts, in `app/src/renderer/fonts/` (and
in `docs/design/prototypes/shared/fonts/` for the prototypes). Never rely on
system fonts. Spanish names need only `latin`
(Latin-1 covers á é í ó ú ñ); add `latin-ext` if other languages appear.

## Layout

```
┌ titlebar (one row) ─────────────────────────────────────────────┐
│ [tabs pill group] ← → [breadcrumb pills]   [search /] [▥ ⋮ ⌘] ?  │
├ rail ┬ parent pane ┬ current pane ─────────┬ preview pane ───────┤
│ 64px │  0.78fr     │  1.22fr               │  1.5fr              │
│ home │             │  name … size  date    │  icon  name         │
│ …    │             │                       │  [chips]            │
│ S F  │             │                       │  content            │
├──────┴─────────────┴───────────────────────┴─────────────────────┤
│        ( ● Normal  39 items         branch  sort  hidden  1/39 ? ) │
└──────────────────────────────────────────────────────────────────┘
```

- **Titlebar:** tabs as a pill group on the left (icon + name, active tab is a
  raised pill), back/forward, breadcrumb segments as pills (last segment raised),
  search pill with its `/` keycap, a three-way view switch, help.
- **View switch: Columns · Tree · Overview**, icon-only pills with tooltips.
  Keys follow the real registry: `Ctrl+E` toggles the tree (`view.toggle`),
  `Ctrl+O` toggles the overview (`miller.overview`), `Esc` leaves either. The
  overview returns to the view it was opened from.
- **Rail:** places, pinned folders as monograms, the disk meter at the bottom.
  Labels appear as a glass tooltip on hover. The places are Home plus the XDG
  user directories that exist (`user-dirs.dirs`, read in the main process by
  `userPlaces` in `packages/fm-main/src/xdg.ts`), each labelled with its own
  directory name, so a translated desktop reads "Descargas". A directory the
  spec disables (set to `$HOME`) or that is missing on disk is left out. The
  HTML prototype's rail showed projects and notes; the app does not.
- **Disk meter:** a drive icon over a 24×4px `<meter>`, level with the status
  bar. It measures the filesystem holding the CURRENT directory (`statfs(2)`,
  `f_bavail`), so another mount shows its own numbers. It re-reads on every
  directory change and every 30 s. Fill: foreground 72% below 90% used, amber
  from 90%, red from 97%, both inclusive. The level is `data-level`, decided in
  code: Chromium's own `low` / `high` count a value exactly at a bound as the
  band below it. Tooltip: `705 GB free of
  953 GB` plus a `26%` keycap. The bridge method `diskUsage` is optional, so a
  host without it draws no meter.
- **Header at narrow widths:** the header is a size container. The breadcrumb
  clips and never runs under the search pill. It gives up its parts in this
  order, and every part keeps its key:
  1. below 1080px header width: the search pill becomes a 34px icon (`/`);
  2. below 860px: help disappears (`?`), and tab names cap at 96px;
  3. below 720px: back/forward disappear (`⇧S` / `⇧D`).
  The breadcrumb is a size container too: below 320px it keeps only the parent
  and the current folder behind `…`, below 180px only the current folder. Tabs
  shrink to 56px each before the pill group overflows.
- **Scrollbars:** Chromium paints a scrollbar along the scroller's full edge and
  does not clip it to `border-radius`. On an 18px card the thumb ran out through
  both curves. The thumb floats instead: 4px inside a 10px lane (a 3px
  transparent border), with a 14px track margin at each end. Never solve this by
  reducing the radius.
- **Panes:** three glass cards. Each has a 44px header: name (600) + count chip,
  and in the current pane right-aligned `Size` / `Modified` labels.
- **Tree view:** toolbar row (`File tree`, entries shown · folders open,
  `Expand project`, `Collapse all`, `Columns · Esc`), then two cards: the tree
  (same rows, plus indent guides and a disclosure chevron) and the preview.
  **The preview beside the tree is new** — today's `FileTree` replaces the whole
  browsing view and shows no preview. Indent guides are one hairline per level,
  centred under the parent's chevron (`--tree-indent: 22px`, `--guide-x: 17px`
  = row gap 10 + half the 14px disclosure).
- **Overview:** one glass surface; toolbar (title, entries inspected, scope,
  zoom group, Fit, Rearrange, minimap toggle, Details, Close · Esc); dotted
  canvas; cards with a count chip and a short path (`…/parent/child/`); links
  white 16%, links of the focused card white 55%; focused card has a blue ring.

## Row states

A row can hold several states at once; each has its own signal.

| State | Treatment |
|---|---|
| cursor, current column | raised white glass (see tokens), weight 550, icon to full foreground |
| cursor, parent column | flat white 7% |
| marked (Space) | blue-faint fill, blue-ink text and icon; with cursor, blue gradient |
| yanked / cut | 6px dot at the row's right edge, green / red with a matching glow; cut also fades name and icon to 45% |
| search match | name underlined in blue, 2px, offset 4px |
| hidden, ignored | faint foreground; ignored also halves the icon |
| git | 18px rounded badge: `M` amber, `A` green, `U` blue, each on a 13% tint of itself |

No row carries a `transition`, `gradient`-on-change or animation. Earlier
measurements showed stutter on fast `j`/`k` (see `FileRow.tsx`). The cursor gradient is a
static fill, not an animated one.

## Overlays

- Dialog: glass popover, radius 24. Item list in a well. Buttons are pills that
  show their key (`Cancel Esc`, `Move to Trash ↵`). Destructive = solid red;
  primary = solid foreground with dark ink. Text field focus = 1px blue ring +
  4px blue-faint halo.
- Which-key: glass card centred above the status bar, two columns.
- Help: glass card, four groups, rows show keycaps.
- Scrim: black 40% + `blur(6px) saturate(0)`.

## Known gaps

These are design proposals that need backend or behaviour work, not CSS only:

1. File properties in the preview (modified, permissions, line count,
   dimensions, duration, git state) need fields the preview route does not
   expose yet. The chips show Kind, Size or Items, and Path only.
2. The status bar's mode pill reads "Overview" while the overview is open,
   not "Search" during its search: the overview keeps its search state inside
   its own component (`ConnectedGroups`). Lifting it out would let the pill
   say more.
3. The prototype's `o` key: in the real tree, `o` toggles a folder
   (`tree.toggleExpand`); the overview is `Ctrl+O` everywhere. The prototype
   follows the registry; keep it that way.

## Running the HTML prototypes

```bash
cd docs/design/prototypes && python -m http.server 8765 --bind 0.0.0.0
```

On the Vigilia box, run it with `mesura-agent-service` and give the operator
the tailnet URL. The prototype uses plain ES modules with no build step.
URL parameters for screenshots: `path`, `cursor`, `view` (`tree`, `overview`),
`open` (repeatable, expands a tree folder), `demo` (`marks`, `trash`, `help`,
`chord`, `search`), `wallpaper`, `glass`.

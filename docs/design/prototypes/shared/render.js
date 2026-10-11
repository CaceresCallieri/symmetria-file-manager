// Pure presentation helpers: formatting, icons, artwork, syntax, markdown.
// No state lives here; app.js owns state and calls these.

import { NOW } from "./data.js";
import { ICONS } from "./icons.js";

export function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

export function icon(name, cls = "ico") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.file}</svg>`;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatSize(bytes) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function dateOf(node) {
  return new Date(NOW.getTime() - node.hoursAgo * 3600 * 1000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");

export function formatDate(node, style) {
  const d = dateOf(node);
  const hours = node.hoursAgo;
  if (style === "compact") {
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    if (hours < 24 * 14) return `${Math.round(hours / 24)}d`;
    if (hours < 24 * 60) return `${Math.round(hours / 24 / 7)}w`;
    if (hours < 24 * 365) return `${Math.round(hours / 24 / 30)}mo`;
    return `${Math.round(hours / 24 / 365)}y`;
  }
  if (style === "iso") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === NOW.toDateString();
  const yesterday = new Date(NOW.getTime() - 86400000).toDateString() === d.toDateString();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `Today, ${time}`;
  if (yesterday) return `Yesterday, ${time}`;
  if (hours < 24 * 6) return `${DAYS[d.getDay()]}, ${time}`;
  if (d.getFullYear() === NOW.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatLongDate(node) {
  const d = dateOf(node);
  const long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  return `${long}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function permissions(node) {
  if (node.kind === "dir") return "drwxr-xr-x";
  if (node.exec || node.name.endsWith(".sh")) return "-rwxr-xr-x";
  return "-rw-r--r--";
}

export function extOf(node) {
  if (node.kind === "dir") return "";
  const dot = node.name.lastIndexOf(".");
  return dot > 0 ? node.name.slice(dot + 1).toLowerCase() : "";
}

// ── File types ──────────────────────────────────────────────────────────────

const SPECIAL_DIRS = {
  Downloads: "download",
  Documents: "file-text",
  Pictures: "image",
  Music: "music",
  Videos: "film",
  projects: "folder-git-2",
  notes: "folder-heart",
  Desktop: "monitor",
  ".git": "git-branch",
};

const TYPES = {
  ts: ["file-code", "blue", "TypeScript"],
  tsx: ["file-code", "blue", "TypeScript JSX"],
  js: ["file-code", "yellow", "JavaScript"],
  mjs: ["file-code", "yellow", "JavaScript module"],
  css: ["file-code", "purple", "CSS stylesheet"],
  json: ["file-json", "yellow", "JSON document"],
  jsonc: ["file-json", "yellow", "JSON with comments"],
  yaml: ["file-text", "pink", "YAML document"],
  md: ["file-text", "blue", "Markdown document"],
  txt: ["file-text", "muted", "Plain text"],
  png: ["image", "pink", "PNG image"],
  jpg: ["image", "pink", "JPEG image"],
  svg: ["image", "orange", "SVG image"],
  zip: ["file-archive", "orange", "ZIP archive"],
  opus: ["music", "green", "Opus audio"],
  m4a: ["music", "green", "MPEG-4 audio"],
  flac: ["music", "green", "FLAC audio"],
  mp4: ["film", "cyan", "MPEG-4 video"],
  pdf: ["file-text", "red", "PDF document"],
  xlsx: ["file-spreadsheet", "green", "Excel workbook"],
  sh: ["square-terminal", "green", "Shell script"],
  db: ["database", "cyan", "SQLite database"],
  service: ["settings", "muted", "systemd unit"],
  desktop: ["settings", "muted", "Desktop entry"],
  gitignore: ["git-branch", "muted", "Git ignore rules"],
  bashrc: ["square-terminal", "muted", "Shell config"],
};

export function typeOf(node) {
  if (node.kind === "dir") {
    const special = SPECIAL_DIRS[node.name];
    if (node.repo) return { icon: "folder-git-2", tint: "folder", kind: "Git repository" };
    return { icon: special ?? "folder", tint: "folder", kind: "Folder" };
  }
  const ext = extOf(node) || node.name.replace(/^\./, "");
  const hit = TYPES[ext];
  if (hit) return { icon: hit[0], tint: hit[1], kind: hit[2] };
  if (node.exec) return { icon: "square-terminal", tint: "green", kind: "Executable" };
  return { icon: "file", tint: "muted", kind: "Document" };
}

export function fileIcon(node) {
  const t = typeOf(node);
  return `<span class="fi" data-tint="${t.tint}">${icon(t.icon)}</span>`;
}

// ── Generated artwork (wallpapers, image previews, screenshots) ────────────

const ART = [
  { base: "#120d14", blobs: [["#f08a4b", 0.75, 0.85, 0.55], ["#6d2f5a", 0.2, 0.3, 0.6], ["#2a1a3d", 0.8, 0.15, 0.5], ["#ffc27a", 0.55, 1.05, 0.35]] },
  { base: "#0e0a17", blobs: [["#7a4bd6", 0.25, 0.25, 0.55], ["#d65b9b", 0.75, 0.55, 0.5], ["#1d6a8a", 0.5, 0.95, 0.5], ["#2b1550", 0.9, 0.1, 0.4]] },
  { base: "#06141a", blobs: [["#1e8c9a", 0.3, 0.7, 0.6], ["#3fd1b0", 0.7, 0.3, 0.35], ["#0d3c66", 0.85, 0.85, 0.6], ["#a8e6dc", 0.15, 0.15, 0.25]] },
  { base: "#170b06", blobs: [["#d9481c", 0.3, 0.8, 0.55], ["#f5a524", 0.7, 0.6, 0.4], ["#5a1a10", 0.8, 0.2, 0.6], ["#ffd38a", 0.45, 0.35, 0.25]] },
  { base: "#0d120d", blobs: [["#7fa36b", 0.3, 0.4, 0.5], ["#c8d6a1", 0.7, 0.7, 0.35], ["#2f4a35", 0.85, 0.2, 0.55], ["#e6b980", 0.2, 0.9, 0.35]] },
];

// Neutral wallpapers, for judging a glass surface without a colour cast.
const NAMED_ART = {
  graphite: { base: "#0c0c0d", blobs: [["#5a5a5e", 0.25, 0.3, 0.55], ["#2c2c2f", 0.8, 0.75, 0.6], ["#8a8a8f", 0.65, 0.2, 0.3], ["#1b1b1d", 0.15, 0.95, 0.5]] },
  daylight: { base: "#9a9ca3", blobs: [["#e8e9ec", 0.3, 0.25, 0.6], ["#6d7078", 0.8, 0.8, 0.55], ["#c9cbd1", 0.7, 0.3, 0.4], ["#4b4e55", 0.1, 0.9, 0.5]] },
};

export function artSVG(seed, { w = 1600, h = 1000, grain = true } = {}) {
  if (seed === 5 || seed === 6) return screenshotSVG(seed, w, h);
  const art = typeof seed === "string" ? NAMED_ART[seed] : ART[seed % ART.length];
  const id = `a${seed}${w}`;
  const defs = art.blobs
    .map(([c], i) => `<radialGradient id="${id}g${i}"><stop offset="0" stop-color="${c}" stop-opacity="0.95"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`)
    .join("");
  const blobs = art.blobs.map(([, x, y, r], i) => `<ellipse cx="${x * w}" cy="${y * h}" rx="${r * w}" ry="${r * h * 1.1}" fill="url(#${id}g${i})"/>`).join("");
  const noise = grain
    ? `<filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/></filter><rect width="100%" height="100%" filter="url(#${id}n)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs><rect width="100%" height="100%" fill="${art.base}"/>${blobs}${noise}</svg>`;
}

function screenshotSVG(seed, w, h) {
  // A schematic of a file manager window: an image that reads as "screenshot".
  const rows = Array.from({ length: 22 }, (_, i) => {
    const y = 90 + i * 38;
    const len = 140 + ((i * 97 + seed * 31) % 220);
    return `<rect x="70" y="${y}" width="16" height="14" rx="3" fill="#5b5b5b"/><rect x="100" y="${y + 2}" width="${len}" height="10" rx="5" fill="#8a8a8a"/>` +
      `<rect x="${w * 0.36}" y="${y}" width="16" height="14" rx="3" fill="#5b5b5b"/><rect x="${w * 0.36 + 30}" y="${y + 2}" width="${len * 1.1}" height="10" rx="5" fill="#9a9a9a"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><rect width="100%" height="100%" fill="#050505"/><rect x="30" y="30" width="${w - 60}" height="${h - 60}" rx="22" fill="#0f0f0f" stroke="#262626"/><rect x="60" y="${90 + (seed % 6) * 38 - 8}" width="${w * 0.3}" height="30" rx="8" fill="#1d1d1d"/>${rows}<rect x="${w * 0.68}" y="80" width="${w * 0.28}" height="${h - 160}" rx="14" fill="#141414"/></svg>`;
}

export function artURL(seed, opts) {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSVG(seed, opts))}")`;
}

export function waveformSVG(seed, bars = 96) {
  let x = seed * 9301 + 49297;
  const rand = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  const rects = Array.from({ length: bars }, (_, i) => {
    const envelope = 0.35 + 0.65 * Math.sin((i / bars) * Math.PI) ** 0.6;
    const hgt = Math.max(0.08, envelope * (0.3 + rand() * 0.7));
    return `<rect x="${i * 4}" y="${50 - hgt * 46}" width="2.2" height="${hgt * 92}" rx="1.1"/>`;
  }).join("");
  return `<svg class="wave" viewBox="0 0 ${bars * 4} 100" preserveAspectRatio="none">${rects}</svg>`;
}

// ── Syntax ──────────────────────────────────────────────────────────────────

const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y;
const RULES = {
  tsx: [
    ["com", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["str", STR],
    ["tag", /<\/?[A-Za-z][\w.]*|\/?>/y],
    ["kw", /\b(?:import|from|export|function|return|const|let|interface|type|readonly|if|else|new|extends|true|false|null|undefined|as)\b/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
    ["type", /\b[A-Z][A-Za-z0-9]*\b/y],
    ["fn", /\b[a-z_$][\w$]*(?=\()/y],
    ["attr", /\b[a-zA-Z]+(?==)/y],
  ],
  css: [
    ["com", /\/\*[\s\S]*?\*\//y],
    ["str", STR],
    ["kw", /@[\w-]+/y],
    ["tag", /[.#][\w-]+/y],
    ["attr", /[a-z-]+(?=\s*:)/y],
    ["fn", /[a-z-]+(?=\()/y],
    ["num", /-?\d+(?:\.\d+)?(?:px|rem|em|%|ms|s)?/y],
    ["type", /--[\w-]+/y],
  ],
  json: [
    ["attr", /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
    ["str", STR],
    ["kw", /\b(?:true|false|null)\b/y],
    ["num", /-?\d+(?:\.\d+)?/y],
  ],
  sh: [
    ["com", /#[^\n]*/y],
    ["str", STR],
    ["type", /\$\{?[\w@]+\}?|\$\(/y],
    ["kw", /\b(?:set|echo|if|then|fi|for|do|done|cd|cp|mv|rm|ln|install|systemctl|jq)\b/y],
    ["attr", /(?<=\s)-{1,2}[\w-]+/y],
  ],
};

export function highlight(text, lang) {
  const rules = RULES[lang];
  if (!rules) return esc(text);
  let out = "";
  let plain = "";
  let i = 0;
  const flush = () => {
    out += esc(plain);
    plain = "";
  };
  while (i < text.length) {
    let matched = false;
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length > 0) {
        flush();
        out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const word = /[\w$]+/y;
      word.lastIndex = i;
      const m = word.exec(text);
      const take = m ? m[0] : text[i];
      plain += take;
      i += take.length;
    }
  }
  flush();
  return out;
}

export function codeBlock(text, lang) {
  const lines = highlight(text.replace(/\n$/, ""), lang).split("\n");
  return `<div class="code" data-lang="${lang}">${lines.map((l) => `<span class="ln">${l || " "}</span>`).join("")}</div>`;
}

// ── Markdown (the subset the sample files use) ─────────────────────────────

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function markdown(text) {
  const out = [];
  const lines = text.split("\n");
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      closeList();
      const lang = line.slice(3).trim();
      const body = [];
      while (++i < lines.length && !lines[i].startsWith("```")) body.push(lines[i]);
      out.push(`<pre class="md-code">${highlight(body.join("\n"), lang)}</pre>`);
      continue;
    }
    const heading = /^(#{1,3}) (.*)/.exec(line);
    const ordered = /^\d+\. (.*)/.exec(line);
    const bullet = /^- (.*)/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (ordered || bullet) {
      const tag = ordered ? "ol" : "ul";
      if (list !== tag) {
        closeList();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inline((ordered ?? bullet)[1])}</li>`);
    } else if (line.startsWith("> ")) {
      closeList();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    } else if (line.trim()) {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    } else closeList();
  }
  closeList();
  return `<article class="md">${out.join("")}</article>`;
}

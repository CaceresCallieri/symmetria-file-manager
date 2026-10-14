export function parseMainSection(text: string): Map<string, string> {
  const keys = new Map<string, string>();
  let inMainSection = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inMainSection = trimmed === "[Desktop Entry]";
      continue;
    }
    if (!inMainSection) continue;

    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      keys.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
    }
  }
  return keys;
}

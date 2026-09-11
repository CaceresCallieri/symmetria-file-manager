/** Measure jump text with the filename's font rather than a separate keycap font. */
export function measureFlashTypography(name: HTMLElement, label: string, zoom: number) {
  const source = getComputedStyle(name);
  const probe = document.createElement("span");
  const font = {
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    fontWeight: source.fontWeight,
    fontStyle: source.fontStyle,
    lineHeight: source.lineHeight,
    letterSpacing: source.letterSpacing,
  };
  Object.assign(probe.style, font, {
    position: "fixed",
    visibility: "hidden",
    whiteSpace: "pre",
    pointerEvents: "none",
  });
  probe.textContent = label;
  document.body.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return {
    fontFamily: font.fontFamily,
    fontSize: `${Number.parseFloat(font.fontSize) * zoom}px`,
    fontWeight: font.fontWeight,
    fontStyle: font.fontStyle,
    letterSpacing:
      font.letterSpacing === "normal"
        ? "normal"
        : `${Number.parseFloat(font.letterSpacing) * zoom}px`,
    lineHeight: `${rect.height * zoom}px`,
    height: rect.height * zoom,
    width: rect.width * zoom + 4 * zoom,
    padding: 2 * zoom,
  };
}

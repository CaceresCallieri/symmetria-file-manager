/**
 * A size a person can read.
 *
 * Extracted from `PreviewPane`, which had the only copy until the archive rows
 * needed one too. Two copies of a formatter is how a listing and the notice
 * below it come to disagree about what a megabyte is.
 */
export function humanSize(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

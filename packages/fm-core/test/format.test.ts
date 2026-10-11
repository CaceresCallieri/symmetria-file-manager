/**
 * The two formatters more than one package reads.
 *
 * They moved here because a third caller appeared in a package that cannot
 * import the second one. What is worth pinning is the boundaries — where a unit
 * changes, and what happens to the values that are not really values at all.
 */
import { describe, expect, it } from "vitest";

import { humanAge, humanDate, humanSize } from "../src/format.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("humanSize", () => {
  it("leaves bytes whole and gives every larger unit one decimal", () => {
    // The asymmetry is deliberate: "1023 B" is exact and "1023.0 B" is noise,
    // while "1 kB" hides the difference between 1024 and 2047.
    expect(humanSize(0)).toBe("0 B");
    expect(humanSize(1023)).toBe("1023 B");
    expect(humanSize(1024)).toBe("1.0 kB");
  });

  it("steps up at each power of 1024", () => {
    expect(humanSize(1024 * 1024)).toBe("1.0 MB");
    expect(humanSize(1024 ** 3)).toBe("1.0 GB");
    expect(humanSize(1024 ** 4)).toBe("1.0 TB");
  });

  it("stops at the largest unit it names rather than inventing another", () => {
    // A petabyte file is not a real case, but a wrong unit for one is a wrong
    // unit, and the loop's bound is what stops `units[unit]` being undefined.
    expect(humanSize(1024 ** 5)).toBe("1024.0 TB");
  });
});

describe("humanAge", () => {
  const now = 1_700_000_000_000;

  it("names one coarse unit, not two", () => {
    // Read at a glance beside three other facts. "3 months, 2 days ago" costs a
    // row of the preview to say what "3mo ago" says.
    expect(humanAge(now - 3 * DAY - 5 * HOUR, now)).toBe("3d ago");
  });

  it("steps through minutes, hours, days, months and years", () => {
    expect(humanAge(now - 2 * MINUTE, now)).toBe("2m ago");
    expect(humanAge(now - 5 * HOUR, now)).toBe("5h ago");
    expect(humanAge(now - 10 * DAY, now)).toBe("10d ago");
    expect(humanAge(now - 70 * DAY, now)).toBe("2mo ago");
    expect(humanAge(now - 800 * DAY, now)).toBe("2y ago");
  });

  it("says just now for anything under a minute", () => {
    expect(humanAge(now - 30 * SECOND, now)).toBe("just now");
    // Paired with a real age, so a formatter that answered "just now" to
    // everything could not pass this.
    expect(humanAge(now - 90 * SECOND, now)).toBe("1m ago");
  });

  it("reads a missing timestamp as unknown rather than as 1970", () => {
    // The engine reports no modification time for a directory, so zero is the
    // NORMAL case there. Dating every folder to the Unix epoch would be a
    // confident lie about a fact nobody asked for.
    expect(humanAge(0, now)).toBe("—");
    expect(humanAge(-1, now)).toBe("—");
  });

  it("does not say a file was modified in the future", () => {
    // A clock that disagrees with a file server, or a leap-second smear, puts a
    // modification time ahead of now. "in 4s ago" is worse than "just now".
    expect(humanAge(now + 10 * MINUTE, now)).toBe("just now");
  });
});

describe("humanDate", () => {
  // Local wall-clock times, so the assertions hold in any time zone the suite
  // runs in. Saturday 11 October 2026, 14:30.
  const now = new Date(2026, 9, 11, 14, 30).getTime();
  const at = (month: number, day: number, hour = 9, minute = 5, year = 2026) =>
    new Date(year, month, day, hour, minute).getTime();

  it("gives today and yesterday a time", () => {
    expect(humanDate(at(9, 11, 0, 0), now)).toBe("Today, 00:00");
    expect(humanDate(at(9, 10, 23, 59), now)).toBe("Yesterday, 23:59");
  });

  it("gives the five days before yesterday a weekday", () => {
    expect(humanDate(at(9, 9), now)).toBe("Fri, 09:05");
    expect(humanDate(at(9, 5), now)).toBe("Mon, 09:05");
  });

  it("never names a weekday that could also mean this week's", () => {
    // Saturday a week ago: "Sat" would read as today.
    expect(humanDate(at(9, 4), now)).toBe("Oct 4");
  });

  it("gives a month and day this year, and a month and year before it", () => {
    expect(humanDate(at(0, 2), now)).toBe("Jan 2");
    expect(humanDate(at(11, 31, 9, 5, 2025), now)).toBe("Dec 2025");
  });

  it("reads zero as unknown", () => {
    expect(humanDate(0, now)).toBe("—");
  });

  it("does not call a time after today 'Today'", () => {
    expect(humanDate(at(9, 12, 8), now)).toBe("Oct 12");
  });

  it("counts calendar days, not 24-hour spans, across a clock change", () => {
    // Europe's clocks go back on Sunday 25 October 2026, so in a zone that
    // follows them that day is 25 hours long, and a fixed 24-hour step back
    // from Monday's midnight lands at 01:00 on Sunday. Its first hour then read
    // as "Sun, 00:30" instead of "Yesterday". In a zone without the change both
    // forms agree; run the suite with TZ=Europe/Madrid to exercise it.
    const monday = new Date(2026, 9, 26, 0, 30).getTime();
    expect(humanDate(new Date(2026, 9, 25, 0, 30).getTime(), monday)).toBe("Yesterday, 00:30");
  });
});

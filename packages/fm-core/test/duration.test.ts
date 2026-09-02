import { describe, expect, it } from "vitest";

import { formatDuration } from "../src/preview/duration.ts";

/**
 * A length a person reads at a glance.
 *
 * In `packages/fm-core` rather than inside the audio pane, which is its only
 * caller today: a formatter that lives inside its one consumer is the shape
 * that gets copied when a second arrives rather than imported.
 */

describe("formatDuration", () => {
  it("writes a short track as minutes and seconds", () => {
    expect(formatDuration(215)).toBe("3:35");
  });

  it("pads the seconds so the width does not jump", () => {
    // A pane whose duration is sometimes four characters and sometimes five
    // shifts everything beside it as the cursor moves.
    expect(formatDuration(65)).toBe("1:05");
  });

  it("does not pad the minutes", () => {
    // `3:35`, not `03:35`. The leading zero buys nothing and reads like a clock.
    expect(formatDuration(215).startsWith("3")).toBe(true);
  });

  it("shows zero as a real value rather than as nothing", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("drops the fraction rather than rounding up", () => {
    // A 9.9 second file that reads 0:10 has been rounded past its own end.
    expect(formatDuration(9.9)).toBe("0:09");
  });

  it("adds an hours field only once there are hours", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3599)).toBe("59:59");
  });

  it("pads the minutes once they follow an hours field", () => {
    // `1:05:00`, not `1:5:00`. The rule for minutes flips when they stop being
    // the leading field, which is the one place this is easy to get wrong.
    expect(formatDuration(3900)).toBe("1:05:00");
  });

  it("says nothing rather than guessing when the length is unknown", () => {
    // A media element reports `NaN` until it has metadata, and `Infinity` for a
    // stream. Neither is a duration, and "NaN:aN" on screen is worse than a
    // blank.
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatDuration(-1)).toBe("");
  });
});

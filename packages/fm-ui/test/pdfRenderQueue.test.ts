import { describe, expect, it } from "vitest";
import { PdfRenderQueue } from "../src/components/preview/pdf/renderQueue.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PDF rendering lifetime", () => {
  it("prioritizes the visible page and never overlaps rendering jobs", async () => {
    const queue = new PdfRenderQueue();
    const started: string[] = [];
    let finishVisible: (() => void) | undefined;
    queue.enqueue(async () => {
      started.push("neighbor");
    }, 1);
    queue.enqueue(async () => {
      started.push("visible");
      await new Promise<void>((resolve) => {
        finishVisible = resolve;
      });
    }, 0);
    await tick();
    expect(started).toEqual(["visible"]);
    finishVisible?.();
    await tick();
    expect(started).toEqual(["visible", "neighbor"]);
  });

  it("cancels a queued page without loading it and aborts the active page", async () => {
    const queue = new PdfRenderQueue();
    let activeSignal: AbortSignal | undefined;
    let queuedStarted = false;
    const cancelActive = queue.enqueue(async (signal) => {
      activeSignal = signal;
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }, 0);
    const cancelQueued = queue.enqueue(async () => {
      queuedStarted = true;
    }, 1);
    await tick();
    cancelQueued();
    cancelActive();
    await tick();
    expect(activeSignal?.aborted).toBe(true);
    expect(queuedStarted).toBe(false);
  });

  it("supports effect cleanup and setup without reviving old jobs", async () => {
    const queue = new PdfRenderQueue();
    const started: string[] = [];
    queue.enqueue(async () => {
      started.push("old");
    }, 0);
    queue.clear();
    queue.enqueue(async () => {
      started.push("new");
    }, 0);
    await tick();
    expect(started).toEqual(["new"]);
  });
});

import type { FullDependencies } from "../src/ipc/register.ts";

/** These operation tests do not exercise the clipboard or finder. */
export const desktopTestServices = {
  clipboard: {
    copyText: () => {},
    copyImage: () => "This test does not provide an image clipboard",
  },
  searchPool: () => {
    throw new Error("This test does not provide a finder");
  },
} satisfies Pick<FullDependencies, "clipboard" | "searchPool">;

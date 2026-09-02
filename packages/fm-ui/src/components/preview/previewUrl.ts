import { isFailure } from "@symmetria/fm-core/contract";
import { useEffect, useState } from "react";

import { previewUrl } from "../../bridge.ts";

/**
 * A URL the browser may load a previewed file from.
 *
 * A same-origin URL under the application's own scheme, NOT a `file://` one and
 * NOT a blob built from bytes sent over the bridge. The renderer has no
 * filesystem by design; the main process authorises each previewed path and
 * hands back an address for it, so nothing here touches the disk and nothing
 * copies a file across the process boundary.
 *
 * Two consumers need it to be exactly this and not a blob: Chromium's document
 * viewer refuses a `blob:` whose origin is a custom scheme — the embed resolves
 * to an error page, invisibly — and a media element streams from a URL rather
 * than holding the whole file in memory.
 *
 * It lives in a module of its own because four components share it now. A hook
 * that stays inside one of its own consumers is the shape that produces a
 * circular import as soon as the second one grows.
 */
export function usePreviewUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setUrl(null);

    void previewUrl(path).then((reply) => {
      if (!current || isFailure(reply)) return;
      setUrl(reply.value);
    });

    return () => {
      current = false;
    };
  }, [path]);

  return url;
}

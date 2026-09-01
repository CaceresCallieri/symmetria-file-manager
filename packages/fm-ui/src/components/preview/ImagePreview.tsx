import { isFailure } from "@symmetria/fm-core/contract";
import { useEffect, useState } from "react";

import { previewUrl } from "../../bridge.ts";

export interface ImagePreviewProps {
  readonly path: string;
  readonly mime: string;
}

/**
 * A URL the browser may load this file from.
 *
 * A same-origin URL under the application's own scheme, NOT a `file://` one and
 * NOT a blob built from bytes sent over the bridge. The renderer has no
 * filesystem by design; the main process authorises each previewed path and
 * hands back an address for it, so nothing here touches the disk and nothing
 * copies a file across the process boundary.
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

/** An image, at its natural aspect ratio. */
export function ImagePreview({ path, mime }: ImagePreviewProps) {
  const url = usePreviewUrl(path);

  // The failure is remembered AS a path, not as a flag reset by an effect.
  // A flag needs clearing when the file changes, and an effect that only clears
  // it reads none of what it depends on; comparing paths makes "this failure
  // belongs to that file" the value itself.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = failedPath === path;

  if (url === null) return <div data-testid="preview-loading">reading…</div>;

  // A file whose extension says image and whose bytes disagree.
  //
  // Verification found this failing in total silence: no error state, no
  // console line, and a preview pane collapsed to zero height — which reads as
  // a rendering fault rather than as an unreadable file. Routing is decided by
  // the NAME, so a name that lies can only be caught here, at the decode.
  if (failed) {
    return (
      <p className="preview__failed" data-testid="preview-image-failed">
        not a readable {mime} image
      </p>
    );
  }

  return (
    <div className="preview preview--image" data-testid="preview-image">
      {/* `object-fit: contain` in the stylesheet is what keeps the aspect
          ratio; width and height are not set here for the same reason. */}
      <img
        src={url}
        alt=""
        data-testid="preview-image-element"
        onError={() => setFailedPath(path)}
      />
    </div>
  );
}

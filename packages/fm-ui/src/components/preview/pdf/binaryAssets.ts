/// <reference types="vite/client" />

// Eager imports collect URLs, not asset bytes. Resolve from this package's
// dependency link so a host can emit the assets at any path or custom origin.
const binaryAssets = {
  cMapUrl: import.meta.glob<string>("../../../../node_modules/pdfjs-dist/cmaps/*.bcmap", {
    eager: true,
    exhaustive: true,
    query: "?url&no-inline",
    import: "default",
  }),
  standardFontDataUrl: import.meta.glob<string>(
    "../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    {
      eager: true,
      exhaustive: true,
      query: "?url&no-inline",
      import: "default",
    },
  ),
  wasmUrl: import.meta.glob<string>("../../../../node_modules/pdfjs-dist/wasm/*.wasm", {
    eager: true,
    exhaustive: true,
    query: "?url&no-inline",
    import: "default",
  }),
};

type AssetKind = keyof typeof binaryAssets;

const assetUrls = new Map(
  Object.entries(binaryAssets).flatMap(([kind, assets]) =>
    Object.entries(assets).map(([path, url]) => [`${kind}/${path.split("/").at(-1)}`, url]),
  ),
);

/** PDF.js delegates worker asset requests here when useWorkerFetch is false. */
export class PdfBinaryDataFactory {
  async fetch({ kind, filename }: { kind: AssetKind; filename: string }): Promise<Uint8Array> {
    const url = assetUrls.get(`${kind}/${filename}`);
    if (!url) throw new Error(`Unknown PDF asset: ${kind}/${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`PDF asset request failed: ${filename} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

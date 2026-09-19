import { deflateSync } from "node:zlib";

/** A deterministic vector-heavy PDF, without external files or a PDF library. */
export function pdfFixture() {
  const objects = [];
  const add = (data) => {
    objects.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pages = [];
  for (let page = 1; page <= 17; page++) {
    const commands = ["0.98 0.96 0.99 rg 0 0 1440 810 re f", "0.25 0.02 0.6 RG 0.8 w"];
    for (let curve = 0; curve < 450; curve++) {
      const x = curve * 3.2;
      commands.push(
        `${x.toFixed(2)} 0 m ${(x + 180).toFixed(2)} 270 ${(x - 180).toFixed(2)} 540 ${x.toFixed(2)} 810 c S`,
      );
    }
    commands.push(
      "1 1 1 rg 50 280 1340 240 re f",
      `0.25 0.02 0.6 rg BT /F1 48 Tf 90 420 Td (PDF scroll benchmark - page ${page}) Tj ET`,
      "BT /F1 24 Tf 90 355 Td (17 landscape pages / 450 cubic paths per page) Tj ET",
    );
    const stream = deflateSync(commands.join("\n"));
    const content = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
        stream,
        Buffer.from("\nendstream"),
      ]),
    );
    pages.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1440 810] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((page) => `${page} 0 R`).join(" ")}] >>`,
  );
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

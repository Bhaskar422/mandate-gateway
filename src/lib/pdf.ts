/** A dependency-free, text-only PDF writer. PayPal accepts PDF evidence; this is all the evidence record needs. */
export function textPdf(title: string, lines: string[]): Buffer {
  const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
  const wrap = (s: string, n = 96) => { const out: string[] = []; let rest = s; while (rest.length > n) { let cut = rest.lastIndexOf(" ", n); if (cut < 40) cut = n; out.push(rest.slice(0, cut)); rest = `  ${rest.slice(cut).trimStart()}`; } out.push(rest); return out; };
  const all = lines.flatMap((l) => wrap(l));
  const perPage = 58, pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  const catalog = add(""), pagesId = add(""), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"), bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const kids: number[] = [];
  pages.forEach((pg, n) => {
    const text = [`BT /F2 13 Tf 40 800 Td (${clean(title)}${pages.length > 1 ? `  (page ${n + 1} of ${pages.length})` : ""}) Tj ET`, "BT /F1 8.5 Tf 12 TL 40 778 Td", ...pg.map((l) => `(${clean(l)}) Tj T*`), "ET"].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

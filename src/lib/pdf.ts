// Primary documents → per-page text. Pages are kept separate so every
// extracted claim can cite the page it came from.
import { extractText, getDocumentProxy } from "unpdf";
import { fetchBuffer } from "./screener";

export interface PdfDoc {
  url: string;
  pages: string[];
  scanned: boolean; // no text layer → caller should send raw PDF to the model
  bytes?: Uint8Array;
}

const cache = new Map<string, PdfDoc>();

export async function readPdf(url: string, keepBytes = false): Promise<PdfDoc> {
  const hit = cache.get(url);
  if (hit) return hit;
  const bytes = await fetchBuffer(url);
  const proxy = await getDocumentProxy(bytes.slice()); // pdf.js detaches the buffer it is given
  const { text } = await extractText(proxy, { mergePages: false });
  const pages = (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  const chars = pages.reduce((s, p) => s + p.length, 0);
  const doc = { url, pages, scanned: chars < 200 * Math.max(1, pages.length * 0.3), bytes: keepBytes ? bytes : undefined };
  cache.set(url, doc);
  return doc;
}

/** Text with page markers, so the model can cite "p.7". */
export const paged = (d: PdfDoc, from = 0, to = d.pages.length) =>
  d.pages.slice(from, to).map((t, i) => `[[page ${from + i + 1}]]\n${t}`).join("\n\n");

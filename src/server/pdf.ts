// @ts-ignore legacy build has no bundled types path
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function isPageOrChapterLabel(line: string): boolean {
  const text = normalizeLine(line);
  if (!text) return true;
  if (/^(chapter|chapters|part|book|title|story)\b/i.test(text)) return true;
  if (/^(page|p\.)\s*\d+$/i.test(text)) return true;
  if (/^\d+$/.test(text.replace(/[^\d]/g, ""))) return true;
  return false;
}

function looksLikeTitle(line: string): boolean {
  const text = normalizeLine(line);
  if (!text) return true;
  if (isPageOrChapterLabel(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && text.length <= 45) return true;
  if (words.length <= 10 && /^[A-Z0-9 ,;:'"()\-!?]+$/.test(text) && text.length <= 60) return true;
  return false;
}

function sanitizePage(pageLines: string[], existingTitle: string): { title: string; content: string[] } {
  const lines = pageLines.map(normalizeLine).filter(Boolean);
  if (!lines.length) return { title: existingTitle, content: [] };

  let title = existingTitle;
  let startIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    if (looksLikeTitle(line)) {
      if (!title && line.length >= 8 && line.length <= 90) title = line;
      startIndex = i + 1;
      continue;
    }
    startIndex = i;
    break;
  }

  const cleaned = lines.slice(startIndex).filter((line) => {
    if (!line || line.length < 12) return false;
    if (isPageOrChapterLabel(line)) return false;
    if (existingTitle && line.toLowerCase() === existingTitle.toLowerCase()) return false;
    if (title && line.toLowerCase() === title.toLowerCase()) return false;
    return true;
  });

  return { title, content: cleaned.length ? cleaned : lines.filter((line) => line.length >= 12 && !isPageOrChapterLabel(line)) };
}

function groupParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length) {
        paragraphs.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    const last = current[current.length - 1];
    const shouldContinue = current.length > 0 && (
      last.length < 80 ||
      trimmed.length < 60 ||
      !/[.!?]$/.test(last) ||
      /[,;:]/.test(trimmed)
    );

    if (shouldContinue) current.push(trimmed);
    else {
      if (current.length) paragraphs.push(current.join("\n"));
      current = [trimmed];
    }
  }

  if (current.length) paragraphs.push(current.join("\n"));
  return paragraphs.filter((p) => p.trim().length > 0);
}

function splitLargeParagraphs(paragraphs: string[], maxLines: number): string[] {
  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length <= maxLines) {
      out.push(lines.join("\n"));
      continue;
    }

    for (let i = 0; i < lines.length; i += maxLines) {
      const chunk = lines.slice(i, i + maxLines).join("\n");
      if (chunk.trim()) out.push(chunk);
    }
  }
  return out;
}

export async function extractPages(buf: Buffer, maxLines = 20): Promise<{ title: string; pages: string[][] }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pages: string[][] = [];
  let title = "";

  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];

    for (const it of content.items as any[]) {
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: it.str });
    }

    rows.sort((a, b) => b.y - a.y);
    const pageLines: string[] = [];
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      const line = r.parts.map((q) => q.s).join(" ").replace(/\s+/g, " ").trim();
      if (line) pageLines.push(line);
    }

    const sanitized = sanitizePage(pageLines, title);
    if (!title && sanitized.title) title = sanitized.title;
    const paragraphs = splitLargeParagraphs(groupParagraphs(sanitized.content), maxLines);
    pages.push(paragraphs.filter(Boolean));
  }

  return { title, pages };
}

/** Extracts visual lines across all pages in reading order. */
export async function extractLines(buf: Buffer): Promise<string[]> {
  const { pages } = await extractPages(buf, 20);
  return pages.flat();
}

export function chunkLines(lines: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += n) out.push(lines.slice(i, i + n).join("\n"));
  return out;
}

export function chunkPages(pages: string[][], n: number): { page: number; chunks: string[] }[] {
  return pages.map((paragraphs, index) => ({
    page: index + 1,
    chunks: paragraphs.filter(Boolean).map((p) => p.trim()).filter(Boolean).flatMap((p) => {
      const paragraphLines = p.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (paragraphLines.length <= n) return [paragraphLines.join("\n")];
      const chunks: string[] = [];
      for (let i = 0; i < paragraphLines.length; i += n) {
        const part = paragraphLines.slice(i, i + n).join("\n");
        if (part.trim()) chunks.push(part);
      }
      return chunks;
    }),
  }));
}

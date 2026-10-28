import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPages, chunkPages } from "./pdf.js";
import { makeQuestions } from "./questions.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public")));

app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });
    const n = Math.min(20, Math.max(1, Number(req.query.lines) || 5));
    const { title, pages } = await extractPages(req.file.buffer);
    if (!pages.length || !pages.some((page) => page.length)) {
      return res.status(422).json({ error: "No text found. Scanned PDFs need OCR first." });
    }

    const pageChunks = chunkPages(pages, n);
    const chunks = pageChunks.flatMap((page) => page.chunks);
    res.json({ title, chunks, pages: pageChunks });
  } catch (e) {
    res.status(500).json({ error: `Could not read PDF: ${(e as Error).message}` });
  }
});

app.post("/api/questions", async (req, res) => {
  try {
    const text = String(req.body?.text ?? "").slice(0, 4000);
    if (!text.trim()) return res.status(400).json({ error: "Empty passage" });
    res.json({ questions: await makeQuestions(text) });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Reading coach on http://localhost:${port} (open in Chrome)`));

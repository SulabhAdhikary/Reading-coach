import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { clarity, type Clarity } from "../shared/align.js";

interface Q { q: string; options: string[]; answerIndex: number; explanation: string }
interface Part { clarity: number; correct: number; total: number }
interface PageChunkInfo { page: number; chunks: string[]; start: number }

const qCache = new Map<number, Promise<Q[]>>();

function fetchQuestionsForChunk(chunks: string[], idx: number): Promise<Q[]> {
  if (!qCache.has(idx)) {
    const p = fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: chunks[idx] }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to make questions");
      return j.questions as Q[];
    });
    p.catch(() => qCache.delete(idx));
    qCache.set(idx, p);
  }
  return qCache.get(idx)!;
}

function startListening() {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) throw new Error("Speech recognition isn't supported in this browser. Use Chrome or Edge.");

  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  let finals = "";
  let interim = "";
  let active = true;
  let onDone: (t: string) => void = () => {};

  rec.onresult = (e: any) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finals += " " + r[0].transcript;
      else interim += " " + r[0].transcript;
    }
  };

  rec.onend = () => {
    if (active) {
      try { rec.start(); } catch {}
    } else {
      onDone((finals + " " + interim).trim());
    }
  };

  rec.start();

  return {
    stop: () => new Promise<string>((resolve) => {
      active = false;
      onDone = resolve;
      rec.stop();
      setTimeout(() => resolve((finals + " " + interim).trim()), 2000);
    }),
  };
}

function Passage({ text, result }: { text: string; result?: Clarity }) {
  const lines = text.split("\n");
  let wordIndex = 0;

  return (
    <div className="passage">
      {lines.map((line, lineIndex) => (
        <div key={lineIndex}>
          {line.split(/\s+/).filter(Boolean).map((token, tokenIndex) => {
            const ok = result ? result.words[wordIndex]?.ok !== false : true;
            wordIndex += 1;
            return (
              <React.Fragment key={`${lineIndex}-${tokenIndex}`}>
                <span className={result ? (ok ? "ok" : "miss") : undefined}>{token}</span>{" "}
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function UploadScreen({
  fileName,
  linesPerPart,
  loading,
  status,
  onFileChange,
  onLinesChange,
  onUpload,
}: {
  fileName: string;
  linesPerPart: number;
  loading: boolean;
  status: string;
  onFileChange: (fileName: string) => void;
  onLinesChange: (value: number) => void;
  onUpload: () => void;
}) {
  return (
    <div className="card">
      <h2>Upload a PDF</h2>
      <input
        type="file"
        id="pdf-upload"
        accept="application/pdf"
        onChange={(e) => onFileChange(e.target.files?.[0]?.name ?? "")}
      />
      <p className="muted">
        Lines per part:{" "}
        <input
          type="number"
          min={1}
          max={20}
          value={linesPerPart}
          onChange={(e) => onLinesChange(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          style={{ width: "4em" }}
        />
      </p>
      <button className="big" onClick={onUpload} disabled={loading || !fileName}>Start</button>
      {status && <p className="muted">{status}</p>}
    </div>
  );
}

function ReadScreen({
  idx,
  chunks,
  pages,
  pageIndex,
  status,
  loading,
  isRecording,
  onPageSelect,
  onPrevChunk,
  onNextChunk,
  onPrevPage,
  onNextPage,
  onStart,
  onStop,
}: {
  idx: number;
  chunks: string[];
  pages: { page: number; chunks: string[]; start: number }[];
  pageIndex: number;
  status: string;
  loading: boolean;
  isRecording: boolean;
  onPageSelect: (pageIndex: number) => void;
  onPrevChunk: () => void;
  onNextChunk: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const currentChunk = chunks[idx] ?? "";
  const pageLabel = pages.length ? `Page ${pages[pageIndex].page}` : "Page 1";

  return (
    <>
      <p className="muted">Part {idx + 1} of {chunks.length}</p>
      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <label className="muted" htmlFor="page-select">Page</label>
          <select id="page-select" value={pageIndex} onChange={(e) => onPageSelect(Number(e.target.value))}>
            {pages.map((page) => (
              <option key={page.page} value={page.page - 1}>{page.page}</option>
            ))}
          </select>
          <span className="muted">{pageLabel}</span>
        </div>
        <Passage text={currentChunk} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="alt" onClick={onPrevChunk}>← Previous</button>
        <button className="alt" onClick={onNextChunk}>Next →</button>
        <button className="alt" onClick={onPrevPage}>|&lt; Previous page</button>
        <button className="alt" onClick={onNextPage}>|&gt; Next page</button>
      </div>
      <button className={isRecording ? "big rec" : "big"} onClick={isRecording ? onStop : onStart} disabled={loading}>
        {isRecording ? "⏹ I’m done" : "🎤 Start reading"}
      </button>
      <p className="muted">{status}</p>
    </>
  );
}

function ResultScreen({
  currentChunk,
  result,
  heard,
  onRetry,
  onNext,
}: {
  currentChunk: string;
  result: Clarity;
  heard: string;
  onRetry: () => void;
  onNext: () => void;
}) {
  const resultMessage = !heard
    ? "I couldn't hear anything. Check the microphone permission and try again."
    : result.percent >= 90 ? "Great, clear reading! 🌟"
    : result.percent >= 70 ? "Good! Try the red words again, nice and clear."
    : "Let's try again, a little slower and louder.";

  return (
    <>
      <div className="card">
        <Passage text={currentChunk} result={result} />
      </div>
      <div className="score">Clarity {result.percent}%</div>
      <p>{resultMessage}</p>
      <button className="alt" onClick={onRetry}>Read again</button>
      <button onClick={onNext}>Questions →</button>
      <details>
        <summary className="muted">What the computer heard</summary>
        <p>{heard || "(nothing)"}</p>
      </details>
    </>
  );
}

function QuizScreen({
  currentChunk,
  questions,
  onFinish,
}: {
  currentChunk: string;
  questions: Q[];
  onFinish: (correct: number, total: number) => void;
}) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [answered, setAnswered] = useState(false);

  if (!questions.length) {
    return <p className="muted">Making questions…</p>;
  }

  const question = questions[questionIndex];
  if (!question) {
    onFinish(correctCount, questions.length);
    return null;
  }

  const handleAnswer = (optionIndex: number) => {
    if (answered) return;
    setAnswered(true);

    if (optionIndex === question.answerIndex) {
      setCorrectCount((value) => value + 1);
      setFeedback(`✅ Correct! ${question.explanation}`);
      return;
    }

    setFeedback(`Not quite. ${question.explanation}`);
  };

  return (
    <>
      <p className="muted">Question {questionIndex + 1} of {questions.length}</p>
      <div className="card">
        <Passage text={currentChunk} />
      </div>
      <h2>{question.q}</h2>
      {question.options.map((option, optionIndex) => (
        <button
          key={option}
          className={answered ? (optionIndex === question.answerIndex ? "opt right" : "opt") : "opt"}
          onClick={() => handleAnswer(optionIndex)}
          disabled={answered}
        >
          {option}
        </button>
      ))}
      {feedback && <p>{feedback}</p>}
      {feedback && (
        <button
          onClick={() => {
            if (questionIndex + 1 >= questions.length) {
              onFinish(correctCount, questions.length);
              return;
            }
            setQuestionIndex((value) => value + 1);
            setAnswered(false);
            setFeedback("");
          }}
        >
          {questionIndex + 1 < questions.length ? "Next →" : "Finish"}
        </button>
      )}
    </>
  );
}

function SummaryScreen({
  parts,
  idx,
  chunks,
  onNewPdf,
  onNextPart,
}: {
  parts: Part[];
  idx: number;
  chunks: string[];
  onNewPdf: () => void;
  onNextPart: () => void;
}) {
  const done = parts.filter(Boolean);
  const avg = done.length ? Math.round(done.reduce((sum, p) => sum + p.clarity, 0) / done.length) : 0;
  const correct = done.reduce((sum, p) => sum + p.correct, 0);
  const total = done.reduce((sum, p) => sum + p.total, 0);
  const isLast = idx + 1 >= chunks.length;

  return (
    <>
      <div className="card">
        <div className="score">Clarity {avg}% · Comprehension {total ? Math.round((100 * correct) / total) : 0}%</div>
        <table>
          <tbody>
            <tr>
              <th>Part</th>
              <th>Clarity</th>
              <th>Questions</th>
            </tr>
            {done.map((p, i) => (
              <tr key={`summary-${i}`}>
                <td>{i + 1}</td>
                <td>{p.clarity}%</td>
                <td>{p.correct}/{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isLast ? (
        <button onClick={onNewPdf}>New PDF</button>
      ) : (
        <button onClick={onNextPart}>Next part →</button>
      )}
    </>
  );
}

function App() {
  const [title, setTitle] = useState("");
  const [chunks, setChunks] = useState<string[]>([]);
  const [pages, setPages] = useState<{ page: number; chunks: string[] }[]>([]);
  const [idx, setIdx] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [lastClarity, setLastClarity] = useState(0);
  const [screen, setScreen] = useState<"upload" | "read" | "result" | "quiz" | "summary">("upload");
  const [fileName, setFileName] = useState("");
  const [linesPerPart, setLinesPerPart] = useState(5);
  const [status, setStatus] = useState("Press the button, then read the lines out loud.");
  const [result, setResult] = useState<Clarity | null>(null);
  const [heard, setHeard] = useState("");
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState<Q[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const sessionRef = useRef<{ stop: () => Promise<string> } | null>(null);

  const pageMeta = useMemo<PageChunkInfo[]>(() => {
    let start = 0;
    return pages.map((page) => {
      const info = { ...page, start } as PageChunkInfo;
      start += page.chunks.length;
      return info;
    });
  }, [pages]);

  const currentPageIndex = useMemo(() => {
    if (!pageMeta.length) return 0;
    for (let i = 0; i < pageMeta.length; i++) {
      if (idx >= pageMeta[i].start && idx < pageMeta[i].start + pageMeta[i].chunks.length) return i;
    }
    return Math.min(pageMeta.length - 1, Math.max(0, pageMeta.length - 1));
  }, [idx, pageMeta]);

  const currentChunk = chunks[idx] ?? "";

  const resetReadState = () => {
    setResult(null);
    setHeard("");
    setQuiz([]);
    setStatus("Press the button, then read the lines out loud.");
    setIsRecording(false);
    sessionRef.current = null;
  };

  const goToPage = (pageNum: number) => {
    const page = pageMeta.find((p) => p.page === pageNum);
    if (!page) return;
    setIdx(page.start);
    resetReadState();
    setScreen("read");
  };

  const goToNextChunk = () => {
    if (idx + 1 >= chunks.length) return;
    setIdx((value) => value + 1);
    resetReadState();
    setScreen("read");
  };

  const goToNextPage = () => {
    const nextPageIndex = Math.min(pageMeta.length - 1, currentPageIndex + 1);
    if (nextPageIndex === currentPageIndex) return;
    setIdx(pageMeta[nextPageIndex].start);
    resetReadState();
    setScreen("read");
  };

  const goToPreviousChunk = () => {
    if (idx === 0) return;
    setIdx((value) => value - 1);
    resetReadState();
    setScreen("read");
  };

  const goToPreviousPage = () => {
    const prevPageIndex = Math.max(0, currentPageIndex - 1);
    if (prevPageIndex === currentPageIndex) return;
    setIdx(pageMeta[prevPageIndex].start);
    resetReadState();
    setScreen("read");
  };

  const uploadPdf = async (file: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("pdf", file);
    setLoading(true);
    setStatus("Reading the PDF…");

    try {
      const response = await fetch(`/api/upload?lines=${linesPerPart}`, { method: "POST", body: fd });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Upload failed");
      qCache.clear();
      setTitle(json.title ?? "");
      setChunks(json.chunks ?? []);
      setPages((json.pages ?? []).map((page: { page: number; chunks: string[] }, index: number) => ({ ...page, page: page.page ?? index + 1 })));
      setIdx(0);
      setParts([]);
      setLastClarity(0);
      resetReadState();
      setScreen("read");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const beginListening = async () => {
    if (isRecording) return;
    try {
      sessionRef.current = startListening();
      setIsRecording(true);
      setStatus("Listening… read out loud");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const stopListening = async () => {
    if (!sessionRef.current) return;
    setLoading(true);
    setStatus("Checking…");
    const transcript = await sessionRef.current.stop();
    const score = clarity(currentChunk, transcript);
    setResult(score);
    setHeard(transcript);
    setLastClarity(score.percent);
    setIsRecording(false);
    setScreen("result");
    setLoading(false);
  };

  const handleUploadClick = async () => {
    const input = document.getElementById("pdf-upload") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (file) await uploadPdf(file);
  };

  const goToQuiz = async () => {
    setScreen("quiz");
    setQuiz([]);
    setStatus("Making questions…");

    const fetched = await fetchQuestionsForChunk(chunks, idx).catch(() => [] as Q[]);
    setQuiz(fetched);
    setStatus("");
  };

  const finishPart = (correct: number, total: number) => {
    const nextParts = [...parts];
    nextParts[idx] = { clarity: lastClarity, correct, total };
    setParts(nextParts);

    const isLast = idx + 1 >= chunks.length;
    if (isLast) {
      setScreen("summary");
      return;
    }

    setIdx((value) => value + 1);
    resetReadState();
    setScreen("read");
  };

  const newPdf = () => {
    setChunks([]);
    setPages([]);
    setFileName("");
    setParts([]);
    setIdx(0);
    setLastClarity(0);
    setScreen("upload");
    setStatus("");
    setQuiz([]);
    setResult(null);
    setHeard("");
    setIsRecording(false);
    sessionRef.current = null;
  };

  const renderScreen = () => {
    switch (screen) {
      case "upload":
        return (
          <UploadScreen
            fileName={fileName}
            linesPerPart={linesPerPart}
            loading={loading}
            status={status}
            onFileChange={(name) => setFileName(name)}
            onLinesChange={(value) => setLinesPerPart(value)}
            onUpload={() => {
              const input = document.getElementById("pdf-upload") as HTMLInputElement | null;
              const file = input?.files?.[0];
              if (file) void uploadPdf(file);
            }}
          />
        );
      case "read":
        return (
          <ReadScreen
            idx={idx}
            chunks={chunks}
            pages={pageMeta}
            pageIndex={currentPageIndex}
            status={status}
            loading={loading}
            isRecording={isRecording}
            onPageSelect={(selectedPageIndex) => goToPage(pageMeta[selectedPageIndex]?.page ?? 1)}
            onPrevChunk={goToPreviousChunk}
            onNextChunk={goToNextChunk}
            onPrevPage={goToPreviousPage}
            onNextPage={goToNextPage}
            onStart={beginListening}
            onStop={stopListening}
          />
        );
      case "result":
        return result ? (
          <ResultScreen
            currentChunk={currentChunk}
            result={result}
            heard={heard}
            onRetry={() => {
              resetReadState();
              setScreen("read");
            }}
            onNext={goToQuiz}
          />
        ) : null;
      case "quiz":
        return <QuizScreen currentChunk={currentChunk} questions={quiz} onFinish={finishPart} />;
      case "summary":
        return (
          <SummaryScreen
            parts={parts}
            idx={idx}
            chunks={chunks}
            onNewPdf={newPdf}
            onNextPart={() => {
              setIdx((value) => value + 1);
              resetReadState();
              setScreen("read");
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      {title && <h1 style={{ marginBottom: 12 }}>{title}</h1>}
      {renderScreen()}
    </>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(<App />);

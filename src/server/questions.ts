export interface Question { q: string; options: string[]; answerIndex: number; explanation: string }

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

const SYSTEM = `You write reading-comprehension questions for a 9-year-old child.
Given a short passage (it may start or end mid-sentence; only ask about what is clear), write exactly 3 multiple-choice questions.
Rules: answerable only from the passage; mostly literal (who/what/where/when) plus one simple "why" if possible; short, plain wording; 3 options each with exactly one correct; wrong options plausible but clearly wrong from the text; never copy the answer into the question.
Reply ONLY with JSON: {"questions":[{"q":"...","options":["...","...","..."],"answerIndex":0,"explanation":"one short sentence"}]}`;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function makeChoices(correct: string, pool: string[]): string[] {
  const extras = pool.filter((item) => item && item !== correct);
  const picked = extras.slice(0, 2);
  const result = [correct, ...picked];
  if (result.length < 3) {
    const filler = ["the school", "the garden", "the river", "the playground", "the library"];
    for (const value of filler) {
      if (!result.includes(value)) result.push(value);
      if (result.length === 3) break;
    }
  }
  return shuffle(result).slice(0, 3);
}

function buildQuestion(q: string, correct: string, distractors: string[], explanation: string): Question {
  const options = shuffle([correct, ...distractors.filter((item) => item && item !== correct).slice(0, 2)]);
  if (options.length < 3) {
    const filler = ["the school", "the garden", "the river", "the playground", "the library"];
    for (const value of filler) {
      if (!options.includes(value)) options.push(value);
      if (options.length === 3) break;
    }
  }
  const safeOptions = options.slice(0, 3);
  return {
    q,
    options: safeOptions,
    answerIndex: safeOptions.indexOf(correct),
    explanation,
  };
}

function fallbackQuestions(passage: string): Question[] {
  const text = passage.replace(/\s+/g, " ").trim();
  if (!text) {
    return [
      { q: "What is this passage about?", options: ["a story", "a game", "a planet"], answerIndex: 0, explanation: "The passage gives a short idea about the topic." },
    ];
  }

  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const main = sentences[0] ?? text;
  const lowerMain = main.toLowerCase();
  const words = (main.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? []).filter((word) => !/^(the|and|with|from|into|that|this|they|them|were|was|have|has|for|but|not|you|your|our|about|because|while|after|before|when|where|what|who|why|how|then|there|their|its|it|is|are|on|at|in|to|of|a|an|as|be|by|or|if|so)$/i.test(word));

  const topic = words[0] ? words.slice(0, 3).join(" ") : "the story";
  const subject = /^[A-Z]/.test(main) ? main.match(/[A-Z][A-Za-z'-]+/g)?.[0] ?? words[0] ?? "the child" : words[0] ?? "the child";
  const location = main.match(/\b(?:in|at|on|under|behind|next to|near|inside)\s+([A-Za-z0-9' -]+)/i)?.[0] ?? "the school";
  const reason = main.match(/because\s+([^.!?]+)/i)?.[1]?.trim() ?? "to help everyone learn";

  const questions: Question[] = [];
  questions.push(buildQuestion(
    "What is the passage mostly about?",
    topic,
    [words[1] ?? "the child", words[2] ?? "the school", "the adventure", "the classroom"],
    "It tells the main idea of the passage."
  ));

  questions.push(buildQuestion(
    "Who is the story mostly about?",
    subject,
    ["a dragon", "the teacher", "the family", "the dog", words[1] ?? "the friend"],
    "The passage focuses on this person or character."
  ));

  questions.push(buildQuestion(
    "Where does the event happen?",
    location,
    ["the river", "the moon", "the playground", "the library", words[2] ?? "the garden"],
    "The passage tells us where the action takes place."
  ));

  if (/\bwhy\b|because\b/i.test(lowerMain)) {
    questions.push(buildQuestion(
      "Why did the action happen?",
      reason,
      ["to play a game", "because it was night", "to make a surprise", "because the class was quiet"],
      "The passage gives the reason for what happened."
    ));
  }

  return questions.slice(0, 3);
}

export async function makeQuestions(passage: string): Promise<Question[]> {
  const fallback = () => fallbackQuestions(passage);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0.3 },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: passage }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) throw new Error(`Ollama error ${r.status}`);
    const data = (await r.json()) as { message: { content: string } };
    const raw = JSON.parse(data.message.content)?.questions;
    if (!Array.isArray(raw)) throw new Error("Model returned no questions");

    const out: Question[] = [];
    for (const x of raw) {
      if (typeof x?.q !== "string" || !Array.isArray(x.options) || x.options.length < 3) continue;
      if (!Number.isInteger(x.answerIndex) || x.answerIndex < 0 || x.answerIndex >= x.options.length) continue;
      const right = String(x.options[x.answerIndex]);
      const options = shuffle<string>(x.options.map(String));
      out.push({ q: x.q, options, answerIndex: options.indexOf(right), explanation: String(x.explanation ?? "") });
    }

    if (!out.length) throw new Error("Model questions were malformed, try again");
    return out;
  } catch {
    return fallback();
  }
}

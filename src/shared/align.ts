// Compares what the child was supposed to read with what the recogniser heard.
export interface WordResult { token: string; ok: boolean }
export interface Clarity { percent: number; words: WordResult[] }

const words = (s: string): string[] =>
  s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]|_/gu, " ").split(/\s+/).filter(Boolean);

/** Longest-common-subsequence alignment: expected words found (in order) in the transcript count as clear. */
export function clarity(passage: string, heard: string): Clarity {
  const tokens = passage.split(/\s+/).filter(Boolean);
  const exp: { w: string; t: number }[] = [];
  tokens.forEach((tok, t) => words(tok).forEach((w) => exp.push({ w, t })));
  const hrd = words(heard);
  const n = exp.length, m = hrd.length;

  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = exp[i - 1].w === hrd[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const hit = new Array<boolean>(n).fill(false);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (exp[i - 1].w === hrd[j - 1]) { hit[i - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }

  const ok = tokens.map(() => true);
  exp.forEach((e, k) => { if (!hit[k]) ok[e.t] = false; });
  const matched = hit.filter(Boolean).length;
  return {
    percent: n ? Math.round((100 * matched) / n) : 0,
    words: tokens.map((token, k) => ({ token, ok: ok[k] })),
  };
}

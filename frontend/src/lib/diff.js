/**
 * Normalizes text and strips citation markers like [1], [2] before diffing.
 * Also cleans up stray whitespace before punctuation caused by citation removal.
 */
export function stripCitations(text) {
  if (!text) return "";
  return text
    .replace(/\[\d+\]/g, "")
    .replace(/\s+([,.:;!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Tokenizes text into word tokens and whitespace tokens, keeping punctuation
 * attached to its word and citations like [1] as individual tokens.
 *
 * e.g. "Python 3.11, and [1]" -> ["Python", " ", "3.11,", " ", "and", " ", "[1]"]
 */
export function tokenize(text) {
  if (!text) return [];
  // Normalize stray spaces before punctuation: "3.15 , [1]" -> "3.15, [1]"
  const normalized = text.replace(/([^\s[])\s+([,.:;!?])/g, "$1$2");
  return normalized.match(/\[\d+\]|\S+|\s+/g) || [];
}

/**
 * Tokenizes into words (non-whitespace) while capturing preceding whitespace.
 */
function toWordTokens(str) {
  const raw = str.match(/\[\d+\]|\S+|\s+/g) || [];
  const words = [];
  let space = "";
  for (const t of raw) {
    if (/^\s+$/.test(t)) {
      space += t;
    } else {
      words.push({ text: t, preSpace: space });
      space = "";
    }
  }
  return { words, trailingSpace: space };
}

/**
 * Computes an LCS word-level diff between origText and newText.
 * Citations are stripped from newText before diffing so they do not produce noisy del/add tokens.
 * Adjacent removed and added runs are merged into one del + one ins.
 * Unchanged words are returned as { type: "same", text: ... } to render as plain text.
 */
export function computeWordDiff(origText, newText) {
  const origClean = (origText || "").trim();
  const newClean = stripCitations(newText || "");

  if (!origClean && !newClean) return [];
  if (!origClean) return [{ type: "add", text: newClean }];
  if (!newClean) return [{ type: "del", text: origClean }];

  const { words: w1 } = toWordTokens(origClean);
  const { words: w2 } = toWordTokens(newClean);

  const n = w1.length;
  const m = w2.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (w1[i].text === w2[j].text) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = n, j = m;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && w1[i - 1].text === w2[j - 1].text) {
      ops.push({ type: "same", item1: w1[i - 1], item2: w2[j - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", item2: w2[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({ type: "del", item1: w1[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // Merge adjacent del / add runs into one del + one ins
  const merged = [];
  let delBuffer = [];
  let addBuffer = [];

  const flush = () => {
    if (delBuffer.length === 0 && addBuffer.length === 0) return;

    if (delBuffer.length > 0) {
      const delText = delBuffer.map((w, idx) => (idx === 0 ? w.text : (w.preSpace || " ") + w.text)).join("");
      merged.push({ type: "del", text: delText, preSpace: delBuffer[0].preSpace });
      delBuffer = [];
    }
    if (addBuffer.length > 0) {
      const addText = addBuffer.map((w, idx) => (idx === 0 ? w.text : (w.preSpace || " ") + w.text)).join("");
      merged.push({ type: "add", text: addText, preSpace: addBuffer[0].preSpace });
      addBuffer = [];
    }
  };

  for (const op of ops) {
    if (op.type === "same") {
      flush();
      const text = (op.item2.preSpace || (merged.length > 0 ? " " : "")) + op.item2.text;
      if (merged.length > 0 && merged[merged.length - 1].type === "same") {
        merged[merged.length - 1].text += text;
      } else {
        merged.push({ type: "same", text });
      }
    } else if (op.type === "del") {
      delBuffer.push(op.item1);
    } else if (op.type === "add") {
      addBuffer.push(op.item2);
    }
  }
  flush();

  return merged;
}

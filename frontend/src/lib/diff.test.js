import { tokenize, stripCitations, computeWordDiff } from "./diff";

describe("diff tokenizer", () => {
  test("punctuation sticks to its word", () => {
    const tokens = tokenize("Python 3.11, is latest. Version 14 vs version");
    expect(tokens).toContain("3.11,");
    expect(tokens).toContain("latest.");
    expect(tokens).toContain("version");
    expect(tokens).not.toContain(",");
    expect(tokens).not.toContain(".");
  });

  test("citation like [1] stays one token", () => {
    const tokens = tokenize("Python 3.15 [1], and React 19 [2].");
    expect(tokens).toContain("[1]");
    expect(tokens).toContain("[2]");
  });

  test("normalizes stray space before punctuation around citations", () => {
    const tokens = tokenize("3.15.2 , [1] , version.");
    expect(tokens).toContain("3.15.2,");
    expect(tokens).toContain("[1]");
    expect(tokens).toContain("version.");
  });

  test("stripCitations removes citation markers and collapses spaces before punctuation", () => {
    const raw = "The latest stable version of Python is 3.15 [1], and React 19 [2]. Next.js 16 [3].";
    const cleaned = stripCitations(raw);
    expect(cleaned).toBe("The latest stable version of Python is 3.15, and React 19. Next.js 16.");
    expect(cleaned).not.toContain("[1]");
    expect(cleaned).not.toContain(" ,");
    expect(cleaned).not.toContain(" .");
  });
});

describe("computeWordDiff (LCS word diff)", () => {
  test("replaces version with punctuation cleanly and marks unchanged words as same", () => {
    const orig = "The latest stable version of Python is 3.11, and React 18 is current.";
    const rewritten = "The latest stable version of Python is 3.15 [1], and React 19 [2] is current.";
    const diff = computeWordDiff(orig, rewritten);

    const dels = diff.filter((d) => d.type === "del").map((d) => d.text);
    const adds = diff.filter((d) => d.type === "add").map((d) => d.text);
    const sames = diff.filter((d) => d.type === "same").map((d) => d.text);

    expect(dels).toContain("3.11,");
    expect(adds).toContain("3.15,");
    expect(dels).toContain("18");
    expect(adds).toContain("19");

    // Unchanged words render as plain text ('same')
    expect(sames.some((t) => t.includes("The latest stable version of Python is"))).toBe(true);
    expect(sames.some((t) => t.includes("and React"))).toBe(true);
    expect(sames.some((t) => t.includes("is current."))).toBe(true);
  });

  test("merges adjacent removed/added runs into one del + one ins", () => {
    const orig = "Next.js 13 introduced the App Router and is the current major version.";
    const rewritten = "Next.js 13 introduced the App Router but 16 is now current [3].";
    const diff = computeWordDiff(orig, rewritten);

    // Verify adjacent removals and additions are merged and not fragmented word-by-word
    const delCount = diff.filter((d) => d.type === "del").length;
    const addCount = diff.filter((d) => d.type === "add").length;
    expect(delCount).toBeLessThanOrEqual(2);
    expect(addCount).toBeLessThanOrEqual(2);

    // Common prefix is plain text
    expect(diff[0].type).toBe("same");
    expect(diff[0].text).toContain("Next.js 13 introduced the App Router");
  });

  test("identical text produces a single same block", () => {
    const text = "All facts in this answer are completely current.";
    const diff = computeWordDiff(text, text);
    expect(diff).toHaveLength(1);
    expect(diff[0].type).toBe("same");
    expect(diff[0].text).toBe(text);
  });
});

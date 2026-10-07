export function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.max(0, maxChars - head - 80);
  return {
    truncated: true,
    text: `${text.slice(0, head)}\n\n…[truncated ${text.length - head - tail} characters]…\n\n${text.slice(-tail)}`,
  };
}

export function sliceLines(
  content: string,
  offset = 1,
  limit = 2000,
): { text: string; startLine: number; numLines: number; totalLines: number; truncated: boolean } {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = Math.max(1, offset);
  const startIndex = start - 1;
  const selected = lines.slice(startIndex, startIndex + limit);
  const numbered = selected
    .map((line, index) => `${String(startIndex + index + 1).padStart(6, " ")}|${line}`)
    .join("\n");
  return {
    text: numbered,
    startLine: start,
    numLines: selected.length,
    totalLines,
    truncated: startIndex + selected.length < totalLines,
  };
}

export function hashContent(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

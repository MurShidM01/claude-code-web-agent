import { createTwoFilesPatch, structuredPatch } from "diff";

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface BuiltDiff {
  patch: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export function buildDiff(filePath: string, before: string, after: string): BuiltDiff {
  const structured = structuredPatch(filePath, filePath, before, after, "", "", { context: 3 });
  let additions = 0;
  let deletions = 0;
  const hunks: DiffHunk[] = structured.hunks.map((hunk) => {
    for (const line of hunk.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines,
    };
  });
  const patch = createTwoFilesPatch(filePath, filePath, before, after, "", "", { context: 3 });
  return { patch, hunks, additions, deletions };
}

export function applyReplacement(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { ok: true; content: string; count: number } | { ok: false; message: string } {
  if (oldString === newString) {
    return { ok: false, message: "old_string and new_string are identical. Nothing to change." };
  }
  if (!oldString) {
    return { ok: false, message: "old_string is empty. Use Write to create or replace a whole file." };
  }
  const count = content.split(oldString).length - 1;
  if (count === 0) {
    return {
      ok: false,
      message:
        "old_string was not found. Read the file again and copy the exact text, including whitespace.",
    };
  }
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      message: `old_string matched ${count} times. Provide more surrounding context, or set replace_all.`,
    };
  }
  const next = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
  return { ok: true, content: next, count: replaceAll ? count : 1 };
}

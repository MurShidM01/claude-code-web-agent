import { describe, expect, it } from "vitest";
import { matchGlob, PathEscapeError, resolveInRoot } from "@/lib/workspace/path";

describe("workspace paths", () => {
  it("keeps relative paths inside the root", () => {
    expect(resolveInRoot("/work/app", "src/index.ts")).toBe("/work/app/src/index.ts");
    expect(resolveInRoot("/work/app", ".")).toBe("/work/app");
  });

  it("rejects traversal", () => {
    expect(() => resolveInRoot("/work/app", "../secret")).toThrow(PathEscapeError);
    expect(() => resolveInRoot("/work/app", "/etc/passwd")).toThrow(PathEscapeError);
  });

  it("matches globs without shelling out", () => {
    expect(matchGlob("src/**/*.ts", "src/lib/app.ts")).toBe(true);
    expect(matchGlob("*.md", "README.md")).toBe(true);
    expect(matchGlob("src/**/*.ts", "README.md")).toBe(false);
  });
});

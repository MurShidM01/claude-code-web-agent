import { describe, expect, it } from "vitest";
import { paramSchema } from "@/lib/protocol/schema";
import { applyReplacement, buildDiff } from "@/lib/tools/diff";
import { createToolRegistry } from "@/lib/tools/builtins";
import { TOOL_SPECS } from "@/lib/tools/schemas";

describe("tool schemas", () => {
  it("exposes a name, description, and JSON schema for every tool", () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.name).toBeTruthy();
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.parameters).toMatchObject({ type: "object" });
    }
    const names = TOOL_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "TodoWrite"]));
  });

  it("registers the same tools the model is offered", () => {
    const registry = createToolRegistry();
    expect(registry.specs().map((spec) => spec.name).sort()).toEqual(TOOL_SPECS.map((spec) => spec.name).sort());
  });

  it("rejects a command that exceeds the bridge schema", () => {
    expect(() => paramSchema.runCommand.parse({ command: "" })).toThrow();
    expect(paramSchema.readFile.parse({ path: "src/app.ts", offset: 1, limit: 20 })).toMatchObject({ path: "src/app.ts" });
  });

  it("applies a unique replacement and builds a diff", () => {
    const applied = applyReplacement("const a = 1;\nconst b = 2;\n", "const b = 2;", "const b = 3;", false);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const diff = buildDiff("src/app.ts", "const a = 1;\nconst b = 2;\n", applied.content);
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.patch).toContain("src/app.ts");
  });

  it("refuses an ambiguous edit", () => {
    const applied = applyReplacement("a\na\n", "a", "b", false);
    expect(applied.ok).toBe(false);
  });
});

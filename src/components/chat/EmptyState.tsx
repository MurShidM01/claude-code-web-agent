"use client";

const EXAMPLES = [
  { title: "Explain this project", detail: "Map the structure and the files worth reading first.", prompt: "Explain how this project is structured and which files I should read first." },
  { title: "Find and fix a bug", detail: "Inspect the code, change it, and run the tests.", prompt: "Find the bug in the sample math module, fix it, and run the tests." },
  { title: "Review uncommitted work", detail: "Look at git status and the diff before suggesting anything.", prompt: "Review the uncommitted changes and summarize the risk." },
  { title: "Add validation", detail: "Plan briefly, then implement and show the diff.", prompt: "Add input validation to the public functions and show me the diff." },
];

export function EmptyState() {
  return (
    <div className="empty">
      <h2>What should we change?</h2>
      <p className="lede">Kiln inspects the project you connect, then edits files and runs commands through a local bridge. It does not pretend the browser can control the machine on its own.</p>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button
            key={example.title}
            type="button"
            className="example"
            onClick={() => window.dispatchEvent(new CustomEvent("kiln:fill", { detail: example.prompt }))}
          >
            {example.title}
            <small>{example.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("javascript", typescript);
hljs.registerLanguage("js", typescript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

export function balanceFences(text: string): string {
  const fences = text.match(/```/g)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

export function MarkdownView({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const source = streaming ? balanceFences(text) : text;
  return (
    <div className="prose assistant">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { hljs, detect: true }]]}
        components={{
          pre({ children }) {
            return <Pre>{children}</Pre>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
      {streaming ? <span className="phase live" aria-hidden> </span> : null}
    </div>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre>
      <button
        type="button"
        className="copy"
        onClick={(event) => {
          const text = (event.currentTarget.parentElement?.innerText ?? "").replace(/^Copy$|^Copied$/, "").trim();
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {children}
    </pre>
  );
}

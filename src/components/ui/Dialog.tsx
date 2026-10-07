"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  title,
  children,
  onClose,
  labelledBy = "dialog-title",
  wide = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose?: () => void;
  labelledBy?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /* Callers pass an inline handler. Keeping it in a ref stops this effect from
     re-running on every parent render, which used to yank focus back to the
     first control after each keystroke. */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const previously = document.activeElement as HTMLElement | null;
    const target = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node;
    target?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button, [href], input, textarea, [tabindex]:not([tabindex='-1'])")];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previously?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <h3 id={labelledBy}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

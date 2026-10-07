"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  title,
  children,
  onClose,
  labelledBy = "dialog-title",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose?: () => void;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const previously = document.activeElement as HTMLElement | null;
    const focusable = node?.querySelector<HTMLElement>("button, [href], input, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
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
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <h3 id={labelledBy}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

"use client";

import { AlertDialog } from "@/components/ui/AlertDialog";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <AlertDialog
      open
      title="Kiln hit an unexpected error"
      message={error.message}
      tone="danger"
      onClose={reset}
      actions={
        <button type="button" className="btn primary" data-autofocus onClick={reset}>
          Try again
        </button>
      }
    />
  );
}

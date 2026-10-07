"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="dialog" role="alert" style={{ margin: 24 }}>
      <h3>Kiln hit an unexpected error</h3>
      <p>{error.message}</p>
      <div className="dialog-actions">
        <button type="button" className="btn primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}

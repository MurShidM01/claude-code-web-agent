"use client";

import { Component, type ReactNode } from "react";
import { AlertDialog } from "@/components/ui/AlertDialog";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return (
      <>
        {this.state.error ? (
          <AlertDialog
            open
            title="Something in the interface failed"
            message={this.state.error.message}
            tone="danger"
            onClose={() => this.setState({ error: null })}
            actions={
              <button type="button" className="btn primary" data-autofocus onClick={() => this.setState({ error: null })}>
                Try again
              </button>
            }
          />
        ) : null}
        {this.props.children}
      </>
    );
  }
}

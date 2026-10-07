"use client";

import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="dialog" role="alert" style={{ margin: 24 }}>
        <h3>Something in the interface failed</h3>
        <p>{this.state.error.message}</p>
        <div className="dialog-actions">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

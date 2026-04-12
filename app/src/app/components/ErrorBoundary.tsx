"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="panel p-8 text-center">
            <div className="text-[var(--text-dim)] text-sm mb-2">Something went wrong</div>
            <div className="text-xs font-mono text-[var(--red)] mb-4">
              {this.state.error?.message || "Unknown error"}
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              This may be a devnet RPC issue. The Solana devnet can be unstable at times.
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-xs px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg transition"
            >
              Try Again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

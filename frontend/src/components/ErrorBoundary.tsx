import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="screen center">
        <div className="card fault">
          <h1 className="fault-title">Something broke</h1>
          <p className="fault-desc">
            The interface hit an unexpected error and was contained so the page stays responsive.
          </p>
          <pre className="fault-message">{this.state.message || 'Unknown render exception'}</pre>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

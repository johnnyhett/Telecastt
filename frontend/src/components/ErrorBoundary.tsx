import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidMount() {
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handlePromiseRejection);
  }

  public componentWillUnmount() {
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handlePromiseRejection);
  }

  private handleGlobalError = (event: ErrorEvent) => {
    this.setState({ hasError: true, error: event.error });
  };

  private handlePromiseRejection = (event: PromiseRejectionEvent) => {
    this.setState({ hasError: true, error: event.reason });
  };

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React Error Boundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#050505', color: 'white', padding: '2rem', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', color: '#ff4d4f', fontSize: '3rem', marginBottom: '1rem' }}>SYSTEM FAULT</h1>
          <p style={{ opacity: 0.7, maxWidth: '600px', lineHeight: '1.6' }}>
            The Telecastt engine encountered a fatal UI crash. This has been logged and contained to prevent the browser from freezing.
          </p>
          <div style={{ background: 'rgba(255,0,0,0.1)', padding: '1rem', borderRadius: '8px', marginTop: '2rem', fontFamily: 'monospace', color: '#ff4d4f' }}>
            {this.state.error?.message || 'Unknown render exception'}
          </div>
          <button 
            onClick={() => window.location.href = window.location.pathname}
            style={{ marginTop: '2rem', background: '#ff4d4f', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Reboot Engine
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

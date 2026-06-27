import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-fw-bg/50 p-4">
          <div className="flex flex-col items-center gap-2 max-w-[200px] text-center">
            <div className="w-8 h-8 rounded-lg bg-red-900/20 border border-red-800/30 flex items-center justify-center">
              <AlertTriangle size={16} className="text-red-400" />
            </div>
            <p className="text-[11px] font-medium text-fw-text-secondary">
              {this.props.fallbackTitle || 'Component Error'}
            </p>
            <p className="text-[9px] text-fw-text-muted">
              {this.state.error?.message?.slice(0, 80) || 'Something went wrong'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-1 flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-fw-accent bg-fw-accent/10 border border-fw-accent/20 rounded hover:bg-fw-accent/20 transition-colors"
            >
              <RefreshCw size={10} /> Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

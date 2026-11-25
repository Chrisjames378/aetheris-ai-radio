import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let display = error.message || 'An unexpected application error occurred.';
    try {
      const parsed = JSON.parse(display);
      if (parsed && typeof parsed.error === 'string') {
        display = `Cloud sync notice (${parsed.operationType || 'read'}): ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: display };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught UI error:', error, info);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0C0F] text-[#F1F3F5] flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-lg border border-red-500/40 bg-[#111419] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h1 className="font-display text-lg font-semibold text-[#F1F3F5]">
                  Workspace Recovery
                </h1>
                <p className="mt-1 text-sm text-red-200 break-words">
                  {this.state.message}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Resume Broadcast Console</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

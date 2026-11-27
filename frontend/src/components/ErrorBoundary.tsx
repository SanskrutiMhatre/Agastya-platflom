// WP-22 (FE-016): a render error in one page no longer unmounts the whole application. The shells wrap their page in this boundary: the
// navigation stays usable, and the panel offers to try again, to reload the page, and to copy the details for a support request. Unsaved work
// of the editors is kept by their own drafts (WP-05), so a reload offers it back.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; /** a new value (the address) clears the error: moving to another page tries again */ resetKey?: string; where?: string }
interface State { error: Error | null; stack: string; copied: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' });
    // the console keeps the full trace for whoever opens the developer tools
    console.error(`[${this.props.where ?? 'page'}]`, error);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: '', copied: false });
  }

  private details(): string {
    const e = this.state.error;
    return [`Page: ${location.pathname}${location.search}`, `Where: ${this.props.where ?? 'page'}`, `When: ${new Date().toISOString()}`, `Browser: ${navigator.userAgent}`,
      `Error: ${e?.name ?? 'Error'}: ${e?.message ?? ''}`, '', e?.stack ?? '', this.state.stack].join('\n');
  }

  private copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(this.details()); this.setState({ copied: true }); }
    catch { this.setState({ copied: false }); window.prompt('Copy the details:', this.details()); }
  };

  render(): ReactNode {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="v2-page" data-testid="error-boundary">
        <div className="v2-card v2-card-pad v2-errpanel" role="alert">
          <h2 style={{ marginTop: 0 }}>This page stopped working</h2>
          <p>Something on this page failed while it was being drawn. The rest of the application still works: use the navigation, try again, or reload the page. Unsaved editor changes are offered back after a reload.</p>
          <p className="v2-hint v2-mono" style={{ wordBreak: 'break-word' }}>{e.message || e.name}</p>
          <div className="v2-row wrap">
            <button className="btn btn-primary" onClick={() => this.setState({ error: null, stack: '', copied: false })} data-testid="error-retry">Try again</button>
            <button className="btn" onClick={() => location.reload()} data-testid="error-reload">Reload page</button>
            <button className="btn" onClick={() => void this.copy()} data-testid="error-copy">{this.state.copied ? 'Copied' : 'Copy details'}</button>
          </div>
        </div>
      </div>
    );
  }
}

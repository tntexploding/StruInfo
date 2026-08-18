import {Component, type ReactNode} from 'react';

interface ApplicationErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ApplicationErrorBoundaryState {
  readonly failed: boolean;
}

/** Keeps an unexpected workspace render failure from becoming a blank page. */
export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  public override state: ApplicationErrorBoundaryState = {failed: false};

  public static getDerivedStateFromError(): ApplicationErrorBoundaryState {
    return {failed: true};
  }

  public override render() {
    if (this.state.failed) return <ApplicationFailureFallback />;
    return this.props.children;
  }
}

export function ApplicationFailureFallback() {
  return (
    <main className="application-failure" role="alert">
      <section className="error-state">
        <p className="section-index">VISIBLE RECOVERY</p>
        <h1>界面未能继续显示</h1>
        <p>
          当前操作没有因此写入或删除资料。请重新载入界面；若问题仍在，可返回材料页重新打开该文档。
        </p>
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          重新载入
        </button>
      </section>
    </main>
  );
}

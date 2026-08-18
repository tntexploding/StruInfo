import type {ActionFeedback} from './product_types.js';

export function ActionNotice({
  feedback,
}: {
  readonly feedback?: ActionFeedback | undefined;
}) {
  if (feedback === undefined) return null;
  return (
    <div
      className="action-notice"
      data-kind={feedback.kind}
      role={feedback.kind === 'error' ? 'alert' : 'status'}
      aria-live={feedback.kind === 'success' ? 'polite' : undefined}
    >
      <strong>{feedback.title}</strong>
      <span>{feedback.detail}</span>
    </div>
  );
}

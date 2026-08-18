import {INTAKE_ACTION_LABELS} from '../components/product_labels.js';
import type {ReviewQueueCandidate} from './review_queue_model.js';

export interface ReviewQueueProps {
  readonly candidates: readonly Readonly<ReviewQueueCandidate>[];
  readonly onSelect: (key: string) => void;
  readonly selectedKey: string;
  readonly sourceKey?: string | undefined;
}

export function ReviewQueue({
  candidates,
  onSelect,
  selectedKey,
  sourceKey,
}: ReviewQueueProps) {
  const reviewedCount = candidates.filter(
    (candidate) => candidate.reviewed,
  ).length;
  const selectedIndex = candidates.findIndex(
    (candidate) => candidate.key === selectedKey,
  );

  return (
    <nav className="review-pagination" aria-label="审核条目分页">
      <header className="review-pagination__header">
        <p className="section-index">QUEUE</p>
        <strong>
          {reviewedCount.toString()}/{candidates.length.toString()}
        </strong>
        <span>已审核</span>
      </header>
      <progress
        aria-label={`已审核 ${reviewedCount.toString()}，共 ${candidates.length.toString()} 个条目`}
        max={Math.max(1, candidates.length)}
        value={reviewedCount}
      />
      {candidates.length === 0 ? (
        <p className="review-pagination__empty">打开一份含审核单元的材料</p>
      ) : (
        <ol className="review-pagination__list">
          {candidates.map((candidate, index) => {
            const label = candidate.reviewed
              ? INTAKE_ACTION_LABELS[candidate.action ?? 'needs_review']
              : '待审核';
            return (
              <li key={candidate.key}>
                <button
                  type="button"
                  data-active={candidate.key === selectedKey}
                  data-reviewed={candidate.reviewed}
                  aria-current={
                    candidate.key === selectedKey ? 'step' : undefined
                  }
                  aria-label={`条目 ${(index + 1).toString()}，${label}`}
                  title={`${candidate.label} · ${label}`}
                  onClick={() => {
                    onSelect(candidate.key);
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <i aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <footer className="review-pagination__footer">
        <span>{sourceKey ?? 'NO SOURCE'}</span>
        <strong>
          {selectedIndex < 0 ? '—' : String(selectedIndex + 1).padStart(2, '0')}
        </strong>
      </footer>
    </nav>
  );
}

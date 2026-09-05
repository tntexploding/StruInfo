import {useState} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import {
  FormalKnowledgeGraphWorkspace,
  type FormalKnowledgeGraphWorkspaceProps,
} from './formal_knowledge_graph_workspace.js';
import {InformationEntrySourceReviewWorkspace} from './information_entry_source_review_workspace.js';

export interface FormalKnowledgeWorkspaceProps extends FormalKnowledgeGraphWorkspaceProps {
  readonly onListSourceReviews: M1cApiClient['listInformationEntrySourceReviews'];
  readonly onReviewSources: M1cApiClient['reviewInformationEntryGraphSources'];
  readonly onCloseEvidence: () => void;
}
export function FormalKnowledgeWorkspace({
  onListSourceReviews,
  onReviewSources,
  onCloseEvidence,
  initialCenter,
  ...graphProps
}: FormalKnowledgeWorkspaceProps) {
  const [reviewing, setReviewing] = useState(false);
  const [openedReview, setOpenedReview] = useState(false);
  if (reviewing)
    return (
      <InformationEntrySourceReviewWorkspace
        onList={onListSourceReviews}
        onReview={onReviewSources}
        onOpenEvidence={graphProps.onOpenEvidence}
        onCloseEvidence={onCloseEvidence}
        onBack={() => {
          onCloseEvidence();
          setReviewing(false);
        }}
      />
    );
  return (
    <FormalKnowledgeGraphWorkspace
      {...graphProps}
      {...(openedReview || initialCenter === undefined ? {} : {initialCenter})}
      onOpenSourceReview={() => {
        onCloseEvidence();
        setOpenedReview(true);
        setReviewing(true);
      }}
    />
  );
}

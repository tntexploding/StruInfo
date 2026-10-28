export interface TopicEvidence {
  entryId: string;
  revision: number;
  quote: string;
}
export interface TopicMember extends TopicEvidence {
  reason: string;
  decision: 'included' | 'pinned' | 'excluded';
  origin: 'ai' | 'manual' | 'external_agent';
}
export interface TopicRelation {
  from: TopicEvidence;
  to: TopicEvidence;
  kind: 'supports' | 'contradicts' | 'continues' | 'replaces';
  reason: string;
  origin: string;
  blocked: boolean;
}
export interface TopicView {
  id: string;
  version: number;
  stale: boolean;
  value: {
    name: string;
    scope: string;
    summary: string;
    members: TopicMember[];
    relations: TopicRelation[];
  };
  entries: {entryId: string; title: string; stale: boolean}[];
}
export interface TopicJobView {
  id: string;
  version: number;
  status: string;
  errorCode?: string;
  attempts: number;
  maxAttempts: number;
  budgetId: string;
  chargedNanoCny: number;
  usageKnown: boolean;
  canResume?: boolean;
  note?: string;
  entries: {entryId: string; title: string}[];
}
export interface TopicCandidateView {
  entryId: string;
  revision: number;
  title: string;
  source: string;
  score: number;
  reasons: string[];
  samples: number;
  uncertain: boolean;
}
export interface TopicsResponse {
  budget?: {
    batchId: string;
    paused: boolean;
    limitCny: number;
    remainingCny: number;
  } | null;
  topics: TopicView[];
  jobs: TopicJobView[];
}

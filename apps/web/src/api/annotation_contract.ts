export interface AnnotationDimension {
  id: string;
  name: string;
  role:
    'form' | 'domain' | 'entity' | 'issue' | 'purpose' | 'condition' | 'custom';
  description: string;
  enabled: boolean;
}
export interface AnnotationTerm {
  id: string;
  dimensionId: string;
  label: string;
  meaning: string;
}
export interface AnnotationVocabulary {
  revision: number;
  dimensions: AnnotationDimension[];
  terms: AnnotationTerm[];
  aliases: {termId: string; text: string; status: 'pending' | 'confirmed'}[];
  relations: {
    from: string;
    to: string;
    kind: 'equivalent' | 'broader' | 'related';
    status: 'pending' | 'confirmed';
  }[];
}
export interface AnnotationEvidence {
  start: number;
  end: number;
  quote: string;
}
export interface AnnotationLabel {
  dimensionId: string;
  term: AnnotationTerm;
  wording: string;
  primary: boolean;
  evidence: AnnotationEvidence;
}
export interface AnnotationClaim {
  statement: string;
  speaker: string;
  stance: 'supports' | 'opposes' | 'reports';
  conditions: string;
  time: string;
  evidence: AnnotationEvidence;
}
export interface AnnotationDraft {
  status: 'complete' | 'partial' | 'unknown' | 'none';
  note: string;
  readingState: 'unread' | 'reading' | 'read' | 'archived';
  labels: AnnotationLabel[];
  claims: AnnotationClaim[];
}
export interface StructuredAnnotations extends AnnotationDraft {
  schemaVersion: 1;
  vocabularyRevision: number;
  dimensions: AnnotationDimension[];
  inputRevision: number;
  inputBodySha256: string;
  origin: 'manual' | 'ai' | 'rule';
  originVersion: string;
}
export interface AnnotationFilter {
  dimensionId?: string;
  termIds?: string[];
  status?:
    'unannotated' | 'complete' | 'partial' | 'unknown' | 'none' | 'stale';
  readingState?: AnnotationDraft['readingState'];
}

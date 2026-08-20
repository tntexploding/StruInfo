import type {IntakeAction, KnowledgeKind} from '../api/m1c_api_contract.js';

export type ReviewScore = 0 | 1 | 2 | 3 | 4;

export interface ReviewProcessingPlan {
  readonly kind:
    | 'single_item'
    | 'split_items'
    | 'condensed_item'
    | 'source_reference'
    | 'discard'
    | 'manual_review';
  readonly label: string;
  readonly detail: string;
}

const SHORT_FRAGMENT_CODE_POINTS = 480;
const SPLIT_FRAGMENT_CODE_POINTS = 900;

export function recommendReviewAction(
  usefulness: ReviewScore,
  interest: ReviewScore,
  selectedText: string,
): IntakeAction {
  const strongest = Math.max(usefulness, interest);
  const length = Array.from(selectedText).length;
  if (strongest <= 1) return 'condense';
  if (
    strongest >= 4 &&
    length >= SPLIT_FRAGMENT_CODE_POINTS &&
    structuralUnitCount(selectedText) >= 3
  ) {
    return 'split';
  }
  return 'full';
}

export function deriveReviewProcessingPlan(
  action: IntakeAction,
  selectedText: string,
  preferredKind?: KnowledgeKind,
): Readonly<ReviewProcessingPlan> {
  if (action === 'ignore') {
    return Object.freeze({
      kind: 'discard',
      label: '不进入知识项',
      detail: '保留审核记录，不生成正式知识项。',
    });
  }
  if (action === 'source_only') {
    return Object.freeze({
      kind: 'source_reference',
      label: '仅保留来源入口',
      detail: '保存证据与定位，不把短介绍扩写成知识正文。',
    });
  }
  if (action === 'needs_review') {
    return Object.freeze({
      kind: 'manual_review',
      label: '保持待处理',
      detail: '当前判断不足，暂不自动选择知识形状。',
    });
  }

  const length = Array.from(selectedText).length;
  if (
    preferredKind === 'entity' ||
    preferredKind === 'framework' ||
    preferredKind === 'resource' ||
    preferredKind === 'work'
  ) {
    return Object.freeze({
      kind: 'single_item',
      label: '资源类单项',
      detail: '作为一个资源条目保留来源与媒体引用，不按介绍文字机械拆分。',
    });
  }
  if (length <= SHORT_FRAGMENT_CODE_POINTS) {
    return Object.freeze({
      kind: 'single_item',
      label: '短条目单项',
      detail:
        '正文较短，直接形成一个条目；完整、拆分或压缩只作为历史审核倾向。',
    });
  }
  if (
    action === 'split' &&
    length >= SPLIT_FRAGMENT_CODE_POINTS &&
    structuralUnitCount(selectedText) >= 3
  ) {
    return Object.freeze({
      kind: 'split_items',
      label: '按结构拆成多项',
      detail: '正文长度和内部结构都足以支持拆分。',
    });
  }
  if (action === 'condense') {
    return Object.freeze({
      kind: 'condensed_item',
      label: '压缩为单项',
      detail: '保留核心事实与来源，删除宣传性或重复表达。',
    });
  }
  return Object.freeze({
    kind: 'single_item',
    label: '完整单项',
    detail: '保留为一个可修订知识项；只有结构充分时才拆分。',
  });
}

function structuralUnitCount(value: string): number {
  return value
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^#{1,6}\s/gu.test(line)).length;
}

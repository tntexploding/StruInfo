import type {AnnotationDimension} from '../api/annotation_contract.js';
export const annotationStatusLabels = {
  unannotated: '未标注',
  complete: '已标注',
  partial: '部分已知',
  unknown: '暂不确定',
  none: '无需标签',
  stale: '正文已修改，需核对',
};
export const readingStateLabels = {
  unread: '未读',
  reading: '在读',
  read: '已读',
  archived: '已归档',
};
export const annotationRoles: Record<AnnotationDimension['role'], string> = {
  form: '内容形式',
  domain: '领域',
  entity: '具体对象',
  issue: '核心议题',
  purpose: '使用目的',
  condition: '适用条件',
  custom: '自定义',
};

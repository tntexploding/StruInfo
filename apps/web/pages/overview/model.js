export const stages = [
  {
    name: '接收',
    icon: 'sources',
    stat: 'documents',
    description: '查看已接收的文档，处理待审核内容。',
  },
  {
    name: '入库',
    icon: 'database',
    stat: 'documents',
    description: '确认后的内容进入查询。后台整理单独运行。',
  },
  {
    name: '拆分',
    icon: 'split',
    stat: 'entries',
    description: '按文档内容与来源方案生成条目，保留原文位置。',
  },
  {
    name: '标签',
    icon: 'tag',
    stat: 'tags',
    description: '为条目添加领域、类型与主题标注。',
  },
  {
    name: '联系',
    icon: 'link',
    stat: 'relations',
    description: '寻找有证据支持的联系。完成前仍可阅读已发布内容。',
  },
  {
    name: '报告',
    icon: 'report',
    stat: 'reports',
    description: '按已选来源与时间范围生成报告。',
  },
];
export const statisticNames = {
  documents: '文档',
  entries: '条目',
  tags: '标签',
  relations: '联系',
  reports: '报告',
};
export const changes = {
  0: {key: 'documents'},
  1: {key: 'documents'},
  2: {key: 'entries'},
  3: {key: 'tags'},
  4: {key: 'relations'},
  5: {key: 'reports'},
};

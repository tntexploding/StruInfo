export function FormalKnowledgeWorkspace() {
  return (
    <div className="workspace-view formal-knowledge-workspace">
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">06 / FORMAL KNOWLEDGE</p>
          <h1>正式知识</h1>
          <p>
            这里将承载需要稳定语义身份、明确论证或类型化关系的正式知识；具体操作方式由后续产品讨论决定。
          </p>
        </div>
        <span className="origin-label">尚未启用</span>
      </header>

      <section
        className="formal-knowledge-placeholder"
        aria-labelledby="formal-knowledge-placeholder-title"
      >
        <p className="section-index">RESERVED / NEXT SPECIFICATION</p>
        <h2 id="formal-knowledge-placeholder-title">
          页面位置已保留，当前不会写入数据
        </h2>
        <p>
          文档日常处理继续使用“导入 → 拆分 → 标签 → 联系 →
          查询”。在你确定正式知识的形成、编辑与使用逻辑前，本页不复用旧审核意图，也不把
          Entry 自动升级为知识。
        </p>
      </section>
    </div>
  );
}

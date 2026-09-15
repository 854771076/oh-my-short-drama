function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function escapeMarkdown(value) {
  return text(value).replace(/[\\`*_{}\[\]<>()[\]#+\-.!|]/gu, '\\$&')
}

function identifier(value) {
  const source = text(value)
  // 存储层限制过的标识可以用行内代码原样呈现，其他调用方传入的值仍按普通外部文本转义。
  return /^[A-Za-z0-9+_-]{1,80}$/.test(source) ? `\`${source}\`` : escapeMarkdown(source)
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

function score(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'
}

/**
 * 将报告中的外部数据转成可安全展示的 Markdown；限制章节即使为空也保留，避免读者误把缺失字段理解为没有适用边界。
 */
export function renderMarketReportMarkdown(report) {
  const source = isRecord(report) ? report : {}
  const snapshotIds = Array.isArray(source.snapshot_ids) ? source.snapshot_ids : []
  const metrics = Array.isArray(source.topic_metrics) ? source.topic_metrics : []
  const limitations = Array.isArray(source.limitations) ? source.limitations : []
  const coverage = isRecord(source.coverage) ? source.coverage : {}
  const summary = isRecord(source.summary) ? source.summary : {}
  const lines = [
    '# 短剧市场报告',
    '',
    `- 报告 ID：${identifier(source.report_id)}`,
    `- 生成时间：${escapeMarkdown(source.generated_at)}`,
    `- 快照：${snapshotIds.length > 0 ? snapshotIds.map(identifier).join('、') : '—'}`,
    '',
    '## 覆盖范围',
    '',
    `- 样本数：${escapeMarkdown(coverage.sample_count)}`,
    `- 成功榜单：${Array.isArray(coverage.successful_ranking_types) && coverage.successful_ranking_types.length > 0 ? coverage.successful_ranking_types.map(escapeMarkdown).join('、') : '—'}`,
    `- 失败榜单：${Array.isArray(coverage.failed_ranking_types) && coverage.failed_ranking_types.length > 0 ? coverage.failed_ranking_types.map(escapeMarkdown).join('、') : '无'}`,
    '',
    '## 题材机会',
    '',
    '| 题材 | 机会分 | 供给 | 需求强度 | 增长强度 | 平台覆盖 | 置信度 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...metrics.map((metric) => `| ${escapeMarkdown(metric?.topic)} | ${score(metric?.opportunity_score)} | ${escapeMarkdown(metric?.supply_count)} | ${score(metric?.demand_strength)} | ${score(metric?.growth_strength)} | ${percent(metric?.platform_coverage)} | ${escapeMarkdown(metric?.confidence)} |`),
    ...(metrics.length === 0 ? ['| 暂无可分析题材 | — | — | — | — | — | — |'] : []),
    '',
    '## 方法说明',
    '',
    escapeMarkdown(summary.methodology),
    '',
    '## 限制与解读边界',
    '',
    ...(limitations.length > 0 ? limitations.map((item) => `- ${escapeMarkdown(item)}`) : ['暂无额外限制说明。']),
    '',
  ]
  return lines.join('\n')
}

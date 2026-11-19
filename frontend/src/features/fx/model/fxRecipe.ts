import { type FxTechnique } from '@/features/fx/model/fxTechniques'

/** 搜索范围：技法名 / 英文名 / 别名 / 关键词 / 意图 / 场景 / 分类 / 能力标签 */
export function searchBlob(t: FxTechnique) {
  return [
    t.name,
    t.nameEn,
    ...t.aliases,
    ...t.keywords,
    t.intent,
    ...t.scenes,
    ...t.antiScenes,
    t.categoryLabel,
    t.execLabel,
    t.implLabel,
    ...t.inputLabels,
  ]
    .join(' ')
    .toLowerCase()
}

/** 复制配方：纯文本，含参数 + 制作步骤 + 调用配置（输入/输出），页首写明语义 */
export function copyText(t: FxTechnique) {
  const params = t.params.map((p) => `- ${p.label}：${p.value}${p.hint ? `（${p.hint}）` : ''}`).join('\n')
  const steps = t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const limits = t.limitations.map((s) => `- ${s}`).join('\n')
  return [
    `特效技法：${t.name}（${t.nameEn}）`,
    `源库能力标签：${t.execLabel}（本页只读，不触发执行）`,
    `类别：${t.categoryLabel} · 实现：${t.implLabel} · 复杂度：${t.complexity}/5`,
    `一句话：${t.intent}`,
    `适用场景：${t.scenes.join(' / ') || '—'}`,
    `不适用：${t.antiScenes.join(' / ') || '—'}`,
    `输入：${t.inputRequirement || '—'}；输出：${t.output || '—'}`,
    '',
    '参数',
    params || '—',
    '',
    '制作步骤',
    steps || '—',
    '',
    '已知限制',
    limits || '—',
    '',
    `源库：${t.id} · v${t.version} · 更新 ${t.updatedAt}`,
  ].join('\n')
}

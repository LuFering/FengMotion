import fs from 'node:fs';
import path from 'node:path';

/**
 * 把用户选定的方向写进 brief，产出 Builder 能读的 ready 版本。
 *
 * 用法：
 *   node tools/apply-decision.mjs <draft.json> <optionId> <out.json> [--clear-questions]
 *
 * 只做三件事：
 *   1. 把 option 的 mechanism/camera/palette 提升到 visual 顶层；
 *   2. 记下 selectedOption；
 *   3. 重算 status：openQuestions 为空 => ready，否则 needs_input。
 */

const [draftPath, optionId, outPath] = process.argv.slice(2);
const clearQuestions = process.argv.includes('--clear-questions');
if (!draftPath || !optionId || !outPath) {
  console.error('用法：node tools/apply-decision.mjs <draft.json> <optionId> <out.json> [--clear-questions]');
  process.exit(2);
}

const abs = path.resolve(process.cwd(), draftPath);
const brief = JSON.parse(fs.readFileSync(abs, 'utf8'));
const visual = brief.visual ?? {};
const option = (visual.options ?? []).find((o) => o.id === optionId);
if (!option) {
  console.error(`找不到 option: ${optionId}`);
  process.exit(1);
}

visual.status = 'ready';
// 选中的方向只作为候选，不写成硬机制；制作层可以替换，但要写理由。
visual.candidateDirections = visual.candidateDirections ?? [];
if (!visual.candidateDirections.some((c) => c.name === `方向 ${optionId}` || (option.styleFrame && c.reference === option.styleFrame))) {
  visual.candidateDirections.push({
    name: `方向 ${optionId}`,
    description: option.mechanism,
    source: 'candidate',
    hard: false,
    reference: option.styleFrame,
  });
}
visual.palette = {
  ...(option.palette ?? {}),
  ...(visual.palette?.extra ? { extra: visual.palette.extra } : {}),
};
visual.selectedOption = option.id;
if (option.styleFrame) {
  visual.references = visual.references ?? [];
  if (!visual.references.some((r) => r.path === option.styleFrame)) {
    visual.references.push({
      type: 'image',
      path: option.styleFrame,
      what: `已选方向 ${optionId} 的风格帧；只作视觉参照，不作为素材`,
    });
  }
}
if (Array.isArray(brief.assumptions)) {
  brief.assumptions = brief.assumptions.map((a) =>
    a.includes('视觉方向待选') ? `已选方向 ${optionId}` : a
  );
}
if (clearQuestions) brief.openQuestions = [];
brief.status = (brief.openQuestions ?? []).length ? 'needs_input' : 'ready';

fs.writeFileSync(path.resolve(process.cwd(), outPath), JSON.stringify(brief, null, 2) + '\n');
console.log(`✓ ${outPath}：已应用 ${optionId}，status=${brief.status}`);

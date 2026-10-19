#!/usr/bin/env node
/**
 * shot-plan.json 结构校验（无依赖）
 *
 * 用法：
 *   node tools/validate-shot-plan.mjs <shot-plan.json>
 *
 * 只校验结构与引用一致性：时间线、镜头/事件/字幕 ID、连续性交接、主体状态字段。
 * 不评价镜头是否好看、转场是否高级、动作是否足够——这些由审片模型基于实际视频判断。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => Number.isInteger(v);
const isArr = Array.isArray;
const stable = (v) => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {});
  return v;
};
const sameState = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export function validateShotPlan(doc) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(isObj(doc), 'shot-plan 必须是 JSON 对象');
  if (!isObj(doc)) return errors;

  need(doc.schemaVersion === '1.0', 'schemaVersion 必须是 "1.0"');
  need(doc.type === 'shot-plan', 'type 必须是 "shot-plan"');
  need(isStr(doc.filmId), 'filmId 不能为空');
  need(isInt(doc.fps) && doc.fps > 0, 'fps 必须是正整数');
  need(isInt(doc.durationInFrames) && doc.durationInFrames > 0, 'durationInFrames 必须是正整数');
  need(doc.timelinePolicy === 'contiguous', 'timelinePolicy 必须是 "contiguous"（全片时间线不能留空档；空镜也应有镜头条目）');

  const duration = isInt(doc.durationInFrames) ? doc.durationInFrames : 0;

  // events
  const eventIds = new Set();
  need(isArr(doc.events) && doc.events.length >= 1, 'events 至少 1 个');
  for (const [i, e] of (isArr(doc.events) ? doc.events : []).entries()) {
    need(isObj(e), `events[${i}] 必须是对象`);
    if (!isObj(e)) continue;
    need(isStr(e.id), `events[${i}].id 不能为空`);
    if (isStr(e.id)) {
      need(!eventIds.has(e.id), `events[${i}].id 重复：${e.id}`);
      eventIds.add(e.id);
    }
    need(isStr(e.description), `events[${i}].description 不能为空`);
    need(isStr(e.startState), `events[${i}].startState 不能为空`);
    need(isStr(e.endState), `events[${i}].endState 不能为空`);
  }

  // captions：独立轨道，不要求与 shot 边界一致
  const captionIds = new Set();
  const captionShotRefs = new Set();
  need(isArr(doc.captions), 'captions 必须是数组（无字幕可为空数组）');
  for (const [i, c] of (isArr(doc.captions) ? doc.captions : []).entries()) {
    need(isObj(c), `captions[${i}] 必须是对象`);
    if (!isObj(c)) continue;
    need(isStr(c.id), `captions[${i}].id 不能为空`);
    if (isStr(c.id)) {
      need(!captionIds.has(c.id), `captions[${i}].id 重复：${c.id}`);
      captionIds.add(c.id);
    }
    need(isStr(c.sourceUnitId), `captions[${i}].sourceUnitId 不能为空`);
    need(isStr(c.text), `captions[${i}].text 不能为空`);
    need(isInt(c.from) && c.from >= 0, `captions[${i}].from 必须是 >=0 的整数`);
    need(isInt(c.durationInFrames) && c.durationInFrames > 0, `captions[${i}].durationInFrames 必须是正整数`);
    if (isInt(c.from) && isInt(c.durationInFrames) && duration > 0) {
      need(c.from + c.durationInFrames <= duration, `captions[${i}] 超出 durationInFrames`);
    }
  }

  // shots
  const shots = isArr(doc.shots) ? doc.shots : [];
  need(shots.length >= 1, 'shots 至少 1 个');
  const shotIds = new Set();
  const subjectIdsByShot = new Map();
  for (const [i, s] of shots.entries()) {
    need(isObj(s), `shots[${i}] 必须是对象`);
    if (!isObj(s)) continue;
    need(isStr(s.id), `shots[${i}].id 不能为空`);
    if (isStr(s.id)) {
      need(!shotIds.has(s.id), `shots[${i}].id 重复：${s.id}`);
      shotIds.add(s.id);
    }
    need(isStr(s.sceneId), `shots[${i}].sceneId 不能为空`);
    need(isStr(s.spaceId), `shots[${i}].spaceId 不能为空`);
    need(isInt(s.from) && s.from >= 0, `shots[${i}].from 必须是 >=0 的整数`);
    need(isInt(s.durationInFrames) && s.durationInFrames > 0, `shots[${i}].durationInFrames 必须是正整数`);
    need(isStr(s.transitionIntent), `shots[${i}].transitionIntent 不能为空（说明为什么在这里切）`);
    need(isArr(s.eventIds) && s.eventIds.length >= 1, `shots[${i}].eventIds 至少 1 个`);
    need(isArr(s.captionIds), `shots[${i}].captionIds 必须是数组（无字幕可为空）`);
    for (const eid of (isArr(s.eventIds) ? s.eventIds : [])) {
      need(eventIds.has(eid), `shots[${i}].eventIds 引用了不存在的事件：${eid}`);
    }
    for (const cid of (isArr(s.captionIds) ? s.captionIds : [])) {
      need(captionIds.has(cid), `shots[${i}].captionIds 引用了不存在的字幕：${cid}`);
      captionShotRefs.add(cid);
    }

    need(isObj(s.continuityIn), `shots[${i}].continuityIn 必须是对象`);
    need(isObj(s.continuityOut), `shots[${i}].continuityOut 必须是对象`);
    if (isObj(s.continuityIn)) {
      need(isArr(s.continuityIn.carriedState), `shots[${i}].continuityIn.carriedState 必须是数组`);
      if (s.continuityIn.stateChanges !== undefined) {
        need(isArr(s.continuityIn.stateChanges), `shots[${i}].continuityIn.stateChanges 必须是数组`);
        for (const [k, c] of (isArr(s.continuityIn.stateChanges) ? s.continuityIn.stateChanges : []).entries()) {
          need(isObj(c), `shots[${i}].continuityIn.stateChanges[${k}] 必须是对象`);
          if (!isObj(c)) continue;
          need(isStr(c.subjectId), `shots[${i}].continuityIn.stateChanges[${k}].subjectId 不能为空`);
          need(isStr(c.field), `shots[${i}].continuityIn.stateChanges[${k}].field 不能为空`);
          need(isStr(c.reason), `shots[${i}].continuityIn.stateChanges[${k}].reason 不能为空（为什么允许变化）`);
        }
      }
    }
    if (isObj(s.continuityOut)) need(isArr(s.continuityOut.carriedState), `shots[${i}].continuityOut.carriedState 必须是数组`);

    const subjects = isArr(s.subjects) ? s.subjects : [];
    need(isArr(s.subjects), `shots[${i}].subjects 必须是数组（无主体可为空）`);
    const subjectIds = new Set();
    for (const [j, sub] of subjects.entries()) {
      need(isObj(sub), `shots[${i}].subjects[${j}] 必须是对象`);
      if (!isObj(sub)) continue;
      need(isStr(sub.id), `shots[${i}].subjects[${j}].id 不能为空`);
      if (isStr(sub.id)) {
        need(!subjectIds.has(sub.id), `shots[${i}].subjects[${j}].id 重复：${sub.id}`);
        subjectIds.add(sub.id);
      }
      need(isStr(sub.identity), `shots[${i}].subjects[${j}].identity 不能为空（跨镜头可识别特征）`);
      need(isObj(sub.stateIn), `shots[${i}].subjects[${j}].stateIn 必须是对象`);
      need(isObj(sub.stateOut), `shots[${i}].subjects[${j}].stateOut 必须是对象`);
    }
    subjectIdsByShot.set(s.id, subjectIds);
  }

  // 时间线：连续覆盖，不重叠
  const sorted = shots.filter(isObj).slice().sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  let cursor = 0;
  for (const [i, s] of sorted.entries()) {
    if (!isInt(s.from) || !isInt(s.durationInFrames)) continue;
    need(s.from === cursor, `shots 时间线必须连续：${s.id ?? `#${i}`} 的 from=${s.from}，期望 ${cursor}`);
    cursor = s.from + s.durationInFrames;
  }
  if (duration > 0) need(cursor === duration, `shots 必须覆盖到 durationInFrames（当前到 ${cursor} / ${duration}）`);

  // 前后镜头引用
  for (const [i, s] of sorted.entries()) {
    if (!isObj(s)) continue;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const inFrom = isObj(s.continuityIn) ? s.continuityIn.fromShot : undefined;
    const outTo = isObj(s.continuityOut) ? s.continuityOut.toShot : undefined;
    if (i === 0) need(inFrom === null, `第一个镜头 ${s.id} 的 continuityIn.fromShot 必须是 null`);
    else need(inFrom === prev?.id, `镜头 ${s.id} 的 continuityIn.fromShot 必须是上一镜 ${prev?.id}`);
    if (i === sorted.length - 1) need(outTo === null, `最后一个镜头 ${s.id} 的 continuityOut.toShot 必须是 null`);
    else need(outTo === next?.id, `镜头 ${s.id} 的 continuityOut.toShot 必须是下一镜 ${next?.id}`);
  }

  // 跨镜头状态一致性：同一 subject 的 stateOut 必须等于下一镜 stateIn，
  // 除非 continuityIn.stateChanges 显式声明允许变化及原因。
  const stateChangeAllowed = (shot, subjectId, field) => {
    const list = isObj(shot.continuityIn) && isArr(shot.continuityIn.stateChanges) ? shot.continuityIn.stateChanges : [];
    return list.some((c) => isObj(c) && c.subjectId === subjectId && (c.field === field || c.field === '*'));
  };
  for (const [i, s] of sorted.entries()) {
    if (i === 0 || !isObj(s)) continue;
    const prev = sorted[i - 1];
    if (!isObj(prev)) continue;
    const prevOut = isObj(prev.continuityOut) && isArr(prev.continuityOut.carriedState) ? prev.continuityOut.carriedState : [];
    const currIn = isObj(s.continuityIn) && isArr(s.continuityIn.carriedState) ? s.continuityIn.carriedState : [];
    need(sameState(prevOut, currIn), `镜头 ${prev.id} 的 continuityOut.carriedState 与 ${s.id} 的 continuityIn.carriedState 不一致`);

    const prevSubjects = isArr(prev.subjects) ? prev.subjects : [];
    const currSubjects = isArr(s.subjects) ? s.subjects : [];
    for (const sub of currSubjects) {
      if (!isObj(sub) || !isStr(sub.id)) continue;
      const prevSub = prevSubjects.find((x) => isObj(x) && x.id === sub.id);
      if (!prevSub) continue;
      if (prevSub.identity !== sub.identity && !stateChangeAllowed(s, sub.id, 'identity')) {
        errors.push(`主体 ${sub.id} 在 ${prev.id}→${s.id} 的 identity 发生变化，但 continuityIn.stateChanges 没有声明 identity 变化及原因`);
      }
      const out = isObj(prevSub.stateOut) ? prevSub.stateOut : {};
      const inn = isObj(sub.stateIn) ? sub.stateIn : {};
      const fields = new Set([...Object.keys(out), ...Object.keys(inn)]);
      for (const field of fields) {
        if (!sameState(out[field], inn[field]) && !stateChangeAllowed(s, sub.id, field)) {
          errors.push(`主体 ${sub.id} 的 ${field} 在 ${prev.id}.stateOut 与 ${s.id}.stateIn 不一致，且未在 continuityIn.stateChanges 声明允许变化`);
        }
      }
    }
  }

  // 事件/字幕必须被至少一个镜头引用
  for (const eid of eventIds) {
    need(shots.some((s) => isArr(s.eventIds) && s.eventIds.includes(eid)), `事件 ${eid} 没有被任何镜头引用`);
  }
  for (const cid of captionIds) {
    need(captionShotRefs.has(cid), `字幕 ${cid} 没有被任何镜头引用（字幕是独立轨道，但仍需归属到镜头范围）`);
  }

  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const hashIdx = args.indexOf('--hash');
  if (hashIdx >= 0) {
    const hashFile = args[hashIdx + 1] && !args[hashIdx + 1].startsWith('--') ? args[hashIdx + 1] : args.find((a) => !a.startsWith('--'));
    if (!hashFile) {
      console.error('用法：node tools/validate-shot-plan.mjs --hash <shot-plan.json>');
      process.exit(2);
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(hashFile))).digest('hex');
    console.log(hash);
    process.exit(0);
  }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('用法：node tools/validate-shot-plan.mjs <shot-plan.json> [--hash]');
    process.exit(2);
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (e) {
    console.error(`✗ shot-plan 读取/解析失败：${e.message}`);
    process.exit(1);
  }
  const errors = validateShotPlan(doc);
  if (errors.length) {
    console.error(`✗ shot-plan 未通过（${errors.length} 项）：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ shot-plan 通过：${file}（${doc.shots.length} 镜头 / ${doc.events.length} 事件 / ${doc.captions.length} 字幕）`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();

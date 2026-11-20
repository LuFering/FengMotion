import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export async function timelineAdapter(workDir, nodeModules, prefix) {
  const real = path.join(nodeModules, 'remotion/dist/esm/index.mjs')
  const file = path.join(workDir, '.fengmotion-timeline.mjs')
  await writeFile(file, `
import React from 'react';
import * as Real from ${JSON.stringify(real)};
export * from ${JSON.stringify(real)};
const {Internals, useCurrentFrame} = Real;
if (!Internals.SequenceRegistrationContext || !Internals.SequenceManager || !Internals.RenderAssetManager) {
  throw new Error('当前 Remotion 运行时不支持轨道采集，请更新桌面渲染运行时');
}
const wrappers = new WeakMap();
function wrap(Component) {
  if (wrappers.has(Component)) return wrappers.get(Component);
  function TimelineCapture(props) {
    const frame = useCurrentFrame();
    const {registerRenderAsset, unregisterRenderAsset} = React.useContext(Internals.RenderAssetManager);
    const registry = React.useRef(new Map());
    const [revision, setRevision] = React.useState(0);
    const manager = React.useMemo(() => ({
      sequences: [],
      registerSequence: (sequence) => {
        registry.current.set(sequence.id, sequence);
        setRevision(revision => revision + 1);
      },
      unregisterSequence: (id) => {
        registry.current.delete(id);
        setRevision(revision => revision + 1);
      },
    }), [setRevision]);
    React.useLayoutEffect(() => {
      const rows = [...registry.current.values()].map(sequence => ({
        id: sequence.id, parent: sequence.parent,
        name: sequence.displayName || sequence.singleChildComponent?.displayName || sequence.singleChildComponent?.name,
        type: sequence.type, from: sequence.from, duration: sequence.duration, trimBefore: sequence.trimBefore || 0,
        show: sequence.showInTimeline !== false,
      }));
      const filename = ${JSON.stringify(prefix)} + frame + '.json';
      registerRenderAsset({type: 'artifact', contentType: 'text', id: filename, filename,
        frame, content: JSON.stringify(rows), downloadBehavior: null});
      return () => unregisterRenderAsset(filename);
    }, [frame, revision, registerRenderAsset, unregisterRenderAsset]);
    return React.createElement(Internals.SequenceRegistrationContext.Provider, {value: true},
      React.createElement(Internals.SequenceManager.Provider, {value: manager}, React.createElement(Component, props)));
  }
  wrappers.set(Component, TimelineCapture);
  return TimelineCapture;
}
export function Composition(props) {
  const {component, lazyComponent} = props;
  const loader = React.useMemo(() => lazyComponent && (async () => {
    const module = await lazyComponent();
    return {...module, default: wrap(module.default)};
  }), [lazyComponent]);
  return React.createElement(Real.Composition, component ? {...props, component: wrap(component)}
    : lazyComponent ? {...props, lazyComponent: loader} : props);
}
`)
  return file
}

export function createTimelineCollector() {
  const frames = new Map()
  const prefix = `fengmotion-timeline-${randomUUID()}-`
  return {
    prefix,
    onArtifact({ filename, frame, content }) {
      if (!filename.startsWith(prefix)) return
      if (!Number.isInteger(frame) || filename !== `${prefix}${frame}.json` || typeof content !== 'string') return
      try {
        const rows = JSON.parse(content)
        if (Array.isArray(rows)) frames.set(frame, rows)
      } catch {
      }
    },
    manifest(composition) {
      try {
        return manifestFromFrames(frames, composition)
      } catch (error) {
        process.stderr.write(`timeline fallback: ${error.message}\n`)
        return fallbackManifest(composition, 'limited')
      }
    },
  }
}

function fallbackManifest({ durationInFrames, fps, id }, detail = 'unavailable') {
  return {schemaVersion: 2, fps, durationSeconds: durationInFrames / fps, origin: 'render-runtime', detail,
    tracks: [{id: 'composition', name: '成片', clips: [
      {id: 'composition', name: id || '成片', kind: 'video', start: 0, duration: durationInFrames / fps},
    ]}]}
}

export function manifestFromFrames(frames, { durationInFrames, fps, id }) {
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('视频时长或帧率无效，无法生成轨道')
  }
  const objects = new Map()
  const structuralNames = new Set(['<AbsoluteFill>', '<Loop>', '<Series>', '<TransitionSeries>', '<Freeze>'])
  for (let frame = 0; frame < durationInFrames; frame++) {
    const rows = frames.get(frame)
    if (!rows) throw new Error(`轨道采集不完整：缺少第 ${frame} 帧`)
    const visibleRows = rows.filter(row => row && row.id && !structuralNames.has(row.name))
    const byId = new Map(rows.map(row => [row.id, row]))
    const duplicates = new Map()
    function position(row, visited = new Set()) {
      if (visited.has(row.id)) throw new Error('轨道父子关系存在循环')
      visited.add(row.id)
      const parent = row.parent ? byId.get(row.parent) : null
      if (row.parent && !parent) return null
      const parentPosition = parent ? position(parent, visited) : {offset: 0, start: 0, end: durationInFrames, key: '', depth: -1}
      if (!parentPosition) return null
      const offset = parentPosition.offset + row.from - (row.trimBefore || 0)
      const start = Math.max(parentPosition.start, offset)
      const end = Math.min(parentPosition.end, offset + row.duration)
      return { offset, start, end, depth: parentPosition.depth + (structuralNames.has(row.name) ? 0 : 1),
        key: parentPosition.key + JSON.stringify([row.name, row.type, row.from, row.duration, row.trimBefore]) }
    }
    for (const row of visibleRows) {
      const placement = position(row)
      if (!placement || !row.show || frame < placement.start || frame >= placement.end) continue
      const ordinal = duplicates.get(placement.key) || 0
      duplicates.set(placement.key, ordinal + 1)
      const key = placement.key + ':' + ordinal
      const kind = ['audio', 'video', 'image'].includes(row.type) ? row.type : 'shape'
      let entry = objects.get(key)
      if (!entry) {
        entry = {name: String(row.name || '序列').slice(0, 80), kind, depth: placement.depth, ranges: []}
        objects.set(key, entry)
      }
      const last = entry.ranges.at(-1)
      if (last?.end === frame) last.end++
      else entry.ranges.push({start: frame, end: frame + 1})
    }
  }
  const clips = [...objects.entries()].flatMap(([key, value]) => value.ranges.map((range, index) => ({
    id: createHash('sha256').update(key + ':' + index).digest('hex').slice(0, 20),
    name: value.name, kind: value.kind, start: range.start / fps, duration: (range.end - range.start) / fps,
    group: value.kind === 'shape' ? `场景层 ${value.depth + 1}` : {audio: '音频', video: '视频', image: '图片'}[value.kind],
  }))).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  const tracks = []
  for (const {group, ...clip} of clips) {
    let track = tracks.find(t => t.group === group && (t.clips.at(-1)?.start + t.clips.at(-1)?.duration || 0) <= clip.start + 0.00001)
    if (!track) {
      track = {id: `track-${tracks.length + 1}`, name: group, group, clips: []}
      tracks.push(track)
    }
    track.clips.push(clip)
  }
  if (clips.length > 400 || tracks.length > 60) throw new Error('轨道数量超出支持范围（最多 60 条轨道、400 个片段）')
  if (!tracks.length) tracks.push({id: 'composition', name: '成片（无独立序列）', clips: [
    {id: 'composition', name: id || '成片', kind: 'video', start: 0, duration: durationInFrames / fps},
  ]})
  return {schemaVersion: 2, fps, durationSeconds: durationInFrames / fps, origin: 'render-runtime',
    detail: clips.length ? 'sequences' : 'composition', tracks: tracks.map(({group, ...track}) => track)}
}

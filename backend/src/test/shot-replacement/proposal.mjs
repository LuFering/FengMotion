const fields = ['baseVersion', 'operation', 'shotId', 'sourceId']

export function propose(base, targetId, request, sources) {
  if (!request || Object.keys(request).length !== fields.length || !fields.every(field => Object.hasOwn(request, field))
      || request.operation !== 'replace-shot-source' || typeof request.sourceId !== 'string') {
    throw new Error('unsupported_shot_operation')
  }
  if (request.baseVersion !== base.version) throw new Error('shot_version_conflict')
  const target = base.shots.find(shot => shot.id === targetId)
  if (!target || request.shotId !== targetId || target.locked) throw new Error('shot_out_of_scope')
  if (!Object.hasOwn(sources, request.sourceId) || sources[request.sourceId].shotId !== target.id) {
    throw new Error('invalid_shot_source')
  }
  if (target.sourceId === request.sourceId) throw new Error('unchanged_shot_source')

  return {
    ...base,
    version: base.version + 1,
    shots: base.shots.map(shot => shot.id === targetId ? { ...shot, sourceId: request.sourceId } : shot),
  }
}

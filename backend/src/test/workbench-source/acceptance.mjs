import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, stat, access, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const api = process.env.FENGMOTION_ACCEPTANCE_API
if (!api || !/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(api)) throw new Error('Set FENGMOTION_ACCEPTANCE_API to an isolated local backend API')
const realAgent = process.argv.includes('--real-agent')
const wholeProject = process.argv.includes('--whole-project')
const verifyDeletion = process.argv.includes('--verify-deletion')
const verifyFrame = process.argv.includes('--verify-frame')
const verifyChat = process.argv.includes('--verify-chat')
const verifyJobs = process.argv.includes('--verify-jobs')
const verifyLegacy = process.argv.includes('--verify-legacy')
const verifyShots = process.argv.includes('--verify-shots')
const verifyHistory = process.argv.includes('--verify-history')
const verifyImport = process.argv.includes('--verify-import')
const rootSource = process.argv.includes('--root-source')
const entryPath = rootSource ? 'index.tsx' : 'src/index.tsx'
if (verifyLegacy && !realAgent) throw new Error('--verify-legacy requires --real-agent')
if (verifyChat && !realAgent) throw new Error('--verify-chat requires --real-agent')
if (wholeProject && !realAgent) throw new Error('--whole-project requires --real-agent')
const reportPath = process.env.FENGMOTION_ACCEPTANCE_REPORT
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function request(method, route, body, expected = 200) {
  const response = await fetch(`${api}${route}`, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(70_000) })
  const text = await response.text()
  let result
  try { result = text ? JSON.parse(text) : null } catch { result = text }
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`)
  return result
}
async function finish(route, expectedState) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const job = await request('GET', route)
    if (['accepted', 'running', 'cancelling'].includes(job.state)) { await delay(500); continue }
    assert.equal(job.state, expectedState, JSON.stringify(job))
    return job
  }
  throw new Error(`Timed out waiting for ${route}`)
}

const started = Date.now()
const project = await request('POST', '/projects', { name: `工作稿链路验收-${randomUUID().slice(0, 8)}` }, 201)
const prefix = `/projects/${project.id}`
await request('POST', `${prefix}/workflow/init`, { prompt: 'Make a simple 2-second title video. Subsequent workbench changes are drafts until explicitly rendered.' })
const root = project.rootPath
if(verifyImport) {
  const sourceFile=path.join(root,'import-check.txt')
  await writeFile(sourceFile,'local-import-check')
  const imported=await request('POST','/assets/import',{filePath:sourceFile,projectId:project.id},201)
  const duplicate=await request('POST','/assets/import',{filePath:sourceFile,projectId:project.id},200)
  assert.equal(imported.asset.id,duplicate.asset.id)
  assert.equal(imported.asset.projectId,project.id)
  await unlink(sourceFile)
  const stored=await fetch(`${api}/assets/${imported.asset.id}/content`).then(response=>response.text())
  assert.equal(stored,'local-import-check')
  await request('DELETE', `/assets/${imported.asset.id}`, undefined, 204)
  await request('GET', `/assets/${imported.asset.id}`, undefined, 404)
}
await mkdir(path.join(root, 'src'), { recursive: true })
const theme = JSON.stringify({ background: '#18212b' })
const component = `import React from 'react';export const Caption=()=> <p>Keep this unchanged</p>;\n`
const stylesheet = 'h1 { letter-spacing: 1px; }\n'
if (rootSource) {
  await mkdir(path.join(root, 'components'), { recursive: true })
  await mkdir(path.join(root, 'styles'), { recursive: true })
  await writeFile(path.join(root, 'components/Caption.tsx'), component)
  await writeFile(path.join(root, 'theme.json'), theme)
  await writeFile(path.join(root, 'styles/main.css'), stylesheet)
}
const source = `import React from 'react';
import {AbsoluteFill,Composition,registerRoot} from 'remotion';
${rootSource ? "import theme from './theme.json';\nimport {Caption} from './components/Caption';\nimport './styles/main.css';\n" : ''}const Main=()=> <AbsoluteFill style={{backgroundColor:${rootSource ? 'theme.background' : "'#18212b'"},justifyContent:'center',alignItems:'center',color:'#ffffff'}}><h1 style={{fontSize:72}}>Original</h1>${rootSource ? '<Caption/>' : '<p>Keep this unchanged</p>'}</AbsoluteFill>;
registerRoot(()=> <Composition id="Main" component={Main} width={960} height={540} fps={30} durationInFrames={60}/>);
`
await writeFile(path.join(root, entryPath), source)
await writeFile(path.join(root, 'film.config.json'), JSON.stringify({ entry: entryPath, compositionId: 'Main' }))
await writeFile(path.join(root, 'storyboard.json'), JSON.stringify({ schemaVersion: '1.0', type: 'storyboard', entries: [
  { id: 'opening', segment: '开场', timecode: '0–2s', duration: '2s', narration: 'Original', visual: 'Title', motion: '', transition: '', act: '' },
] }))
const storyboard = await request('GET', `${prefix}/storyboard`)
assert.equal(storyboard[0].narration, 'Original')
assert.equal(storyboard[0].timecode, '0–2s')
const firstState = await request('GET', `${prefix}/source/state`)
if (verifyFrame) {
  const captured = await request('POST', `${prefix}/source/frame`, {baseVersion: firstState.version, sourceHash: firstState.sourceHash, frame: 15})
  assert.equal(captured.frame, 15)
  assert.equal(captured.sourceHash, firstState.sourceHash)
  const bytes = Buffer.from(captured.dataUrl.split(',')[1], 'base64')
  assert.equal(bytes.readUInt32BE(16), 960)
  assert.equal(bytes.readUInt32BE(20), 540)
  await writeFile(path.join(root, 'frame-check.png'), bytes)
  await request('POST', `${prefix}/source/frame`, {baseVersion: firstState.version, sourceHash: firstState.sourceHash, frame: 60}, 400)
  assert.equal((await request('GET', `${prefix}/scene/versions`)).items.length, 0)
}
const firstRequest = { requestId: randomUUID(), baseVersion: firstState.version, sourceHash: firstState.sourceHash, prompt: '验收基线出片' }
await request('POST', `${prefix}/render-jobs`, firstRequest, 202)
const first = await finish(`${prefix}/render-jobs/${firstRequest.requestId}`, 'rendered')
assert.equal(first.result.version, 1)
const renderedSummary = await request('GET', prefix)
assert.equal(renderedSummary.durationMs, 2000)
assert.equal(renderedSummary.settings.width, 960)
assert.equal(renderedSummary.settings.height, 540)
const baselineVersion = await request('GET', `${prefix}/scene/versions/1`)
for (const name of ['remotion', '@remotion/renderer', '@remotion/bundler', 'react']) {
  assert.match(baselineVersion.film.dependencies[name], /^\d+\.\d+\.\d+/)
}
const contentTimeline = await request('GET', `${prefix}/timeline`)
assert.equal(contentTimeline.durationMs, 2000)
assert.equal(contentTimeline.width, 960)
const contentScenes = await request('GET', `${prefix}/scenes`)
assert.ok(contentScenes.length > 0)
assert.equal((await request('GET', `${prefix}/scenes/${encodeURIComponent(contentScenes[0].id)}`)).id, contentScenes[0].id)
const poster = await fetch(`${api}${prefix}/poster?version=1`)
assert.equal(poster.status, 200)
assert.equal(poster.headers.get('cache-control'), 'no-cache')
assert.ok((await poster.arrayBuffer()).byteLength > 0)
console.log(JSON.stringify({ stage: 'baseline-rendered', projectId: project.id, version: 1 }))
assert.equal((await request('GET', `${prefix}/source/state`)).dirty, false)
const preview = await request('POST', `${prefix}/live-preview`)
try {
  if (verifyDeletion) {
    const refused = await request('DELETE', `${prefix}?purge=true`, undefined, 409)
    assert.equal(refused.error.code, 'project_busy')
    assert.equal(await readFile(path.join(root, entryPath), 'utf8'), source)
    assert.equal((await request('GET', `${prefix}/scene`)).version, 1)
  }
  const html = await fetch(preview.url).then(response => response.text())
  const token = /window\.__fmToken\s*=\s*"([0-9a-f]+)"/.exec(html)?.[1]
  assert.ok(token)
  const line = source.split('\n').findIndex(text => text.includes('<h1')) + 1
  const column = source.split('\n')[line - 1].indexOf('<h1') + 1
  const src = `${entryPath}:${line}:${column}`
  async function previewApi(route, body, expected = 200) {
    const response = await fetch(`${preview.url}api/${route}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fm-token': token, Origin: new URL(preview.url).origin }, body: JSON.stringify(body) })
    const result = await response.json()
    assert.equal(response.status, expected, JSON.stringify(result))
    return result
  }
  const inspect = async () => (await previewApi('inspect', { srcs: [src] })).elements[src]
  let inspected = await inspect()
  await previewApi('edit', { src, path: ['#children'], value: 'Manual draft', expect: 'Original', fileHash: inspected.fileHash })
  await previewApi('edit', { src, path: ['#children'], value: 'Stale edit', expect: 'Original', fileHash: inspected.fileHash }, 409)
  assert.equal((await request('GET', `${prefix}/scene`)).version, 1)
  assert.equal((await request('GET', `${prefix}/source/state`)).dirty, true)
  await previewApi('undo', {})
  assert.equal((await request('GET', `${prefix}/source/state`)).dirty, false)
  inspected = await inspect()
  const target = await request('POST', `${prefix}/source/target`, { src, fileHash: inspected.fileHash })
  await previewApi('edit', { src, path: ['#children'], value: 'External draft', expect: 'Original', fileHash: inspected.fileHash })
  await request('POST', `${prefix}/creation-jobs`, { intent: 'Change title', requestId: randomUUID(), outputMode: 'draft',
    baseVersion: target.baseVersion, sourceHash: target.sourceHash, target: target.target }, 409)
  await previewApi('undo', {})
  let editState
  if (verifyLegacy) {
    const operation={requestId:randomUUID(),intent:`Only change the literal heading text Original to AI draft in ${entryPath}. Keep all other characters, imports, configuration and elements unchanged. Do not run render commands.`,baseVersion:1}
    await request('POST',`${prefix}/creation-jobs`,operation,202)
    editState=await finish(`${prefix}/creation-jobs/${operation.requestId}`,'rendered')
    assert.equal(editState.result.version,2)
    assert.equal(await readFile(path.join(root,entryPath),'utf8'),source.replace('>Original<','>AI draft<'))
  } else if (verifyChat) {
    const session = await request('POST', `${prefix}/chat-sessions`, {projectId: project.id, title: 'isolated source acceptance'}, 201)
    await request('POST', `/chat-sessions/${session.id}/messages`, {text:`Only change the literal heading text Original to AI draft in ${entryPath}. Keep other characters, imports and elements unchanged. Do not render.`}, 202)
    const response = await fetch(`${api}/chat-sessions/${session.id}/stream`, {signal:AbortSignal.timeout(150_000)})
    assert.equal(response.status, 200)
    const events = await response.text()
    assert.ok(events.includes('event: completed'), events.slice(-2000))
    assert.ok(!events.includes('event: error'), events.slice(-2000))
    assert.equal((await request('GET', `${prefix}/scene`)).version, 1)
    assert.equal(await readFile(path.join(root, entryPath), 'utf8'), source.replace('>Original<', '>AI draft<'))
    editState={state:'chat-edited'}
  } else if (realAgent) {
    const editRequest = { requestId: randomUUID(), outputMode: 'draft', baseVersion: target.baseVersion,
      sourceHash: target.sourceHash, ...(wholeProject ? {} : { target: target.target }),
      intent: `Only change the literal heading text Original to AI draft. Keep all other characters, attributes, imports and elements unchanged. Save ${entryPath}. Do not render.` }
    await request('POST', `${prefix}/creation-jobs`, editRequest, 202)
    console.log(JSON.stringify({ stage: 'real-agent-draft-running', requestId: editRequest.requestId }))
    editState = await finish(`${prefix}/creation-jobs/${editRequest.requestId}`, 'edited')
    assert.equal(editState.result.version, null)
    assert.equal((await request('GET', `${prefix}/scene`)).version, 1)
    assert.equal(await readFile(path.join(root, entryPath), 'utf8'), source.replace('>Original<', '>AI draft<'))
    assert.equal((await request('POST', `${prefix}/creation-jobs`, editRequest, 202)).state, 'edited')
    console.log(JSON.stringify({ stage: 'draft-edited-without-version', version: 1 }))
  } else {
    inspected = await inspect()
    await previewApi('edit', { src, path: ['#children'], value: 'AI draft', expect: 'Original', fileHash: inspected.fileHash })
  }
  let reloaded = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const bundle = await fetch(`${preview.url}bundle.js`).then(response => response.text())
    if (bundle.includes('AI draft')) { reloaded = true; break }
    await delay(100)
  }
  assert.ok(reloaded, 'live preview did not reload changed source')
  const dirty = await request('GET', `${prefix}/source/state`)
  assert.equal(dirty.dirty, !verifyLegacy)
  const finalRequest = { requestId: randomUUID(), baseVersion: dirty.version, sourceHash: dirty.sourceHash, prompt: '确认工作稿，出片 v2' }
  await request('POST', `${prefix}/render-jobs`, finalRequest, 202)
  await request('POST', `${prefix}/render-jobs`, finalRequest, 202)
  const final = await finish(`${prefix}/render-jobs/${finalRequest.requestId}`, 'rendered')
  assert.equal(final.result.version, verifyLegacy ? 3 : 2)
  assert.equal(final.result.sourceHash, dirty.sourceHash)
  assert.equal((await request('GET', `${prefix}/source/state`)).dirty, false)
  assert.equal((await request('GET', `${prefix}/scene/versions`)).items.length, verifyLegacy ? 3 : 2)
  assert.equal((await request('POST', `${prefix}/render-jobs`, finalRequest, 202)).result.version, verifyLegacy ? 3 : 2)
  const video = path.join(root, final.result.artifactPath)
  assert.ok((await stat(video)).size > 0)
  const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,r_frame_rate,width,height', '-of', 'json', video], { encoding: 'utf8' })).streams
  assert.equal(Number(streams[0].nb_frames), 60)
  const verification = { requestId: randomUUID(), kind: 'version_verify', version: final.result.version }
  await request('POST', `${prefix}/workbench-jobs`, verification, 202)
  const verified = await finish(`${prefix}/workbench-jobs/${verification.requestId}`, 'completed')
  assert.equal(verified.result.conclusion, 'passed')
  assert.equal(verified.result.visualReview, 'not_run')
  assert.equal(verified.result.videoHash.length, 64)
  assert.equal((await request('POST', `${prefix}/workbench-jobs`, verification, 202)).result.checkedAt, verified.result.checkedAt)
  const reviewPath = `${prefix}/scene/versions/${final.result.version}/reviews`
  assert.equal((await request('GET', reviewPath)).state, 'unreviewed')
  const review = { requestId: randomUUID(), expectedRevision: 0, decision: 'approved', note: '隔离验收夹具的明确审阅记录',
    videoHash: verified.result.videoHash, verificationRequestId: verification.requestId }
  const decision = await request('POST', reviewPath, review)
  assert.equal((await request('POST', reviewPath, review)).reviewId, decision.reviewId)
  assert.equal((await request('GET', reviewPath)).state, 'approved')
  const originalVideo = await readFile(video)
  try {
    await writeFile(video, Buffer.from('replaced-video'))
    const changedRequest = { ...verification, requestId: randomUUID() }
    await request('POST', `${prefix}/workbench-jobs`, changedRequest, 202)
    const changed = await finish(`${prefix}/workbench-jobs/${changedRequest.requestId}`, 'completed')
    assert.equal(changed.result.conclusion, 'failed')
    assert.notEqual(changed.result.videoHash, verified.result.videoHash)
    assert.ok(changed.result.checks.some(check => check.code === 'timeline_video_changed'))
    assert.equal((await request('GET', reviewPath)).state, 'stale')
    assert.equal((await request('POST', `${prefix}/workbench-jobs`, verification, 202)).result.videoHash, verified.result.videoHash)
  } finally { await writeFile(video, originalVideo) }
  if(verifyHistory) {
    const history=await request('POST',`${prefix}/scene/versions/1/live-preview`)
    try {
      const html=await fetch(history.url).then(response=>response.text())
      const token=/window\.__fmToken\s*=\s*"([0-9a-f]+)"/.exec(html)?.[1]
      assert.ok(token)
      const bundle=await fetch(`${history.url}bundle.js`).then(response=>response.text())
      assert.ok(bundle.includes('Original'))
      const response=await fetch(`${history.url}api/edit`,{method:'POST',headers:{'Content-Type':'application/json','x-fm-token':token},body:'{}'})
      assert.equal(response.status,422)
      assert.equal((await response.json()).error.code,'preview_read_only')
      assert.ok((await readFile(path.join(root,entryPath),'utf8')).includes('AI draft'))
    } finally { await request('DELETE',`${prefix}/scene/versions/1/live-preview`,undefined,204) }
  }
  if (verifyJobs) {
    await unlink(path.join(path.dirname(video), `.${path.basename(video)}.sequences.json`))
    const operation={requestId:randomUUID(),kind:'timeline_recovery',artifactPath:final.result.artifactPath}
    await request('POST',`${prefix}/workbench-jobs`,operation,202)
    const completed=await finish(`${prefix}/workbench-jobs/${operation.requestId}`,'completed')
    assert.ok(completed.result)
    assert.equal((await request('POST',`${prefix}/workbench-jobs`,operation,202)).state,'completed')
  }
  if (verifyShots) {
    const shotProject=await request('POST','/projects',{name:`镜头后台验收-${randomUUID().slice(0,8)}`},201)
    const shotPrefix=`/projects/${shotProject.id}`
    await mkdir(path.join(shotProject.rootPath,'src/shots'),{recursive:true})
    await writeFile(path.join(shotProject.rootPath,'src/shots/intro.tsx'),`import React from 'react';export const Shot=()=> <div style={{fontSize:50,color:'white',background:'black'}}>Intro</div>;`)
    await writeFile(path.join(shotProject.rootPath,'src/shots/outro.tsx'),`import React from 'react';export const Shot=()=> <div style={{fontSize:50,color:'white',background:'black'}}>Outro</div>;`)
    await mkdir(path.join(shotProject.rootPath, 'public'), { recursive: true })
    const voiceover = path.join(shotProject.rootPath, 'public/voiceover.wav')
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '48000', '-ac', '2', '-y', voiceover])
    const voiceHash = createHash('sha256').update(await readFile(voiceover)).digest('hex')
    await writeFile(path.join(shotProject.rootPath,'film.config.json'),JSON.stringify({format:'shot-timeline-v1',width:640,height:360,fps:30,voiceover:'voiceover.wav',shots:[{id:'intro',sourceId:'intro',label:'Intro',frames:30},{id:'outro',sourceId:'outro',label:'Outro',frames:30}]}))
    const baseline=await request('GET',`${shotPrefix}/source/state`)
    const baselineRender={requestId:randomUUID(),baseVersion:0,sourceHash:baseline.sourceHash}
    await request('POST',`${shotPrefix}/render-jobs`,baselineRender,202)
    const shotBaseline = await finish(`${shotPrefix}/render-jobs/${baselineRender.requestId}`,'rendered')
    const shotTracks = await request('GET', `${shotPrefix}/timeline?path=${encodeURIComponent(shotBaseline.result.artifactPath)}`)
    assert.equal(shotTracks.tracks.find(track => track.id === 'voiceover').clips[0].kind, 'audio')
    const shotLive=await request('POST',`${shotPrefix}/live-preview`)
    try {
      assert.ok((await fetch(`${shotLive.url}bundle.js`).then(response=>response.text())).includes('Intro'))
    } finally { await request('DELETE',`${shotPrefix}/live-preview`,undefined,204) }
    const candidateMarker=`FM_CANDIDATE_${randomUUID().replaceAll('-','')}`
    const candidate={requestId:randomUUID(),baseVersion:1,sourceHash:baseline.sourceHash,shotId:'intro',componentSource:`import React from 'react';export const Shot=()=> <div style={{fontSize:50,color:'cyan',background:'black'}}>${candidateMarker}</div>;`}
    const previewRequest={requestId:randomUUID(),kind:'shot_preview',candidate}
    await request('POST',`${shotPrefix}/workbench-jobs`,previewRequest,202)
    const shotPreview=await finish(`${shotPrefix}/workbench-jobs/${previewRequest.requestId}`,'completed')
    assert.equal(shotPreview.result.durationInFrames,30)
    assert.equal((await request('GET',`${shotPrefix}/source/state`)).sourceHash,baseline.sourceHash)
    const commitRequest={requestId:randomUUID(),kind:'shot_commit',version:1,candidateId:candidate.requestId}
    await request('POST',`${shotPrefix}/workbench-jobs`,commitRequest,202)
    const shotCommit=await finish(`${shotPrefix}/workbench-jobs/${commitRequest.requestId}`,'completed')
    assert.equal(shotCommit.result.version,2)
    assert.equal((await request('POST',`${shotPrefix}/workbench-jobs`,commitRequest,202)).result.version,2)
    assert.equal((await request('GET',`${shotPrefix}/scene/versions`)).items.length,2)
    await unlink(path.join(shotProject.rootPath, '.fengmotion/shot-candidates', candidate.requestId, 'candidate.json'))
    const replayCommit = { ...commitRequest, requestId: randomUUID() }
    await request('POST', `${shotPrefix}/workbench-jobs`, replayCommit, 202)
    assert.equal((await finish(`${shotPrefix}/workbench-jobs/${replayCommit.requestId}`, 'completed')).result.version, 2)
    assert.equal((await request('GET',`${shotPrefix}/scene/versions`)).items.length,2)
    assert.ok((await readFile(path.join(shotProject.rootPath,'src/shots/outro.tsx'),'utf8')).includes('Outro'))
    assert.equal(createHash('sha256').update(await readFile(voiceover)).digest('hex'), voiceHash)
    const audioStreams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'json', path.join(shotProject.rootPath, shotCommit.result.artifactPath)], { encoding: 'utf8' })).streams
    assert.equal(audioStreams.length, 1)
    assert.ok(Math.abs(Number(audioStreams[0].duration) - 2) < 0.1)
    const shotHistory=await request('POST',`${shotPrefix}/scene/versions/1/live-preview`)
    try {
      const bundle=await fetch(`${shotHistory.url}bundle.js`).then(response=>response.text())
      assert.ok(bundle.includes('Intro'))
      assert.ok(!bundle.includes(candidateMarker))
      const historicalVersion=await request('GET',`${shotPrefix}/scene/versions/1`)
      assert.ok(!(await readFile(path.join(shotProject.rootPath,historicalVersion.film.sourceSnapshot,'film.config.json'),'utf8')).includes('fm-candidate-'))
    } finally { await request('DELETE',`${shotPrefix}/scene/versions/1/live-preview`,undefined,204) }
  }
  let restoredVersion
  if (rootSource) {
    const version = await request('GET', `${prefix}/scene/versions/1`)
    const expectedSources = [entryPath, 'components/Caption.tsx', 'styles/main.css', 'theme.json']
    for (const file of expectedSources) {
      assert.ok(version.film.sources.some(item => item.path === file), `version manifest missing ${file}`)
      assert.equal(await readFile(path.join(root, version.film.sourceSnapshot, file), 'utf8'),
        file === entryPath ? source : await readFile(path.join(root, file), 'utf8'))
    }
    await writeFile(path.join(root, 'theme.json'), JSON.stringify({ background: '#dd2222' }))
    await writeFile(path.join(root, 'components/Caption.tsx'), component.replace('Keep this unchanged', 'Manual change'))
    await writeFile(path.join(root, 'New.tsx'), 'export const New = () => null;')
    assert.equal((await request('GET', `${prefix}/source/state`)).dirty, true)
    const restored = await request('POST', `${prefix}/scene/versions/1/restore`, { expectedVersion: final.result.version })
    restoredVersion = restored.version
    assert.equal(restoredVersion, final.result.version + 1)
    assert.equal(await readFile(path.join(root, entryPath), 'utf8'), source)
    assert.equal(await readFile(path.join(root, 'components/Caption.tsx'), 'utf8'), component)
    assert.equal(await readFile(path.join(root, 'theme.json'), 'utf8'), theme)
    assert.equal(await readFile(path.join(root, 'styles/main.css'), 'utf8'), stylesheet)
    await assert.rejects(access(path.join(root, 'New.tsx')), { code: 'ENOENT' })
    const state = await request('GET', `${prefix}/source/state`)
    assert.equal(state.dirty, false)
    assert.equal(state.sourceHash, firstState.sourceHash)
    assert.equal((await request('GET', `${prefix}/scene/versions/${restoredVersion}/reviews`)).state, 'unreviewed')
  }
  const report = { projectId: project.id, projectRoot: root, realAgent, draftState: editState?.state ?? 'manual-fixture',
    rootSourceVerified: rootSource, restoredVersion,
    currentContentVerified: true, storyboardVerified: true, posterVerified: true, runtimeVersionsVerified: true,
    technicalVerification: 'passed', modifiedVideoRejected: true, visualReview: 'not_run',
    reviewHistoryVerified: true, reviewInvalidatedByVideoChange: true,
    sourceFrameVerified: verifyFrame,
    chatIsolationVerified: verifyChat,
    backgroundJobsVerified: verifyJobs,
    shotBackgroundJobsVerified: verifyShots,
    independentVoiceoverVerified: verifyShots, candidateReceiptRecoveredAfterMetadataLoss: verifyShots,
    historicalPreviewVerified: verifyHistory,
    localPathImportVerified: verifyImport,
    editScope: verifyLegacy ? 'legacy-creation' : verifyChat ? 'chat-source' : realAgent ? wholeProject ? 'project-draft' : 'jsx-target' : 'manual',
    draftDidNotCreateVersion: !verifyLegacy, legacyIsolationVerified: verifyLegacy, staleTargetRejected: true, manualUndoVerified: true, hotReloadVerified: true,
    finalVersion: final.result.version, renderIdempotencyVerified: true, finalSourceClean: true,
    video, videoFrames: Number(streams[0].nb_frames), elapsedMs: Date.now() - started }
  if (verifyDeletion) {
    await request('DELETE', `${prefix}/live-preview`, undefined, 204)
    await request('DELETE', `${prefix}?purge=true`, undefined, 204)
    await request('GET', prefix, undefined, 404)
    await assert.rejects(access(root), { code: 'ENOENT' })
    await request('POST', `${prefix}/live-preview`, undefined, 404)
    report.previewBlocksDeletion = true
    report.stoppedProjectDeleted = true
    report.deletedProjectCannotRestart = true
  }
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  const response = await fetch(`${api}${prefix}/live-preview`, { method: 'DELETE' })
  assert.ok([204, 404].includes(response.status))
}

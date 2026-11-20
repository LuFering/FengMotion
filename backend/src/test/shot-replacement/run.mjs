import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { propose } from './proposal.mjs'

const browser = process.env.FENGMOTION_CHROME
if (!browser || !path.isAbsolute(browser)) throw new Error('Set FENGMOTION_CHROME to a local headless Chromium executable')
const workspace = await mkdtemp(path.join(os.tmpdir(), 'fengmotion-shot-pilot-'))
const fixtures = path.join(import.meta.dirname, 'fixtures')
const renderer = path.resolve(import.meta.dirname, '../../../remotion/render-project.mjs')
const canvas = { fps: 30, width: 960, height: 540 }
const voice = [
  { start: 0, end: 4, text: 'By serving, cold brew has the most caffeine in this comparison.' },
  { start: 4, end: 7, text: 'Check the serving size, not just the brew.' },
]
const base = {
  version: 1, canvas,
  shots: [
    { id: 'chart', startFrame: 0, frames: 120, sourceId: 'bars' },
    { id: 'outro', startFrame: 120, frames: 90, sourceId: 'end', locked: true },
  ],
  audio: { id: 'voiceover', asset: 'voice.m4a', startFrame: 0, frames: 210, locked: true },
}
const sources = {
  bars: { shotId: 'chart', file: 'Chart.tsx' },
  end: { shotId: 'outro', file: 'Outro.tsx' },
  ranking: { shotId: 'chart', file: 'Ranking.tsx' },
  broken: { shotId: 'chart', file: 'Broken.tsx' },
}
const request = { baseVersion: 1, operation: 'replace-shot-source', shotId: 'chart', sourceId: 'ranking' }
const file = name => path.join(workspace, name)
const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { cwd: workspace, encoding: 'utf8' })
const probe = args => execFileSync('ffprobe', ['-v', 'error', ...args], { cwd: workspace, encoding: 'utf8' })
const digest = data => createHash('sha256').update(data).digest('hex')
const state = file('current.json')

console.log(`Pilot workspace: ${workspace}`)

function clipStats(name) {
  return JSON.parse(probe(['-show_entries', 'stream=codec_type,codec_name,nb_frames,width,height,r_frame_rate', '-of', 'json', name])).streams
}

function videoFrameHashes(name) {
  return ffmpeg(['-i', name, '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'framemd5', '-'])
    .split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim())
}

function audioPackets(name) {
  return JSON.parse(probe(['-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256',
    '-show_entries', 'packet=pts_time,duration_time,data_hash', '-of', 'json', name])).packets
}

async function render(shot, name) {
  const folder = file(`source-${shot.sourceId}`)
  await mkdir(folder)
  await copyFile(path.join(fixtures, 'host.tsx'), path.join(folder, 'index.tsx'))
  await copyFile(path.join(fixtures, 'Frame.tsx'), path.join(folder, 'Frame.tsx'))
  await copyFile(path.join(fixtures, 'theme.json'), path.join(folder, 'theme.json'))
  await writeFile(path.join(folder, 'canvas.json'), JSON.stringify({ ...canvas, durationInFrames: shot.frames }))
  if (shot.sourceId === 'broken') await writeFile(path.join(folder, 'Shot.tsx'), 'export const Shot = (')
  else await copyFile(path.join(fixtures, sources[shot.sourceId].file), path.join(folder, 'Shot.tsx'))

  const started = performance.now()
  const raw = `rendered-${name}`
  const result = spawnSync(process.execPath, [renderer, '--project', folder, '--entry', 'index.tsx',
    '--composition', 'PilotShot', '--browser', browser, '--out', file(raw)], { encoding: 'utf8', timeout: 120_000 })
  await writeFile(file(`${name}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (result.error) throw result.error
  const payload = JSON.parse(result.stdout.trim().split('\n').at(-1))
  if (result.status !== 0 || !payload.ok) throw new Error(`shot_render_failed: ${payload.error}`)
  assert.equal(payload.durationInFrames, shot.frames)
  const elapsed = Math.round(performance.now() - started)
  ffmpeg(['-i', raw, '-map', '0:v:0', '-c', 'copy', name])
  const streams = clipStats(name)
  assert.equal(streams.length, 1)
  const [video] = streams
  assert.equal(Number(video.nb_frames), shot.frames)
  assert.equal(video.r_frame_rate, `${canvas.fps}/1`)
  assert.equal(video.width, canvas.width)
  assert.equal(video.height, canvas.height)
  return elapsed
}

async function assemble(timeline, rendered, output) {
  let cursor = 0
  const clipFiles = timeline.shots.map(shot => {
    assert.equal(shot.startFrame, cursor, 'pilot only accepts contiguous hard cuts')
    cursor += shot.frames
    const media = rendered[shot.sourceId]
    assert.ok(media)
    return `file '${media}'`
  })
  assert.equal(timeline.audio.startFrame, 0)
  assert.equal(timeline.audio.frames, cursor)
  const list = `${output}.ffconcat`
  await writeFile(file(list), `ffconcat version 1.0\n${clipFiles.join('\n')}\n`)
  const started = performance.now()
  ffmpeg(['-f', 'concat', '-safe', '1', '-i', list, '-i', timeline.audio.asset, '-map', '0:v:0', '-map', '1:a:0',
    '-c', 'copy', '-movflags', '+faststart', output])
  return Math.round(performance.now() - started)
}

function verifyVideoClock(name, length) {
  const { frames } = JSON.parse(probe(['-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', name]))
  assert.equal(frames.length, length)
  frames.forEach(({ best_effort_timestamp_time: timestamp }, index) => {
    assert.ok(Math.abs(Number(timestamp) - index / canvas.fps) < 0.000001, `${name}: frame ${index} is off its time slot`)
  })
}

async function publish(expectedVersion, next) {
  const current = JSON.parse(await readFile(state, 'utf8'))
  if (current.version !== expectedVersion) throw new Error('shot_version_conflict')
  const staged = file(`current.${next.version}.tmp`)
  await writeFile(staged, JSON.stringify(next, null, 2))
  await rename(staged, state)
}

for (const [index, cue] of voice.entries()) {
  execFileSync('espeak-ng', ['-s', '170', '-w', file(`speech-${index}.wav`), cue.text])
  const seconds = Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', `speech-${index}.wav`]))
  assert.ok(seconds > 0 && seconds <= cue.end - cue.start, `voice cue ${index} exceeds slot: ${seconds}`)
}
ffmpeg(['-i', 'speech-0.wav', '-i', 'speech-1.wav', '-filter_complex',
  '[0:a]aformat=sample_rates=48000:channel_layouts=mono,apad,atrim=duration=4[first];[1:a]aformat=sample_rates=48000:channel_layouts=mono,apad,atrim=duration=3[last];[first][last]concat=n=2:v=0:a=1[voice]',
  '-map', '[voice]', '-c:a', 'aac', '-b:a', '96k', 'voice.m4a'])
const volumeOutput = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', 'voice.m4a', '-af', 'volumedetect', '-f', 'null', '-'],
  { cwd: workspace, encoding: 'utf8' })
const maxVolume = Number(volumeOutput.stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1])
assert.ok(volumeOutput.status === 0 && Number.isFinite(maxVolume) && maxVolume > -30)
const voiceHash = digest(await readFile(file('voice.m4a')))

const barsMs = await render(base.shots[0], 'bars.mp4')
const outroMs = await render(base.shots[1], 'outro.mp4')
const baselineAssemblyMs = await assemble(base, { bars: 'bars.mp4', end: 'outro.mp4' }, 'v1.mp4')
await writeFile(state, JSON.stringify({ ...base, artifact: 'v1.mp4' }, null, 2))
const originalState = await readFile(state, 'utf8')
const originalOutro = videoFrameHashes('outro.mp4')
await writeFile(file('shot-context.json'), JSON.stringify({ target: base.shots[0], canvas, voiceCue: voice[0],
  nextShot: { id: 'outro', artifact: 'outro.mp4' }, theme: JSON.parse(await readFile(path.join(fixtures, 'theme.json'), 'utf8')) }, null, 2))

assert.throws(() => propose(base, 'chart', { ...request, shotId: 'outro', sourceId: 'end' }, sources), /shot_out_of_scope/)
assert.throws(() => propose(base, 'chart', { ...request, audio: {} }, sources), /unsupported_shot_operation/)
const broken = propose(base, 'chart', { ...request, sourceId: 'broken' }, sources)
await assert.rejects(render(broken.shots[0], 'broken.mp4'), /shot_render_failed/)
assert.equal(await readFile(state, 'utf8'), originalState)
await assert.rejects(stat(file('v2.mp4')), { code: 'ENOENT' })

const draft = propose(base, 'chart', request, sources)
const previewMs = await render(draft.shots[0], 'ranking.mp4')
ffmpeg(['-i', 'ranking.mp4', '-i', draft.audio.asset, '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'copy', '-c:a', 'aac', '-t', String(draft.shots[0].frames / canvas.fps), 'preview.mp4'])
assert.ok(audioPackets('preview.mp4').length > 0)
verifyVideoClock('preview.mp4', draft.shots[0].frames)
assert.equal(await readFile(state, 'utf8'), originalState)
const finalAssemblyMs = await assemble(draft, { ranking: 'ranking.mp4', end: 'outro.mp4' }, 'v2.mp4')
verifyVideoClock('v1.mp4', 210)
verifyVideoClock('v2.mp4', 210)
const before = videoFrameHashes('v1.mp4')
const after = videoFrameHashes('v2.mp4')
assert.equal(before.length, 210)
assert.equal(after.length, before.length)
assert.notDeepEqual(after.slice(0, 120), before.slice(0, 120))
assert.deepEqual(after.slice(0, 120), videoFrameHashes('preview.mp4'))
assert.deepEqual(after.slice(120), originalOutro)
assert.deepEqual(after.slice(120), before.slice(120))
const audio = audioPackets('v2.mp4')
assert.ok(audio.length > 0)
assert.deepEqual(audio, audioPackets('v1.mp4'))
assert.deepEqual(audio, audioPackets('voice.m4a'))
assert.equal(digest(await readFile(file('voice.m4a'))), voiceHash)
await publish(request.baseVersion, { ...draft, artifact: 'v2.mp4' })
await assert.rejects(publish(request.baseVersion, { ...draft, artifact: 'v2.mp4' }), /shot_version_conflict/)
assert.equal(JSON.parse(await readFile(state, 'utf8')).version, 2)

for (const [name, time] of [['v1', '2'], ['v2', '2'], ['outro', '1']]) {
  ffmpeg(['-ss', time, '-i', `${name}.mp4`, '-frames:v', '1', `${name}.png`])
}
const report = {
  workspace, previewFrames: 120, finalFrames: after.length, unchangedOutroFrames: originalOutro.length,
  identicalVoicePackets: audio.length, maxVoiceVolumeDb: maxVolume, voiceHash,
  timingsMs: { barsRender: barsMs, outroRender: outroMs, baselineAssembly: baselineAssemblyMs, previewRender: previewMs, finalAssembly: finalAssemblyMs },
  blocked: ['out-of-scope shot', 'audio modification', 'broken component', 'stale publish'],
}
await writeFile(file('result.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

test('timeline requests stay bound to the video and concurrent recovery is deduplicated', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const { studioHttpApi } = await server.ssrLoadModule('/src/api/index.ts')
    const { ApiError } = await server.ssrLoadModule('/src/api/errors.ts')
    const api = studioHttpApi()
    api.patchConfig({ baseUrl: 'http://127.0.0.1:8080/api' })
    const { timelineArtifactPath, loadVideoTimeline } = await server.ssrLoadModule('/src/features/workbench/services/videoTimeline.ts')
    const visual = { media: 'video', file: api.artifacts.contentUrl('one', 'renders/a.mp4') }
    assert.equal(timelineArtifactPath('one', visual), 'renders/a.mp4')
    assert.equal(timelineArtifactPath('two', visual), null)
    assert.equal(timelineArtifactPath('one', { ...visual, file: 'https://other.example/video.mp4' }), null)
    let recovered = 0
    api.artifacts.timeline = async () => { throw ApiError.fromResponse(404,
      { error: { code: 'timeline_missing', message: 'missing' } }, null) }
    api.artifacts.recoverTimeline = async () => { recovered++; return { artifactPath: 'renders/a.mp4' } }
    const first = loadVideoTimeline('one', 'renders/a.mp4')
    assert.equal(first, loadVideoTimeline('one', 'renders/a.mp4'))
    assert.deepEqual(await first, { artifactPath: 'renders/a.mp4' })
    assert.equal(recovered, 1)
    api.artifacts.timeline = async () => { throw ApiError.fromResponse(422,
      { error: { code: 'timeline_video_changed', message: 'changed' } }, null) }
    await assert.rejects(loadVideoTimeline('one', 'renders/a.mp4'), { details: { rawCode: 'timeline_video_changed' } })
    assert.equal(recovered, 1)
  } finally { await server.close() }
})

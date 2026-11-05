import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let toDeliverable

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  ;({ toDeliverable } = await server.ssrLoadModule('/src/shell/PendingAssets.tsx'))
})
after(async () => { await server?.close() })

/*
 * 待发送 → 对话 的条目构造。
 *
 * 这里守的是一条真实的崩溃：原实现发送时读 `r.asset!.name`，
 * 而参考片与特效的 asset 恒为 null —— 用户在参考片库里点「添加到对话」
 * 必然抛错，等于这两个库的东西永远送不进创作。
 */

test('参考片段投递时带上视频、时间范围与借鉴内容，且不依赖 asset', () => {
  const d = toDeliverable({
    assetId: 'seg_1',
    kind: 'ref',
    purpose: 'reference',
    note: '借鉴节奏',
    missing: false,
    thumb: null,
    asset: null,
    ref: {
      segmentId: 'seg_1',
      videoId: 'ref_a',
      title: '沙漠公路 · 片段 2',
      start: 6,
      end: 10,
      brief: '缓慢推进',
      params: {},
    },
  })

  assert.equal(d.name, '沙漠公路 · 片段 2', '名称来自参考卡而不是 asset')
  assert.equal(d.source, 'ref')
  assert.equal(d.refVideoId, 'ref_a')
  assert.equal(d.refStart, 6)
  assert.equal(d.refEnd, 10)
  assert.equal(d.refWants, '缓慢推进')
  assert.equal(d.kind, 'video')
})

test('特效投递时带技法 ID，不伪造版本号', () => {
  const d = toDeliverable({
    assetId: 'fx-dolly-zoom',
    kind: 'fx',
    purpose: 'reference',
    missing: false,
    thumb: null,
    asset: null,
    fx: {
      fxId: 'fx-dolly-zoom',
      name: '多莉变焦',
      intent: '制造眩晕感',
      categoryLabel: '运镜',
      execLabel: '可直接执行',
      complexity: 3,
      impl: 'ai',
    },
  })

  assert.equal(d.name, '多莉变焦')
  assert.equal(d.source, 'fx')
  assert.equal(d.fxId, 'fx-dolly-zoom')
  assert.equal(d.kind, 'technique')
  // 卡片里没有 version 字段，就不编一个出来 —— 留空表示「未记录」。
  assert.equal(d.fxVersion, undefined)
})

test('素材投递保留媒体类型与用途', () => {
  const d = toDeliverable({
    assetId: 'asset_1',
    kind: 'asset',
    purpose: 'visual',
    note: '开场用',
    missing: false,
    thumb: null,
    asset: { id: 'asset_1', name: 'logo.png', mediaType: 'image' },
  })

  assert.equal(d.name, 'logo.png')
  assert.equal(d.kind, 'image')
  assert.equal(d.source, 'asset')
  assert.equal(d.purpose, 'visual')
})

test('asset 缺失时也不崩，用 ID 兜底而不是抛错', () => {
  const d = toDeliverable({
    assetId: 'asset_x',
    kind: 'asset',
    purpose: 'unspecified',
    missing: false,
    thumb: null,
    asset: null,
  })

  // 关键：不抛异常。名称退化成 ID，至少还能发出去并看出是哪一条。
  assert.equal(d.name, 'asset_x')
  assert.equal(d.source, 'asset')
})

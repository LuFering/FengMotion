/** Browser regression for the asset UI. Mutations are intercepted in memory. Run with Vite on :5173. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.UI_BASE || 'http://127.0.0.1:5173'
const out = 'docs/ui-review/assets-redesign'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
const check = (label, value) => { assert.ok(value, label); results.push(label) }
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(() => {
  localStorage.setItem('fengmotion:api-config:v1', JSON.stringify({ baseUrl: 'http://127.0.0.1:8090/api', mode: 'real' }))
  localStorage.setItem('fengmotion:settings', JSON.stringify({ theme: 'dark', reduceMotion: true }))
})
const fixture = (id, name, mediaType, extra = {}) => ({
  id, name, mediaType, mimeType: { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mpeg', font: 'font/woff2', doc: 'application/pdf' }[mediaType], sizeBytes: 102400,
  sourceType: 'imported', processingStatus: 'ready', reviewStatus: 'none', availability: 'enabled', licenseStatus: 'unknown',
  tags: [], folderId: null, refs: [], createdAt: `2026-11-20T12:00:${id.slice(1).padStart(2, '0')}Z`, updatedAt: '2026-11-20T12:00:00Z', etag: '1',
  fileUrl: `/api/assets/${id}/content`, thumbnailUrl: mediaType === 'image' || mediaType === 'video' ? `./frames/film/s${((Number(id.slice(1)) % 8) + 1).toString().padStart(2, '0')}.jpg` : null,
  width: mediaType === 'image' ? 1920 : null, height: mediaType === 'image' ? 1080 : null, durationMs: mediaType === 'video' || mediaType === 'audio' ? 18200 : null, demo: true, ...extra,
})
let assets = [
  fixture('a1', '城市晨光.jpg', 'image', { folderId: 'f1', tags: ['品牌', '★'] }),
  fixture('a2', '片头镜头.mp4', 'video', { folderId: 'f1', refs: [{kind:'project',id:'demo-project',label:'演示 · 品牌短片'}] }),
  fixture('a3', '旁白第一版.mp3', 'audio', { licenseStatus: 'allowed' }),
  fixture('a4', '品牌手册.pdf', 'doc', { licenseDetails: '仅限内部演示' }),
  fixture('a5', '标题字体.woff2', 'font', { availability: 'disabled' }),
  fixture('a6', '需要重新导入的素材.jpg', 'image', { processingStatus: 'failed', processingError: '文件无法解码' }),
  fixture('a7', '黄昏街景.jpg', 'image', { sourceType: 'generated', tags: ['城市'] }),
  fixture('a8', '咖啡品牌秋季新品发布会横屏主视觉最终确认版用于验证长文件名称的展示.jpg', 'image'),
  fixture('a9', '节奏参考.mp4', 'video', { tags: ['品牌'], reviewStatus: 'needs_review' }),
  fixture('a10', '环境音效.mp3', 'audio', { licenseStatus: 'attribution_required' }),
]
let folders = [{ id: 'f1', name: '品牌短片', createdAt: '2026-11-20T12:00:00Z', assetCount: 2 }]
const writes = []
const uploads = new Map()
let failUpload = true
let failBatch = false
let mode = 'normal'
const json = (route, data, status = 200) => route.fulfill({ headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, status, contentType: 'application/json', body: JSON.stringify(data) })
// 项目列表用固定夹具，不读用户真实项目；项目下的其他读取返回空页
const projectFixture = { id: 'p1', name: '品牌短片项目', tagline: '', stage: 'idea', genomeId: null, durationMs: 0,
  counts: { scenes: 0, doneScenes: 0, storyboardSegments: 0, compositions: 0, timelineClips: 0 }, coverUrl: null,
  rootPath: '/tmp/fixture-project', createdAt: '2026-11-20T12:00:00Z', updatedAt: '2026-11-20T12:00:00Z', etag: '1',
  settings: { width: 1920, height: 1080, fps: 30, targetDurationMs: 0, genomeId: null } }
await page.route('**/api/projects**', route => {
  const req = route.request(), path = new URL(req.url()).pathname
  if (!path.startsWith('/api/')) return route.fallback()
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 })
  if (req.method() !== 'GET') return route.fallback()
  if (path === '/api/projects') return json(route, { items: [projectFixture], nextCursor: null })
  return json(route, { items: [], nextCursor: null })
})
await page.route('**/api/asset-folders**', route => {
  const req = route.request(), method = req.method(), path = new URL(req.url()).pathname
  if (!path.startsWith('/api/')) return route.fallback()
  if (method === 'OPTIONS') return route.fulfill({ status: 204 })
  if (method === 'GET') return json(route, folders)
  writes.push({method,path,body:req.postDataJSON()})
  if (method === 'POST') { const f={id:'f2',name:req.postDataJSON().name,createdAt:'2026-11-21T01:00:00Z'}; folders.push(f); return json(route,f,201) }
  if (method === 'PATCH') { const f=folders.find(x=>path.endsWith(x.id)); f.name=req.postDataJSON().name;return json(route,f) }
  const id=path.split('/').pop();folders=folders.filter(f=>f.id!==id);assets=assets.map(a=>a.folderId===id?{...a,folderId:null}:a);return json(route,{movedAssets:1})
})
await page.route('**/api/assets**', async route => {
  const req=route.request(), method=req.method(), url=new URL(req.url()), path=url.pathname
  if (!path.startsWith('/api/')) return route.fallback()
  if (method === 'OPTIONS') return route.fulfill({status:204})
  if (path.endsWith('/content')) return route.fulfill({status:404,body:'preview unavailable in fixture'})
  if (method !== 'GET') writes.push({method,path,body: method === 'PUT' ? null : req.postDataJSON()})
  if(path==='/api/assets' && method==='GET') {
    if(mode==='error') return json(route,{error:{code:'unavailable',message:'素材服务暂不可用'}},503)
    return json(route,{items:mode==='empty'?[]:assets,nextCursor:null,total:assets.length})
  }
  if(path==='/api/assets/uploads') {
    const body=req.postDataJSON()
    if(body.fileName==='失败文件.png' && failUpload) return json(route,{error:{code:'validation_error',message:'测试文件不可读取'}},400)
    const session={uploadId:`up${uploads.size}`,chunkSizeBytes:1024,receivedBytes:0,...body}; uploads.set(session.uploadId,session); return json(route,session,201)
  }
  if(path.includes('/uploads/')) {
    const id=path.split('/')[4], session=uploads.get(id)
    if(path.endsWith('/complete')) return json(route,{asset:assets[0],deduped:true},201)
    return json(route,{...session,receivedBytes:session.sizeBytes})
  }
  if(path.endsWith('/batch-update')) {
    const body=req.postDataJSON()
    return json(route,{results:body.ids.map(id=>{
      if(failBatch) return {id,ok:false,error:'文件夹暂不可用'}
      const a=assets.find(x=>x.id===id)
      if(body.folderId!==undefined)a.folderId=body.folderId||null
      if(body.projectId!==undefined)a.projectId=body.projectId||null
      if(body.addTags)a.tags=[...new Set([...a.tags,...body.addTags])]
      return {id,ok:true,asset:a}
    })},failBatch?207:200)
  }
  if(path.endsWith('/batch-delete')) {
    const body=req.postDataJSON(), results=body.ids.map(id=>{
      const a=assets.find(x=>x.id===id)
      if(a.refs.length)return {id,ok:false,error:'素材仍被引用'}
      assets=assets.filter(x=>x.id!==id);return {id,ok:true}
    });return json(route,{results},207)
  }
  const id=path.split('/')[3], asset=assets.find(x=>x.id===id)
  if(method==='PATCH'){Object.assign(asset,req.postDataJSON());return json(route,asset)}
  return json(route,asset||{},asset?200:404)
})
try {
  await page.goto(`${base}/?view=assets`)
  await page.locator('.mya-card').nth(9).waitFor()
  await page.locator('.mya-thumb img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode().catch(()=>{}))))
  await page.screenshot({path:`${out}/fixture-dark-1440.png`})
  check('十项演示数据独立于用户真实素材库',await page.locator('.mya-demo').count()===10)
  await page.getByRole('button',{name:'品牌短片 2',exact:true}).click()
  check('范围内类型计数：2 项 = 1 图片 + 1 视频',(await page.locator('.mya-types').textContent()).includes('视频1'))
  await page.getByRole('button',{name:/^图片\s*1$/}).click()
  check('类型筛选与文件夹取交集',await page.locator('.mya-card').count()===1)
  await page.locator('.mya-browser-tools').getByRole('button',{name:'清除筛选',exact:true}).click()
  await page.getByRole('searchbox',{name:'搜索素材'}).fill('内部演示')
  check('授权说明可检索',await page.locator('.mya-card').count()===1)
  await page.locator('.mya-browser-tools').getByRole('button',{name:'清除筛选',exact:true}).click()
  await page.getByRole('group',{name:'标题字体.woff2',exact:true}).click()
  check('停用素材不能新增待发送',await page.locator('.mya-use-primary').isDisabled())
  await page.keyboard.press('Escape')
  await page.getByRole('group',{name:'品牌手册.pdf',exact:true}).click()
  check('打开详情不写 lastUsedAt',writes.length===0)
  await page.getByRole('button',{name:'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click()
  await page.getByRole('textbox',{name:'素材名称',exact:true}).fill('取消改名.pdf')
  await page.keyboard.press('Escape')
  check('取消改名保留详情且不写接口',await page.locator('.mya-inspector').count()===1&&writes.length===0)
  await page.getByRole('button',{name:'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click()
  await page.getByRole('textbox',{name:'素材名称',exact:true}).fill('新的品牌手册.pdf')
  await page.keyboard.press('Enter')
  await page.getByRole('group',{name:'新的品牌手册.pdf',exact:true}).waitFor()
  check('回车改名只写一次',writes.filter(w=>w.method==='PATCH').length===1)
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'新建文件夹',exact:true}).click()
  await page.getByRole('textbox',{name:'新建文件夹名称'}).fill('新品发布')
  await page.keyboard.press('Enter')
  await page.getByRole('heading',{name:'新品发布',exact:true}).waitFor()
  await page.locator('input[type=file]').setInputFiles([{name:'重复素材.png',mimeType:'image/png',buffer:Buffer.from('image')},{name:'失败文件.png',mimeType:'image/png',buffer:Buffer.from('image')}])
  await page.getByRole('button',{name:'重试失败项',exact:true}).waitFor()
  check('导入使用开始时所在文件夹',writes.filter(w=>w.path==='/api/assets/uploads').every(w=>w.body.folderId==='f2'))
  check('失败原因直接可见',(await page.locator('.mya-import-status').innerText()).includes('测试文件不可读取'))
  failUpload=false
  await page.getByRole('button',{name:'重试失败项',exact:true}).click()
  await page.getByRole('button',{name:'关闭导入结果',exact:true}).waitFor()
  await page.locator('.mya-browser-tools').getByRole('button',{name:'清除筛选',exact:true}).click()
  check('重复导入按 id 合并，仍为十项',await page.locator('.mya-card').count()===10)
  await page.getByRole('button',{name:'关闭导入结果',exact:true}).click()
  await page.getByRole('checkbox',{name:'选择 城市晨光.jpg',exact:true}).check()
  await page.getByRole('button',{name:'移至文件夹',exact:true}).click()
  failBatch=true
  await page.locator('.mya-dock-pop').getByRole('button',{name:'新品发布',exact:true}).click()
  check('207 失败没有改写素材归属',assets.find(a=>a.id==='a1').folderId==='f1')
  failBatch=false
  await page.getByRole('button',{name:'移至文件夹',exact:true}).click()
  await page.locator('.mya-dock-pop').getByRole('button',{name:'新品发布',exact:true}).click()
  await page.locator('.mya-pickbar').getByRole('button',{name:'标签',exact:true}).click()
  await page.getByRole('textbox',{name:'批量添加标签'}).fill('本轮精选')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.body.innerText.includes('添加标签「本轮精选」'))
  check('批量归类和标签写回',assets.find(a=>a.id==='a1').folderId==='f2'&&assets.find(a=>a.id==='a1').tags.includes('本轮精选'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // 归属项目：批量移至项目只按服务端确认写回；分类按项目 ID 筛选
  await page.getByRole('checkbox',{name:'选择 黄昏街景.jpg',exact:true}).check()
  await page.getByRole('button',{name:'移至项目',exact:true}).click()
  await page.locator('.mya-dock-pop').getByRole('button',{name:'品牌短片项目',exact:true}).click()
  await page.waitForFunction(() => document.body.innerText.includes('已移入项目'))
  check('批量移至项目写回归属',assets.find(a=>a.id==='a7').projectId==='p1')
  await page.keyboard.press('Escape')
  await page.locator('.mya-org').getByRole('button',{name:/^品牌短片项目/}).click()
  check('按项目 ID 筛选',await page.locator('.mya-card').count()===1)
  await page.locator('.mya-org').getByRole('button',{name:/^全部素材/}).click()
  await page.getByRole('button',{name:'列表视图',exact:true}).click()
  check('列表显示全部同源素材',await page.locator('.mya-row').count()===10)
  await page.screenshot({path:`${out}/fixture-list.png`})
  await page.getByRole('button',{name:'网格视图',exact:true}).click()
  await page.getByRole('button',{name:'选择',exact:true}).click()
  await page.getByRole('group',{name:'城市晨光.jpg',exact:true}).click()
  await page.getByRole('button',{name:'加入待发送（1）',exact:true}).click()
  check('成功加入后退出选择模式',await page.locator('.mya-pickbar').count()===0)
  check('加入待发送未写项目引用',!writes.some(w=>w.body?.refs))
  await page.getByRole('group',{name:'城市晨光.jpg',exact:true}).click()
  await page.getByRole('button',{name:'重新加载',exact:true}).waitFor()
  check('预览失败可重试',await page.getByRole('button',{name:'重新加载',exact:true}).isVisible())
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox',{name:'选择 片头镜头.mp4',exact:true}).check()
  await page.getByRole('checkbox',{name:'选择 黄昏街景.jpg',exact:true}).check()
  await page.locator('.mya-pickbar').getByRole('button',{name:'删除',exact:true}).click()
  await page.getByRole('button',{name:'确认删除',exact:true}).click()
  await page.getByRole('group',{name:'黄昏街景.jpg',exact:true}).waitFor({state:'detached'})
  check('部分删除保留被引用素材与选择',assets.some(a=>a.id==='a2') && await page.getByRole('checkbox',{name:'选择 片头镜头.mp4',exact:true}).isChecked())
  await page.keyboard.press('Escape')
  // Capacity is a distinct result from already-added, and remaining selections survive.
  await page.evaluate(() => {
    const items=Array.from({length:24},(_,i)=>({assetId:`capacity-${i}`,addedAt:Date.now(),purpose:'unspecified'}))
    localStorage.setItem('fm-pending-assets-v1',JSON.stringify(items))
    window.dispatchEvent(new StorageEvent('storage',{key:'fm-pending-assets-v1'}))
  })
  await page.getByRole('button',{name:'选择',exact:true}).click()
  await page.getByRole('group',{name:'旁白第一版.mp3',exact:true}).click()
  await page.getByRole('button',{name:'加入待发送（1）',exact:true}).click()
  check('容量已满明确提示且保留选择',(await page.locator('body').innerText()).includes('待发送最多 24 项') && await page.getByRole('checkbox',{name:'选择 旁白第一版.mp3',exact:true}).isChecked())
  await page.keyboard.press('Escape')
  // Keyboard access: focus alone exposes card actions, arrows only move focus.
  const card=page.locator('.mya-card').first();await card.focus();await page.keyboard.press('ArrowRight')
  check('方向键不隐式打开详情',await page.locator('.mya-inspector').count()===0)
  for(const [width,height] of [[768,800],[390,844]]) {
    await page.setViewportSize({width,height});await page.reload();await page.locator('.mya-card').nth(8).waitFor()
    await page.screenshot({path:`${out}/fixture-${width}.png`})
    check(`${width}px 页面没有水平溢出`,await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth))
    await page.getByRole('button',{name:'选择',exact:true}).click()
    await page.locator('.mya-card').first().click()
    check(`${width}px 批量操作条在窗口内`,await page.locator('.mya-pickbar').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}))
    await page.screenshot({path:`${out}/selection-${width}.png`})
    await page.keyboard.press('Escape')
    await page.locator('.mya-card').first().focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog',{name:'素材详情'}).waitFor()
    for(let i=0;i<18;i++) await page.keyboard.press('Tab')
    check(`${width}px 详情焦点保持在对话框内`,await page.evaluate(()=>!!document.activeElement?.closest('dialog.mya-inspector')))
    await page.screenshot({path:`${out}/detail-${width}.png`})
    await page.getByRole('button',{name:'关闭详情',exact:true}).click()
    check(`${width}px 关闭详情恢复卡片焦点`,await page.evaluate(()=>document.activeElement?.classList.contains('mya-card')))

  }
  await page.setViewportSize({width:1440,height:900})
  mode='empty';await page.reload();await page.getByText('素材库还是空的',{exact:true}).waitFor();await page.screenshot({path:`${out}/empty.png`})
  check('空库提供导入入口',await page.getByRole('button',{name:'导入素材',exact:true}).count()===2)
  mode='error';await page.reload();await page.getByText('暂时无法读取素材库，请检查本地服务后重试。',{exact:true}).waitFor()
  await page.screenshot({path:`${out}/error.png`})
  check('首次加载失败显示未知数量而非空库计数',(await page.locator('.mya-result-count').innerText()) === '数量未知' && !(await page.locator('.mya-org-foot').innerText()).includes('0 B'))
  check('加载失败与空态区分',await page.getByText('素材库还是空的',{exact:true}).count()===0)
  check('页面无 JS 异常',errors.length===0)
  console.log(JSON.stringify({passed:results.length,results},null,2))
  await writeFile(`${out}/browser-checks.json`,JSON.stringify({passed:results.length,results,errors},null,2))
} catch(error) { console.log(errors); console.log((await page.locator('body').innerText()).slice(0,4000)); throw error } finally { await browser.close() }

const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: true })

  console.log('加载技法库页面...')
  await win.loadURL('http://localhost:5173/?view=knowledge')
  await new Promise((r) => setTimeout(r, 2000))

  // 1. 核验 电影运镜配方库
  console.log('核验 电影运镜配方库...')
  await win.webContents.executeJavaScript(`
    const tabs = Array.from(document.querySelectorAll('.fx-source-tab'));
    const t = tabs.find(x => x.textContent.includes('电影运镜'));
    if (t) t.click();
  `)
  await new Promise((r) => setTimeout(r, 2500))
  const shotcraftImg = await win.capturePage()
  fs.writeFileSync('/home/lufering/.gemini/antigravity/brain/02bd2d8d-14db-488d-a7bf-6bacf9781e6e/scratch/source_shotcraft_verified.png', shotcraftImg.toPNG())
  console.log('电影运镜截图已保存')

  // 2. 核验 视觉风格调色库
  console.log('核验 视觉风格调色库...')
  await win.webContents.executeJavaScript(`
    const tabs = Array.from(document.querySelectorAll('.fx-source-tab'));
    const t = tabs.find(x => x.textContent.includes('视觉风格'));
    if (t) t.click();
  `)
  await new Promise((r) => setTimeout(r, 2500))
  const opuscarImg = await win.capturePage()
  fs.writeFileSync('/home/lufering/.gemini/antigravity/brain/02bd2d8d-14db-488d-a7bf-6bacf9781e6e/scratch/source_opuscar_verified.png', opuscarImg.toPNG())
  console.log('视觉风格截图已保存')

  // 3. 核验 Remotion 画面代码库
  console.log('核验 Remotion 画面代码库...')
  await win.webContents.executeJavaScript(`
    const tabs = Array.from(document.querySelectorAll('.fx-source-tab'));
    const t = tabs.find(x => x.textContent.includes('Remotion'));
    if (t) t.click();
  `)
  await new Promise((r) => setTimeout(r, 3500))
  const remotionImg = await win.capturePage()
  fs.writeFileSync('/home/lufering/.gemini/antigravity/brain/02bd2d8d-14db-488d-a7bf-6bacf9781e6e/scratch/source_remotion_verified.png', remotionImg.toPNG())
  console.log('Remotion 截图已保存')

  console.log('全部 3 个库的渲染与遮挡排查截图已完成！')
  app.quit()
})

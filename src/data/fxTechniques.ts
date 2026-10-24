/**
 * 特效技法库数据 —— 从既有 FX 源库（workflow-gallery 的 fx 注册表）抽出，16 条，
 * 字段保持源库语义：能力标签 execType 是**源库元数据**，不代表本页可以执行。
 * 媒体已从 15.7MB 内嵌页抽出并压缩到 public/fx/（poster 960px webp / motion 640px mp4）。
 *
 * ⚠️ 不要在这里编造能力：runnable / composable / reference 的原值必须保留；
 *    本页不提供执行器，执行与工作流插入均未接入（详见 FxLibrary 底部说明）。
 */

export type FxCategory = 'camera' | 'transition' | 'lighting' | 'particles' | 'compositing' | 'stylize' | 'typography'
export type FxExecType = 'runnable' | 'composable' | 'reference'
export type FxImpl = 'realtime' | 'offline' | 'ai' | 'composite'
export type FxInputKind = 'image' | 'video' | 'audio' | 'text'

export interface FxParam {
  key: string
  label: string
  /** 源库默认值，已带单位 */
  value: string
  hint: string
}

export interface FxTechnique {
  id: string
  name: string
  nameEn: string
  aliases: string[]
  keywords: string[]
  intent: string
  category: FxCategory
  categoryLabel: string
  scenes: string[]
  antiScenes: string[]
  execType: FxExecType
  execLabel: string
  impl: FxImpl
  implLabel: string
  /** 1–5，源库口径 */
  complexity: number
  inputKinds: FxInputKind[]
  inputLabels: string[]
  /** 主输入要求（视频 / 图像 …，含 accepts） */
  inputRequirement: string
  output: string
  dependencies: string[]
  steps: string[]
  compatibility: string[]
  limitations: string[]
  failures: string[]
  params: FxParam[]
  previewImage: string
  previewVideo: string | null
  previewCaption: string
  related: string[]
  alternatives: string[]
  featured: boolean
  version: string
  updatedAt: string
}

export const FX_CATEGORIES: Array<{ id: FxCategory; label: string }> = [
  { id: 'camera', label: '运镜' },
  { id: 'transition', label: '转场' },
  { id: 'lighting', label: '光影' },
  { id: 'particles', label: '粒子' },
  { id: 'compositing', label: '合成' },
  { id: 'stylize', label: '风格化' },
  { id: 'typography', label: '文字动画' },
]

/** 能力标签逐字保留源库文案；hint 说明它只是来源库元数据。 */
export const FX_EXEC_TYPES: Record<FxExecType, { label: string; hint: string }> = {
  runnable: { label: '可直接执行', hint: '源库标记为有执行实现；本页只读展示，不触发执行' },
  composable: { label: '可组合', hint: '源库标记为与其他节点组合使用；本页不提供组合操作' },
  reference: { label: '知识参考', hint: '源库标记为仅供学习参考，无执行实现' },
}

export const FX_IMPLS: Record<FxImpl, string> = {
  realtime: '实时',
  offline: '离线渲染',
  ai: 'AI 生成',
  composite: '合成',
}

export const FX_INPUT_TYPES: Record<FxInputKind, string> = {
  image: '图像',
  video: '视频',
  audio: '音频',
  text: '文本',
}

export const FX_TECHNIQUES: FxTechnique[] = [
  {
    id: "fx-dolly-zoom", name: "多莉变焦", nameEn: "Dolly Zoom", aliases: ["滑轨变焦","眩晕镜头","Vertigo Shot"],
    keywords: ["变焦","推拉","眩晕","希区柯克","透视变形","空间扭曲","vertigo"], intent: "主体大小不变、背景剧烈伸缩，制造心理不安与空间异化感。",
    category: "camera", categoryLabel: "运镜",
    scenes: ["悬疑揭示","心理惊悚","人物顿悟时刻","梦境段落"], antiScenes: ["平静对话戏","纪实跟拍","产品展示"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "ai", implLabel: "AI 生成", complexity: 3,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["主体居中且占比超过 30%","背景有纵深线条（走廊、道路、隧道）"], steps: ["锁定主体在画面中心，确保其成像大小全程恒定","相机与变焦反向联动：推进时同步拉广角，拉远时同步推长焦","保持变速线性，避免中段加速破坏眩晕连续性","输出前逐帧检查背景边缘拉伸是否穿帮"],
    compatibility: ["16:9 / 9:16 均可","建议 24fps","输出 ProRes 或 H.264"], limitations: ["AI 生成对大幅透视变形的稳定性有限","背景复杂时边缘易闪烁"], failures: ["主体漂移：输入主体不居中导致锚定失败","变速不均：眩晕感中段断裂"],
    params: [{"key":"speed","label":"变焦速度","value":"1×","hint":"速度越快眩晕感越强"},{"key":"direction","label":"方向","value":"推进","hint":""},{"key":"intensity","label":"变形强度","value":"70%","hint":""}],
    previewImage: "./fx/poster/fx-dolly-zoom.webp", previewVideo: "./fx/motion/fx-dolly-zoom.mp4",
    previewCaption: "主体静止，背景空间被拉伸",
    related: ["fx-orbit-shot","fx-parallax-slide"], alternatives: ["fx-whip-pan"],
    featured: true, version: "1.2.0", updatedAt: "2026-10-10",
  },
  {
    id: "fx-orbit-shot", name: "环绕运镜", nameEn: "Orbit Shot", aliases: ["旋转运镜","环绕拍摄"],
    keywords: ["环绕","旋转","360","展示","产品","orbit"], intent: "相机环绕主体做圆弧运动，展示空间关系与体量感。",
    category: "camera", categoryLabel: "运镜",
    scenes: ["人物登场","产品展示","环境 establishing 镜头"], antiScenes: ["狭小室内（半径不足）","快速对话"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "ai", implLabel: "AI 生成", complexity: 2,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["环绕中心明确","主体周围有足够运动空间"], steps: ["确定环绕中心点与半径，起幅落幅构图对称","保持角速度恒定，避免加减速穿帮","注意背景接缝与光源方向连续性"],
    compatibility: ["16:9 / 1:1","24/30fps"], limitations: ["整周环绕时 AI 对背景一致性保持较弱"], failures: ["中心偏移导致主体在画框内漂移","半径过小撞入前景遮挡"],
    params: [{"key":"angle","label":"环绕角度","value":"120°","hint":""},{"key":"radius","label":"环绕半径","value":"中","hint":""},{"key":"height","label":"高度偏移","value":"10°","hint":""}],
    previewImage: "./fx/poster/fx-orbit-shot.webp", previewVideo: null,
    previewCaption: "动态视角环绕主体",
    related: ["fx-dolly-zoom","fx-parallax-slide"], alternatives: ["fx-parallax-slide"],
    featured: false, version: "1.0.0", updatedAt: "2026-09-28",
  },
  {
    id: "fx-parallax-slide", name: "视差滑动", nameEn: "Parallax Slide", aliases: ["视差运镜"],
    keywords: ["视差","滑动","层次","景深","parallax"], intent: "前景与背景以不同速度滑动，强化空间层次与纵深。",
    category: "camera", categoryLabel: "运镜",
    scenes: ["片头 establishing","风景空镜","UI 演示背景"], antiScenes: ["主体快速运动的跟拍"],
    execType: "composable", execLabel: "可组合",
    impl: "composite", implLabel: "合成", complexity: 2,
    inputKinds: ["image"], inputLabels: ["图像"],
    inputRequirement: "图像", output: "视频",
    dependencies: ["画面有明确的前景 / 中景 / 背景分层"], steps: ["按深度拆分图层","前景快、背景慢设置位移","边缘做内容感知填充"],
    compatibility: ["任意画幅","建议输出 4-6 秒循环"], limitations: ["单图转视差依赖深度估计，复杂遮挡易穿帮"], failures: ["图层边缘拉伸露馅","前后景速度比失调显得假"],
    params: [{"key":"distance","label":"滑动距离","value":"40%","hint":""},{"key":"fgDepth","label":"前景强度","value":"60%","hint":""}],
    previewImage: "./fx/poster/fx-parallax-slide.webp", previewVideo: null,
    previewCaption: "前后景速度差营造纵深",
    related: ["fx-orbit-shot","fx-dolly-zoom"], alternatives: ["fx-orbit-shot"],
    featured: false, version: "1.0.0", updatedAt: "2026-09-20",
  },
  {
    id: "fx-glitch-transition", name: "故障转场", nameEn: "Glitch Transition", aliases: ["故障艺术转场","信号干扰"],
    keywords: ["故障","glitch","信号","赛博","跳切","转场"], intent: "用数字故障撕裂画面完成硬切，节奏凌厉、能量感强。",
    category: "transition", categoryLabel: "转场",
    scenes: ["科技产品片","MV 跳切","游戏预告"], antiScenes: ["文艺慢节奏","婚礼纪实"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "composite", implLabel: "合成", complexity: 2,
    inputKinds: ["video"], inputLabels: ["视频"],
    inputRequirement: "视频", output: "视频",
    dependencies: ["两个镜头在切点处动作方向一致","建议切点落在鼓点上"], steps: ["在切点前后各取 6-12 帧作为故障区","叠加位移切片、噪点与扫描线","RGB 通道错位 2-8px，强度随时间衰减","快速收尾，避免故障区拖过 1 秒"],
    compatibility: ["任意分辨率","建议 30fps 以上更顺滑"], limitations: ["强度过高会完全遮挡切点信息"], failures: ["持续过长导致节奏拖沓","错位过大画面不可读"],
    params: [{"key":"intensity","label":"故障强度","value":"60%","hint":""},{"key":"duration","label":"持续时长","value":"0.5s","hint":""},{"key":"rgbSplit","label":"RGB 分离","value":"true","hint":""}],
    previewImage: "./fx/poster/fx-glitch-transition.webp", previewVideo: "./fx/motion/fx-glitch-transition.mp4",
    previewCaption: "数字故障撕裂完成跳切",
    related: ["fx-whip-pan"], alternatives: ["fx-whip-pan"],
    featured: true, version: "2.0.1", updatedAt: "2026-10-08",
  },
  {
    id: "fx-whip-pan", name: "甩镜转场", nameEn: "Whip Pan", aliases: ["快速摇镜转场"],
    keywords: ["甩镜","摇镜","速度线","转场","whip"], intent: "快速甩动镜头的动态模糊衔接两个场景，一气呵成。",
    category: "transition", categoryLabel: "转场",
    scenes: ["旅行 vlog","动作剪辑","空间转换"], antiScenes: ["静态访谈"],
    execType: "composable", execLabel: "可组合",
    impl: "composite", implLabel: "合成", complexity: 3,
    inputKinds: ["video"], inputLabels: ["视频"],
    inputRequirement: "视频", output: "视频",
    dependencies: ["两个镜头甩动方向一致","建议配合音效 whoosh"], steps: ["A 尾做加速甩出模糊","中间 4-8 帧全模糊过渡带","B 头从模糊中甩入并减速落幅"],
    compatibility: ["建议 60fps 素材更顺滑"], limitations: ["方向不一致会产生视觉冲突"], failures: ["模糊不足导致跳切生硬","落幅构图与 A 尾不呼应"],
    params: [{"key":"direction","label":"甩动方向","value":"右","hint":""},{"key":"blur","label":"模糊强度","value":"70%","hint":""}],
    previewImage: "./fx/poster/fx-whip-pan.webp", previewVideo: null,
    previewCaption: "动态模糊一气呵成",
    related: ["fx-glitch-transition"], alternatives: ["fx-glitch-transition"],
    featured: false, version: "1.1.0", updatedAt: "2026-09-15",
  },
  {
    id: "fx-light-leak", name: "漏光", nameEn: "Light Leak", aliases: ["胶片漏光","光斑"],
    keywords: ["漏光","暖光","复古","胶片","光斑","leak"], intent: "模拟胶片漏光的暖色光斑扫过画面，赋予复古温度。",
    category: "lighting", categoryLabel: "光影",
    scenes: ["回忆段落","婚礼","复古 MV"], antiScenes: ["冷峻科技风","夜景暗调"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "composite", implLabel: "合成", complexity: 1,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["无特殊依赖，可叠加于任何镜头"], steps: ["选择漏光素材层","混合模式设为 Screen（滤色）","强度随镜头情绪做关键帧起伏","避开主体面部区域"],
    compatibility: ["实时预览","可堆叠多层"], limitations: ["强度过高会洗掉暗部细节"], failures: ["位置固定每一帧都一样，显得假","遮挡主体面部"],
    params: [{"key":"intensity","label":"强度","value":"45%","hint":""},{"key":"hue","label":"色相","value":"暖橙","hint":""},{"key":"position","label":"位置","value":"随机","hint":""}],
    previewImage: "./fx/poster/fx-light-leak.webp", previewVideo: "./fx/motion/fx-light-leak.mp4",
    previewCaption: "暖色光斑扫过画面",
    related: ["fx-volumetric-rays","fx-film-grain"], alternatives: ["fx-volumetric-rays"],
    featured: true, version: "1.0.3", updatedAt: "2026-10-01",
  },
  {
    id: "fx-volumetric-rays", name: "体积光", nameEn: "Volumetric Rays", aliases: ["丁达尔效应","光束","教堂光"],
    keywords: ["体积光","丁达尔","光束","教堂光","volumetric"], intent: "为画面添加有体积感的光束，提升空间神圣感与层次。",
    category: "lighting", categoryLabel: "光影",
    scenes: ["森林","教堂","舞台","产品光影"], antiScenes: ["均匀阴天外景"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "ai", implLabel: "AI 生成", complexity: 3,
    inputKinds: ["image","video"], inputLabels: ["图像","视频"],
    inputRequirement: "图像（可接受 视频）", output: "图像",
    dependencies: ["画面中存在明确的强光源方向"], steps: ["识别强光源方向与遮挡关系","沿光源方向生成光束","光束与尘埃粒子联动","边缘做柔化衰减避免硬边"],
    compatibility: ["静帧效果最佳","视频需逐帧稳定"], limitations: ["光源不明确时 AI 易生成错误方向的光束"], failures: ["光束与实拍光源方向矛盾","浓度过高画面发灰"],
    params: [{"key":"density","label":"浓度","value":"55%","hint":""},{"key":"angle","label":"光束角度","value":"25°","hint":""},{"key":"warmth","label":"暖度","value":"60%","hint":""}],
    previewImage: "./fx/poster/fx-volumetric-rays.webp", previewVideo: null,
    previewCaption: "丁达尔光束穿透空间",
    related: ["fx-light-leak","fx-ember-particles"], alternatives: ["fx-light-leak"],
    featured: false, version: "1.1.0", updatedAt: "2026-09-25",
  },
  {
    id: "fx-ember-particles", name: "余烬粒子", nameEn: "Ember Particles", aliases: ["火星粒子","余烬"],
    keywords: ["粒子","余烬","火星","氛围","ember"], intent: "上升的余烬火星营造温暖、史诗或毁灭氛围。",
    category: "particles", categoryLabel: "粒子",
    scenes: ["篝火夜话","战争废墟","奇幻"], antiScenes: ["干净产品片"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "composite", implLabel: "合成", complexity: 2,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["暗背景效果最佳"], steps: ["生成粒子发射器（底部向上）","尺寸与透明度随机化","添加轻微水平漂移与闪烁","与镜头运动做简单跟踪"],
    compatibility: ["实时预览","可循环"], limitations: ["亮背景下粒子可读性差"], failures: ["密度过高糊成一片","运动轨迹过于规律显得假"],
    params: [{"key":"density","label":"密度","value":"50%","hint":""},{"key":"size","label":"颗粒尺寸","value":"3px","hint":""},{"key":"drift","label":"漂移","value":"40%","hint":""}],
    previewImage: "./fx/poster/fx-ember-particles.webp", previewVideo: "./fx/motion/fx-ember-particles.mp4",
    previewCaption: "火星余烬冉冉上升",
    related: ["fx-rain-overlay","fx-volumetric-rays"], alternatives: ["fx-rain-overlay"],
    featured: true, version: "1.3.0", updatedAt: "2026-10-05",
  },
  {
    id: "fx-rain-overlay", name: "雨效合成", nameEn: "Rain Overlay", aliases: ["下雨特效"],
    keywords: ["雨","氛围","湿润","忧郁","rain"], intent: "合成逼真雨景，强化忧郁、紧张或浪漫氛围。",
    category: "particles", categoryLabel: "粒子",
    scenes: ["都市夜景","离别戏","悬疑"], antiScenes: ["晴朗喜剧"],
    execType: "composable", execLabel: "可组合",
    impl: "composite", implLabel: "合成", complexity: 2,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["建议配合地面反射与水渍细节"], steps: ["分远近两层生成雨丝","近层大雨滴做景深模糊","统一雨丝方向与风力","叠加潮湿氛围色调"],
    compatibility: ["实时预览"], limitations: ["无风力数据时角度需手动匹配"], failures: ["雨丝方向与场景风向矛盾","只有一层雨显得扁平"],
    params: [{"key":"intensity","label":"雨量","value":"55%","hint":""},{"key":"angle","label":"雨丝角度","value":"8°","hint":""},{"key":"depthBlur","label":"景深模糊","value":"true","hint":"近处雨丝虚化更真实"}],
    previewImage: "./fx/poster/fx-rain-overlay.webp", previewVideo: null,
    previewCaption: "雨丝分层营造湿润氛围",
    related: ["fx-ember-particles"], alternatives: ["fx-ember-particles"],
    featured: false, version: "1.0.0", updatedAt: "2026-09-18",
  },
  {
    id: "fx-sky-replacement", name: "天空替换", nameEn: "Sky Replacement", aliases: ["换天"],
    keywords: ["天空","换天","气氛","sky"], intent: "替换平淡天空为戏剧性天象，重塑画面情绪。",
    category: "compositing", categoryLabel: "合成",
    scenes: ["风景","建筑","延时摄影"], antiScenes: ["天空占比极小的特写"],
    execType: "composable", execLabel: "可组合",
    impl: "ai", implLabel: "AI 生成", complexity: 4,
    inputKinds: ["image"], inputLabels: ["图像"],
    inputRequirement: "图像", output: "图像",
    dependencies: ["天空区域占比建议 > 25%","原片地平线清晰"], steps: ["AI 分割天空区域","新天空做透视与色温匹配","地平线处做色彩溢出统一","添加大气雾效过渡边缘"],
    compatibility: ["静帧优先","视频需天空跟踪"], limitations: ["视频中云层运动需额外稳定"], failures: ["天空与地面光照方向矛盾","边缘羽化不足出现硬边"],
    params: [{"key":"skyStyle","label":"天空风格","value":"火烧云","hint":""},{"key":"blend","label":"融合羽化","value":"65%","hint":""}],
    previewImage: "./fx/poster/fx-sky-replacement.webp", previewVideo: null,
    previewCaption: "平淡天空变为火烧云",
    related: ["fx-green-screen","fx-teal-orange"], alternatives: ["fx-teal-orange"],
    featured: false, version: "2.1.0", updatedAt: "2026-10-02",
  },
  {
    id: "fx-green-screen", name: "绿幕抠像", nameEn: "Chroma Key", aliases: ["抠像","键控","绿幕"],
    keywords: ["绿幕","抠像","键控","背景替换","chroma"], intent: "去除均匀绿色背景，置换任意虚拟场景。",
    category: "compositing", categoryLabel: "合成",
    scenes: ["虚拟演播室","特效合成","产品演示"], antiScenes: ["绿色服装主体","户外实拍"],
    execType: "reference", execLabel: "知识参考",
    impl: "composite", implLabel: "合成", complexity: 4,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["均匀布光的绿幕","主体与幕布距离大于 2 米","主体避免绿色/反光材质"], steps: ["采样绿色并做去溢色处理","核心抠像，边缘收缩 1-2px","头发丝等半透明区域单独精修","为新背景匹配边缘光与色温"],
    compatibility: ["建议在 AE / Nuke 中完成","需要干净的原始素材"], limitations: ["本库暂无抠像执行实现，仅提供制作方法参考"], failures: ["绿幕布光不均导致抠不干净","绿色溢色染到主体边缘","运动模糊区域破碎"],
    params: [{"key":"tolerance","label":"容差","value":"40%","hint":""},{"key":"despill","label":"去溢色","value":"60%","hint":""},{"key":"edgeFeather","label":"边缘羽化","value":"1.5px","hint":""}],
    previewImage: "./fx/poster/fx-green-screen.webp", previewVideo: null,
    previewCaption: "方法参考：布光与去溢是关键",
    related: ["fx-sky-replacement"], alternatives: ["fx-sky-replacement"],
    featured: false, version: "1.0.0", updatedAt: "2026-08-30",
  },
  {
    id: "fx-teal-orange", name: "电影感调色", nameEn: "Teal & Orange", aliases: ["青橙调","好莱坞调色"],
    keywords: ["调色","青橙","电影感","色彩","teal"], intent: "阴影偏青、高光偏橙的经典商业片色彩，对比强烈。",
    category: "stylize", categoryLabel: "风格化",
    scenes: ["预告片","人物特写","黄昏外景"], antiScenes: ["纪实新闻","医疗影像"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "realtime", implLabel: "实时", complexity: 2,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["建议输入 log 或高动态素材"], steps: ["阴影向青色偏移","高光向橙色偏移","肤色单独保护避免偏绿","整体对比做 S 曲线"],
    compatibility: ["实时预览","可做 LUT 导出"], limitations: ["肤色保护需要手动微调"], failures: ["强度过高肤色发绿","暗部死黑丢失细节"],
    params: [{"key":"intensity","label":"强度","value":"65%","hint":""},{"key":"warmth","label":"暖度","value":"55%","hint":""},{"key":"contrast","label":"对比","value":"50%","hint":""}],
    previewImage: "./fx/poster/fx-teal-orange.webp", previewVideo: "./fx/motion/fx-teal-orange.mp4",
    previewCaption: "青橙对比的商业片色彩",
    related: ["fx-film-grain","fx-sky-replacement"], alternatives: ["fx-film-grain"],
    featured: true, version: "3.0.0", updatedAt: "2026-10-06",
  },
  {
    id: "fx-film-grain", name: "胶片颗粒", nameEn: "Film Grain", aliases: ["噪点","颗粒"],
    keywords: ["颗粒","胶片","质感","噪点","grain"], intent: "添加动态胶片颗粒，消除数字画面的干净塑料感。",
    category: "stylize", categoryLabel: "风格化",
    scenes: ["复古短片","文艺片","暗调剧情"], antiScenes: ["干净产品广告"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "realtime", implLabel: "实时", complexity: 1,
    inputKinds: ["video","image"], inputLabels: ["视频","图像"],
    inputRequirement: "视频（可接受 图像）", output: "视频",
    dependencies: ["无"], steps: ["选择颗粒预设（35mm / 16mm）","颗粒量随曝光分区微调","输出前检查暗部颗粒是否结块"],
    compatibility: ["实时预览"], limitations: ["压缩平台会吃掉细颗粒，建议输出前略加重"], failures: ["颗粒过大像噪点污染","静态颗粒（未做时间抖动）显得假"],
    params: [{"key":"amount","label":"颗粒量","value":"35%","hint":""},{"key":"size","label":"颗粒尺寸","value":"1.2px","hint":""}],
    previewImage: "./fx/poster/fx-film-grain.webp", previewVideo: null,
    previewCaption: "细腻动态颗粒覆盖",
    related: ["fx-teal-orange","fx-light-leak"], alternatives: ["fx-teal-orange"],
    featured: false, version: "1.0.0", updatedAt: "2026-09-10",
  },
  {
    id: "fx-double-exposure", name: "双重曝光", nameEn: "Double Exposure", aliases: ["多重曝光"],
    keywords: ["双重曝光","剪影","叠加","诗意"], intent: "人像剪影与自然景观叠加的诗意合成。",
    category: "stylize", categoryLabel: "风格化",
    scenes: ["人物海报","专辑封面","片头"], antiScenes: ["信息密集的说明画面"],
    execType: "reference", execLabel: "知识参考",
    impl: "ai", implLabel: "AI 生成", complexity: 3,
    inputKinds: ["image"], inputLabels: ["图像"],
    inputRequirement: "图像", output: "图像",
    dependencies: ["人像需要干净剪影","纹理层建议自然景观"], steps: ["人像转剪影","纹理层做混合叠加","控制不透明度保留面部可读性","统一整体色调"],
    compatibility: ["静帧"], limitations: ["本库暂无执行实现，仅提供制作方法参考"], failures: ["两层明暗冲突导致主体不可读","色调不统一显得拼贴"],
    params: [{"key":"opacity","label":"叠加不透明度","value":"70%","hint":""},{"key":"blendMode","label":"混合模式","value":"正片叠底","hint":""}],
    previewImage: "./fx/poster/fx-double-exposure.webp", previewVideo: null,
    previewCaption: "方法参考：剪影与景观叠加",
    related: ["fx-teal-orange"], alternatives: ["fx-teal-orange","fx-volumetric-rays"],
    featured: false, version: "1.0.0", updatedAt: "2026-09-05",
  },
  {
    id: "fx-kinetic-type", name: "动态排版", nameEn: "Kinetic Typography", aliases: ["文字动画","跳动文字"],
    keywords: ["文字","排版","动态","标题","kinetic"], intent: "文字随节奏缩放位移，让信息传达自带律动。",
    category: "typography", categoryLabel: "文字动画",
    scenes: ["歌词视频","广告口号","知识口播"], antiScenes: ["长段落字幕"],
    execType: "runnable", execLabel: "可直接执行",
    impl: "composite", implLabel: "合成", complexity: 3,
    inputKinds: ["text"], inputLabels: ["文本"],
    inputRequirement: "文本", output: "视频",
    dependencies: ["文案按节奏断句"], steps: ["文案按语义断句分行","每行设置入场动画与缓动","关键重音词放大强调","与配乐鼓点对齐"],
    compatibility: ["建议配合 Prompt 节点提供文案"], limitations: ["中文字体动效样式少于拉丁字体"], failures: ["断句不当节奏混乱","同时动的元素过多眼花缭乱"],
    params: [{"key":"speed","label":"速度","value":"1×","hint":""},{"key":"style","label":"风格","value":"粗黑","hint":""},{"key":"easing","label":"缓动","value":"弹性","hint":""}],
    previewImage: "./fx/poster/fx-kinetic-type.webp", previewVideo: "./fx/motion/fx-kinetic-type.mp4",
    previewCaption: "文字随鼓点跳动",
    related: ["fx-title-reveal"], alternatives: ["fx-title-reveal"],
    featured: true, version: "1.2.0", updatedAt: "2026-10-04",
  },
  {
    id: "fx-title-reveal", name: "标题揭示", nameEn: "Title Reveal", aliases: ["片头标题"],
    keywords: ["标题","片头","揭示","title"], intent: "电影片头式的标题渐显，仪式感开场。",
    category: "typography", categoryLabel: "文字动画",
    scenes: ["片头","章节转场","品牌亮相"], antiScenes: ["快节奏混剪"],
    execType: "composable", execLabel: "可组合",
    impl: "composite", implLabel: "合成", complexity: 2,
    inputKinds: ["text"], inputLabels: ["文本"],
    inputRequirement: "文本", output: "视频",
    dependencies: ["标题文案简短有力"], steps: ["标题排印定稿","选择揭示方式并做缓动","配合底噪/音乐起幅","落幅留白 0.5 秒"],
    compatibility: ["可与调色节点串联"], limitations: ["过长标题揭示会拖节奏"], failures: ["揭示过快没有仪式感","字体与影片气质不符"],
    params: [{"key":"duration","label":"揭示时长","value":"2.5s","hint":""},{"key":"style","label":"风格","value":"光扫","hint":""}],
    previewImage: "./fx/poster/fx-title-reveal.webp", previewVideo: "./fx/motion/fx-title-reveal.mp4",
    previewCaption: "光扫过标题渐显",
    related: ["fx-kinetic-type"], alternatives: ["fx-kinetic-type"],
    featured: false, version: "1.0.0", updatedAt: "2026-09-22",
  },
]

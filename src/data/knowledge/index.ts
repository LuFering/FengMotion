/**
 * 知识层数据 —— 从 airemotion 技能包抽出，**不是编的**。
 *
 * 来源：
 *   卡片  02-镜头卡库/video-shotcraft/references/shots/  157 张
 *         预览  同仓库 gallery/（Apache 2.0，实现全部重写、去品牌）
 *   判例  02-镜头卡库/video-shotcraft/references/aesthetic-rules.md  27 条
 *   类型  04-参考视频拆解（3 种实测指纹）+ 06-审美与质量/创意（3 种规格）
 *   方法  01-流程与检查/（四段式 + 检索指南 + 交付检查清单）
 *
 * ⚠️ 判例里 26/27 条带**真实用户的驳回原话** —— 这是本产品最值钱的资产，
 *    展示时原话必须在场，它是"规则为什么这么定"的唯一证据。
 */

export interface ShotCard {
  id: string; cat: string; catCn: string; name: string
  /** 一句话：这张卡解决什么 */
  title: string
  dur: string; energy: string; fit: string
  tags: string[]
  /** 预览海报（本地 640×360；只有 60 张卡有，其余为空） */
  poster: string
  /** 动作预览（本地 960×540；只有 20 张卡有） */
  motion: string
}

/** 一张卡的完整正文（来自 references/shots/**.md 原文，逐字不删） */
export interface CardDetail {
  /** 意图：为什么这么设计 */
  intention: string
  /** 正文章节名（动效核心 / 两式选型 / 动作阶段 … 每卡不同） */
  coreTitle: string
  /** 该章节的原文（markdown 片段，含 - 列表与 **强调**） */
  core: string
  /** 参数表：参数 / 典型值 / 调节手感 */
  params: { k: string; v: string; note: string }[]
  /** 已知坑 */
  pitfalls: string[]
  /** 参考实现（demo 路径） */
  refimpl: string
}

export interface Rule {
  id: string; group: string; groupCn: string; no: number
  title: string; rule: string; case: string; check: string
  /** 用户的驳回原话（可能多条） */
  quotes: string[]
}

/** 一个卡点：名字 + 一句判据（判据是能当场验的，不是形容词） */
export interface MethodStep {
  /** 卡面上只留这几个字 */
  k: string
  /** 完整名字（悬停 / 无障碍用） */
  name: string
  judge: string
  /** 这一步长什么样：图片，或动作预览（能动的优先） */
  img: string
  motion?: string
  star?: boolean
}
/** 一套做法：片型不同，做法不同 —— 不拿一套流程套所有片型 */
export interface Method {
  name: string
  /** 一句话说清这套做法的性格 */
  lead: string
  /** 这个片型**长什么样**：一个媒体就够（poster + 可选的动作预览） */
  media?: string
  mediaMotion?: string
  steps: MethodStep[]
}

export interface Genome {
  id: string; name: string; from: '实测' | '规格'; persona: string
  /** 可量指纹 —— 不是形容词，是能数的数 */
  fp: { k: string; v: string }[]
  traits: string[]; note: string
  /** 该型的判据图（拆解产出物） */
  img?: string
  /** 这个片型**怎么做**（按镜头 / 按话轮 / 按页 / 按卖点 …） */
  method: Method
}

export interface Gate { id: string; name: string; out: string; judge: string; star?: boolean }
export interface Stage { id: string; name: string; lead: string; gates: Gate[]; ev?: string }
export interface Methods {
  stages: Stage[]
  retrieval: { n: number; what: string; where: string; note: string }[]
  checklist: { g: string; name: string; items: string; n?: number }[]
}

export interface Cat { id: string; cn: string; n: number }

import cardsJson from './cards.json'
import detailsJson from './card-details.json'

export const CARDS: ShotCard[] = cardsJson as ShotCard[]

/** 卡片正文：按 id 取。数据是 157 份源 md 的原文解析结果 */
export const CARD_DETAILS: Record<string, CardDetail> = detailsJson as Record<string, CardDetail>

export const CATS: Cat[] = [
  {
    "id": "all",
    "cn": "全部",
    "n": 157
  },
  {
    "id": "ui-entrance",
    "cn": "界面入场",
    "n": 28
  },
  {
    "id": "typography",
    "cn": "文字",
    "n": 26
  },
  {
    "id": "transition",
    "cn": "转场",
    "n": 19
  },
  {
    "id": "effects",
    "cn": "特效",
    "n": 17
  },
  {
    "id": "interaction",
    "cn": "交互",
    "n": 15
  },
  {
    "id": "data",
    "cn": "数据",
    "n": 13
  },
  {
    "id": "opening",
    "cn": "开场",
    "n": 11
  },
  {
    "id": "rhythm",
    "cn": "节奏",
    "n": 11
  },
  {
    "id": "camera",
    "cn": "运镜",
    "n": 10
  },
  {
    "id": "outro",
    "cn": "收尾",
    "n": 7
  }
]

export const RULES: Rule[] = [
  {
    "id": "R1",
    "group": "R",
    "groupCn": "节奏",
    "no": 1,
    "title": "关键信息落定后必须呼吸，品牌字标 hold 满 1 秒",
    "rule": "承载信息的元素（字卡/数字/网格全貌）落定后静止 ≥1s 再切镜；呼吸感停顿优先给品牌记忆点（wordmark 落定时刻），不给普通内容卡片。",
    "case": "用户：\"第一个标题打出来之后停留一秒\"、\"不是第一个字卡，我说的是开头和结尾的AI field lab出现的动画，出现后延长停留1秒\"。先停错了对象、revert 后重做，定案为开头结尾两处 wordmark 各 hold 满 1 秒。",
    "check": "每个\"想让观众记住的画面\"是否有完整静止时刻？停顿给的是品牌/关键信息，还是随手给了普通元素？",
    "quotes": [
      "第一个标题打出来之后停留一秒",
      "不是第一个字卡，我说的是开头和结尾的AI field lab出现的动画，出现后延长停留1秒"
    ]
  },
  {
    "id": "R2",
    "group": "R",
    "groupCn": "节奏",
    "no": 2,
    "title": "速度感来自加速度，不是匀速快；群体运动挂物理隐喻，收尾留 0.5s 停顿",
    "rule": "飞入/滚动一律非线性缓动 + 非均匀错峰，匀速运动读作廉价 PPT；大量同类元素入场用\"越来越快\"的硬加速节拍，最好绑一个物理隐喻（如牌堆发牌），满板后静止 0.5s 再切下一拍。",
    "case": "用户：\"卡片不断往下堆叠时，应该越来越快，scroll的速度也越来越快，并在最后停顿0.5秒\"、\"最后速度也不够快……卡片自动按顺序飞向自己的位置，归位越来越快\"。先做成加速 scroll + 0.5s 停顿，再改成发牌式硬加速——抽象 flood 五轮不收敛、换成发牌隐喻一轮通过。",
    "check": "有没有任何元素在做匀速直线运动？批量入场是否越来越快、末尾有无静止呼吸？",
    "quotes": [
      "卡片不断往下堆叠时，应该越来越快，scroll的速度也越来越快，并在最后停顿0.5秒",
      "最后速度也不够快……卡片自动按顺序飞向自己的位置，归位越来越快"
    ]
  },
  {
    "id": "R3",
    "group": "R",
    "groupCn": "节奏",
    "no": 3,
    "title": "节奏宁慢勿快：初版默认放慢一档，主体动作弧 ≥3s，交互演示按真人操作速度",
    "rule": "开场主体动作（聚焦→悬浮→归位一条完整弧线）至少 3 秒；模拟真实交互（打字、筛选、点击）按人真实操作的速度走，观众要能跟着做一遍；排时间线时预留 hold/rest 帧预算——第一版几乎总是偏快。",
    "case": "全片六次独立反馈全部指向\"放慢/停留\"，从未有一次\"太慢了\"的反向反馈。用户：\"第一个镜头还是太快了，放慢到3秒\"、\"进入搜索框打字，然后筛选出卡片的过程太快了，放慢一些\"。开场几经放慢到 3s macro opening，交互段落改成不慌不忙的 type-and-filter。",
    "check": "把每个镜头当第一次看：哪里没看清？交互段落自己能不能跟着操作一遍？",
    "quotes": [
      "镜头太赶了，节奏不对，观众跟不上"
    ]
  },
  {
    "id": "R4",
    "group": "R",
    "groupCn": "节奏",
    "no": 4,
    "title": "卡点约束时机不放大幅度：全画面级节拍冲击全片 ≤3 处，默认只动元素层",
    "rule": "强节奏 BGM 片\"切点落拍\"不等于\"逐拍打画面\"——作用于整画面/相机层的冲击（整画面 scale 泵/震屏/闪帧/负片帧）视同大 slam 管理：全片 ≤3 处、钉 music-beat-sync §2b 的最强 hit 清单、相邻两处间隔 ≥16 拍；其余拍点动效只作用主角元素层；节拍泵类连打单次 ≤4 拍、全片 ≤1 次。kick 命中表是候选池不是触发器。**计数单位是一次手法/set-piece 使用，不按内部子事件数**：一张卡的一次应用（paparazzi 三连闪、strobe 黑帧串、trailer-bumper 三刀切）算一个名额，卡自身标注的连发结构与全片次数上限照旧生效，不因本条被逐帧重复计数。",
    "case": "用户反馈（2026-08-22）：\"如果给音乐，镜头会随节奏抖动，影响观感\"——根因是把 music-beat-sync 的 kick→冲击映射执行成了逐拍全画面泵：强鼓点曲 kick 几乎每拍都有，逐拍\"被砸\"叠上相机层就是节拍频率的画面抖动。与 Q3 同族：Q3 封噪声性抖动（handheld），本条封节拍性抖动。",
    "check": "高能段任取连续 8 拍逐帧回放：整画面 scale/位移是否在逐拍脉冲？数全片作用于整画面/相机层的冲击：超过 3 处了吗？每处对得上最强 hit 清单吗？ ---",
    "quotes": [
      "如果给音乐，镜头会随节奏抖动，影响观感"
    ]
  },
  {
    "id": "Q1",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 1,
    "title": "复刻既有页面必须真实截图；手搓 UI 限非复刻场景且质量/表达达标；数据按风险口径处理",
    "rule": "凡是表现产品既有页面的镜头，第一步就用无头浏览器截真实页面（整页纹理 + 元素级抠图 + 坐标 json），不手搓仿真贴图复刻；非复刻场景（抽象开场/品牌段/页面上不存在的独立展示组件）允许手搓 UI，但质量（出版级质感，对照 Q10 标准）与表达明确性（观众一眼看懂它是什么）是硬门槛，达不到回截图路线。公开演示数据只有在产品简报明确确认后可保留；客户、个人、内部、密钥、实时或其他敏感内容必须先虚构、脱敏或冻结。对手搓素材同样适用该口径。",
    "case": "用户：\"我希望的是用真实的页面，然后加入动画\"、\"不要用真实数据，造一份fake的，不要提到客户名字\"。改用真实 dashboard 页面重建，此前一下午手搓纹理复刻版整体作废。修订（2026-07-13 用户裁决）：\"不一定都要来自真实页面截图，可以手搓UI组件，只是要保证质量和表达的明确性\"——判例约束收窄为\"不用手搓复刻既有页面\"。",
    "check": "每块 UI 素材：它在复刻既有页面吗？是则必须来自截图；手搓件的质感和表达能过 Q10 级审视吗？源数据是否符合已确认的数据口径，且不含未授权的客户、个人、内部或密钥信息？",
    "quotes": [
      "我希望的是用真实的页面，然后加入动画",
      "不要用真实数据，造一份fake的，不要提到客户名字",
      "不一定都要来自真实页面截图，可以手搓UI组件，只是要保证质量和表达的明确性"
    ]
  },
  {
    "id": "Q2",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 2,
    "title": "3D 透视下 UI 纹理按原生尺寸 rasterize 后缩小使用；文字发糊先查纹理分辨率链路",
    "rule": "3D 场景里的 UI 纹理按显示尺寸的 2–4 倍原生栅格化、在 3D 里向下采样（放大走布局级 CSS zoom 而非 transform scale）；文字模糊先查栅格化路径，别先动相机/DoF。",
    "case": "用户三轮追打：\"明显卡片变得模糊了\"、\"还是不够高清……有像素点的方块\"、\"第一个镜头的文字清晰度还是没有解决\"。先调 DoF 治标无效，改成按原生尺寸 rasterize 拿到真正 4x 锐度，最后把 CSS zoom 推广到全部 3D 页面层根治。",
    "check": "放大/透视镜头逐帧截图看文字边缘：有没有像素方块？纹理源分辨率是否 ≥ 显示尺寸 2 倍？ 技法展开（原 hires-rasterize-3d-text 技法卡沉淀于此，参考实现 template/src/aifl/live/PageCam.tsx）： - **根因**：Chromium 对 3D 合成层按 1920 布局宽栅格化再 GPU 放大——内容先降采样后放大必糊，与相机/景深参数无关。 - **解法**：放大量不走 `transform: scale(zoom)` 而走 CSS `zoom` 属性（布局级缩放），让 Chromium 按放大后的设备尺寸栅格化，从高清源向下采样。坐标要按 `Tx = 960/zoom − cx` 换算保持与平面模式取景一致（PageCam.tsx:100-114 有完整推导），漏换算会跑焦点。 - **配套**：全页 2x（deviceScaleFactor: 2）、hero 元素单独 4x 元素级截图，推进期 6f 交叉淡入盖住低倍页面纹理（淡入太长会看到两层错位）。 - **排查顺序**：文字糊 → 先查纹理源分辨率链路（截图倍率→栅格化路径→缩放方式），最后才考虑相机。DoF 只做氛围，永远不是清晰度的解法（实证无效）。验证用逐帧截图裁剪放大看字边缘，肉眼看缩略图发现不了。",
    "quotes": [
      "还是不够高清……有像素点的方块",
      "第一个镜头的文字清晰度还是没有解决"
    ]
  },
  {
    "id": "Q3",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 3,
    "title": "镜头要稳：产品宣传片默认不加手持抖动",
    "rule": "亮场 UI 宣传片禁用 handheld shake；相机噪声只在暗场氛围片明确追求纪实感时用极小值，且必须自查渲染帧确认无意外抖动。",
    "case": "用户：\"镜头视角很差，而且有小抖动不知道怎么回事\"。去掉 handheld shake、重新构图后抖动零投诉；另一支暗场氛围片保留 shake=0.02 未被投诉——适用边界由此划定（推测边界）。",
    "check": "逐镜头看渲染帧：有没有任何非叙事意图的相机抖动？",
    "quotes": [
      "镜头视角很差，而且有小抖动不知道怎么回事"
    ]
  },
  {
    "id": "Q4",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 4,
    "title": "高光/扫光特效宁缺毋滥：不群发，一个镜头最多给主角一次，且必须裁进圆角边界",
    "rule": "glint/泛光划过类特效不做群发——批量元素入场靠运动本身而非逐个发光；保留的光效必须被承载元素的 border-radius/overflow 裁剪，光溢出圆角是廉价感的典型来源。光效类技术路径本身不封杀：单点、给主角、实现质量过硬的 sheen/泛光可以做，做完对着渲染帧自问\"好看吗\"再交。",
    "case": "用户两次否决：\"不需要每个卡片都闪烁一下\"、\"卡片出现时的泛光划过的特效取消，不好看\"。据此去掉逐卡 glint、撤掉泛光划过、把 chip 高光扫光裁进圆角边界内。澄清（2026-07-13 用户）：否决针对的是\"实现的版本不好看\"，\"不代表这个技术路径/特效类型就不可行\"——群发禁令与圆角裁剪不变，但泛光/扫光类手法可以带着更高实现标准重试。",
    "check": "数一数全片 glint/sweep 出现次数：有没有超过\"主角元素一次\"？每处光效是否被圆角裁剪？留下的每处光效，正常速度回放自己看过并觉得好看吗？",
    "quotes": [
      "不需要每个卡片都闪烁一下",
      "卡片出现时的泛光划过的特效取消，不好看"
    ]
  },
  {
    "id": "Q5",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 5,
    "title": "开场只给一个主角：单主体 + 完整动作弧，胜过群体群舞",
    "rule": "开场信息宁少而聚焦——一个主角元素、一条完整弧线（聚光→推近→悬浮→描边光→归位），多元素并舞撑不起第一印象。",
    "case": "用户：\"第一个镜头，只需要聚焦在一张卡片，并让它更有质感\"。开场一夜推倒六次，单卡结构定型后直到成片未再动结构。",
    "check": "开场镜头有几个\"想让观众看\"的东西？主角的动作弧是否完整（起-承-落）？",
    "quotes": [
      "第一个镜头，只需要聚焦在一张卡片，并让它更有质感"
    ]
  },
  {
    "id": "Q6",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 6,
    "title": "机位服务可读性：信息密集镜头正视，文字特写侧向水平，风格化倾斜逐镜头验证",
    "rule": "风格化机位按镜头逐个决定——叙事/情绪镜头可倾斜，列表/堆叠等信息密集镜头保持正视；含文字的卡片特写用侧向水平机位，避免大角度仰拍/俯拍破坏文字可读性；禁止全局一刀切套用某种机位风格。",
    "case": "全片统一倾斜化被用户否决\"做的并不好……对于内容列表页（模板片中为论文列表）的改动也不好，回滚\"，随即单独把列表页 revert 回正视；用户：\"聚焦到一个卡片……是从左侧拍摄而不是从下方\"，改为左侧 hero 机位。",
    "check": "每个倾斜机位镜头：斜的理由是什么？画面里的文字在这个角度还读得清吗？",
    "quotes": [
      "做的并不好……对于内容列表页（模板片中为论文列表）的改动也不好，回滚",
      "聚焦到一个卡片……是从左侧拍摄而不是从下方"
    ]
  },
  {
    "id": "Q7",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 7,
    "title": "物件特写四件套：侧面倾斜角 + 可感知高度 + orbit 环绕 + 反差深色材质背景",
    "rule": "物件/资产特写镜头做足环境戏——侧面倾斜机位、堆叠出可感知的体积高度、镜头绕主体环绕，背景用与主场景反差的深色材质（如拉丝金属），再用拉远同步过渡回主场景。",
    "case": "用户：\"镜头应该是倾斜从侧面拍摄，堆叠的项目应该有一定的高度，然后镜头围着堆叠做旋转。真个场景应该是暗色的金属质感背景。然后在镜头拉远，同时出现dashboard背景\"。从 pile 特写 orbit 初版做到定稿——暗色拉丝金属背景 + 更高的堆叠 + 环绕运镜。",
    "check": "特写镜头的主体有没有体积感和环境反差？相机是死机位还是有环绕/拉远？",
    "quotes": [
      "镜头应该是倾斜从侧面拍摄，堆叠的项目应该有一定的高度，然后镜头围着堆叠做旋转。真个场景应该是暗色的金属质感背景。然后在镜头拉远，同时出现dashboard背景"
    ]
  },
  {
    "id": "Q8",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 8,
    "title": "结尾做成\"发布会合影\"：全片元素四方飞入围住字标，能量推到全片峰值",
    "rule": "多功能产品的收尾用\"全家福\"结构——每个已展示过的功能抽一个代表元素多方向飞入定格；规格匹配全片能量峰值（crane 运镜 + 舞台光 + 粒子），初版收尾几乎总是偏保守，默认加码一档。",
    "case": "用户：\"各个页面的核心元素从不同方向飞来……形成一个类似于合影的画面\"、\"加一些更多的特效、动画、运镜……像一个产品发布\"。从合影式组装做到发布会级别——crane 运镜、舞台光、金粉。",
    "check": "结尾是不是全片能量最高点？合影里是否每个已展示的功能都有代表元素？",
    "quotes": [
      "各个页面的核心元素从不同方向飞来……形成一个类似于合影的画面",
      "加一些更多的特效、动画、运镜……像一个产品发布"
    ]
  },
  {
    "id": "Q9",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 9,
    "title": "飞入动画的终点必须是页面布局里的真实槽位，元素不悬浮在页面上方",
    "rule": "元素飞入后要\"嵌入\"页面（归位到真实格位、扩展滚动流），不落地悬浮其上会显得假。",
    "case": "用户：\"研究问题的list应该从空中飞入，嵌入dashboard\"、\"不要让10张项目卡悬浮其上，而是接着往下scroll，然后排到下面去，不要重叠\"。据此让行元素飞入并嵌入布局、把网格改成随滚动延展（近整文件重写）。",
    "check": "每个飞入元素落定后，它在页面布局里有真实坐标吗？有没有元素永久浮在页面之上？",
    "quotes": [
      "研究问题的list应该从空中飞入，嵌入dashboard",
      "不要让10张项目卡悬浮其上，而是接着往下scroll，然后排到下面去，不要重叠"
    ]
  },
  {
    "id": "Q10",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 10,
    "title": "文档类镜头的 mock 内容要出版级：原生排版、文字铺满、完整版式入镜",
    "rule": "观众会读清屏幕上每个字——文档/报告类镜头的 mock 必须用产品原生排版灌满真实密度的假内容，侧栏/评论栏等版式元素完整入镜；\"贴图+标语\"级别的假文档整镜头返工。",
    "case": "用户：\"周报内容的文字要用和现在排版和风格一致的，只是内容mock，文字内容铺满，且要完整展示左边栏和右边评论栏\"（模板片中该镜头为周报页）。初版\"贴图+标语\"级假文档被整镜头重做，最终版为原生排版全量 mock、双栏完整入镜。",
    "check": "暂停在文档镜头任意一帧：内容读起来像真的吗？版式（侧栏/评论/页眉）完整吗？",
    "quotes": [
      "周报内容的文字要用和现在排版和风格一致的，只是内容mock，文字内容铺满，且要完整展示左边栏和右边评论栏"
    ]
  },
  {
    "id": "Q11",
    "group": "Q",
    "groupCn": "质感·运镜·构图",
    "no": 11,
    "title": "要被读的文字有最低有效字高：字幕 ≥5% 帧高，辅助文字 ≥3%；按最终像素量，不按 fontSize",
    "rule": "1080p 成片按手机/内嵌小窗播放校准可读性——镜头叙事字幕**有效字高 ≥56px（≥5.2% 帧高，推荐 60px 档）**，副标题/统计/URL 等辅助文字 ≥32px（≥3%）；有效字高 = fontSize × 全部祖先 scale × 透视压缩（3D 镜头按 `cos(rotY)` 估算），验收量渲染帧上的实际像素，不看代码里的 fontSize。文字只有两态：**\"纹理\"**（截图 cutout 里的装饰小字，必须明显虚化/降亮度让观众不去读）或 **\"要读\"**（达标字号 + 足够对比度，压过浅色背景时配 scrim/投影），不存在\"重排了但仍读不清\"的中间态——读不到的文字宁可删掉。收尾 URL/行动号召是全片最不该小的一行。",
    "case": "用户（2026-07-25）：\"里面有几个镜头，你可以发现它配的字很小……现在那些镜头里面的字太小了，根本就看不见\"。审查 gallery 介绍片：S1/S2/S4 字幕 38–40px（约 3.5% 帧高）、S6 副句 30px、收尾 URL 25px 全部低于线，其中 S2 面板\"为可读性重排\"的副标题只给了 19px——重排却没达标即中间态反例；六处统一提到 60/40/34px 档后整改通过。",
    "check": "抽每个含字幕的镜头一帧缩到 480px 宽（模拟手机小窗）：每句还读得清吗？逐帧量\"要读\"文字的实际像素高：字幕 ≥56px、辅助 ≥32px 吗？有没有哪块文字处于\"想让人读但读不清\"的中间态？ ---",
    "quotes": [
      "里面有几个镜头，你可以发现它配的字很小……现在那些镜头里面的字太小了，根本就看不见"
    ]
  },
  {
    "id": "S1",
    "group": "S",
    "groupCn": "声音",
    "no": 1,
    "title": "配乐与音效按\"片种\"选，不按\"事件\"选：强鼓点电子底 + 电影系 SFX 词汇，禁游戏音包音色（禁音色不禁动作）",
    "rule": "产品宣传片 SFX 词汇表 = whoosh(运镜)/impact(落地)/riser(铺垫)/sparkle(光效)/transition(转场)，禁用游戏音包音色；BGM 选强鼓点、强节奏的电子底（tech-house 类），候选曲必须垫进成片试听——单听曲子无法判断气质。",
    "case": "用户：\"这个配乐和音效都太像游戏了。你帮我找那种鼓点强的，节奏感强的，然后音效要那种典型的产品宣传视频的音效\"。用 Mixkit tech-house + whoosh/impact/riser/sparkle 整批替换掉此前引入的全部 Kenney CC0 游戏音；BGM 34 分钟内三易其稿后定稿沿用。 **禁的是音色，不是动作**（易误读，务必分清）：本条否掉的是\"合成器 pluck/bloop、卡通弹跳、game-over 音阶\"这类游戏音包**质感**，不是\"不许给点击配声\"。画面里真有点击/开关/碎裂，就该配它的拟音——那是 S4 的要求。判别问句：这个音像**真实世界里那个物件发出的声音**（快门、机械开关、玻璃、纸），还是像**游戏引擎里的反馈提示音**？前者用，后者弃。 - 模板片自己就用 `click-camera.mp3` 且给了全片最高 SFX 响度 0.6——真实快门声，不是 UI 提示音。 - **`sfx/ui/` 不是\"整目录放行\"，恰恰是全库最需要逐个试听的一类**：18 个文件里既有真实物件拟音（`switch-light` `switch-tap` `switch-click-quick`，Mixkit 原名就是 light switch），也有一半以上是合成 UI 反馈音（`ui-confirm-bleep` `ui-confirm-tone` `ui-notify-tech` `ui-success-soft` `ui-tone-quick` `ui-popup-dry` `ui-message-pop` 等，原名 tone/bleep/alert/notification）——**后者正是本条要排除的质感**，除非片子刻意要\"系统提示\"的叙事。名单与取舍见 sound-design 3.3。 - `sfx/glass/` 是真实碎裂材质音（4 个），不在禁列。",
    "check": "闭眼只听音轨：像产品发布会预告，还是像手机游戏？BGM 是在成片里试听后选定的吗？每个 UI 类音效，是真实物件质感还是游戏反馈提示音？",
    "quotes": [
      "这个配乐和音效都太像游戏了。你帮我找那种鼓点强的，节奏感强的，然后音效要那种典型的产品宣传视频的音效",
      "合成器 pluck/bloop、卡通弹跳、game-over 音阶"
    ]
  },
  {
    "id": "S2",
    "group": "S",
    "groupCn": "声音",
    "no": 2,
    "title": "SFX 逐拍钉帧管理；连发音效做双样本交替 + 音量阶梯递减 + 间隔加速，不同响度复读",
    "rule": "SFX 用\"帧号 + 音源 + 音量\"的声明式表集中管理，逐条注释对应的画面动作，杜绝凭感觉铺音效；同类元素连发时防机枪感靠三招——双样本交替、沿序列音量阶梯递减（如 0.40→0.25 六级）、间隔跟随动画曲线加速，密到糊成一片时让声音淡出成 swoosh（本仓库实证无 playbackRate 变调，防机枪不靠变调）。",
    "case": "用户：\"周报左侧栏的每周出现时可以换个音效，能配合每个周的出现的\"（模板片中为周报页）。先立起逐拍钉帧的 SFX 帧号表结构（沿用至成片），再做 pluck 双样本交替、间隔 8→3f 加速，最后把 per-week pop 六连发音量做成 0.40→0.25 阶梯递减。",
    "check": "每条 SFX 是否钉在具体帧号并注释了对应动作？连发段落听起来是\"数得出来的节奏\"还是机械复读？",
    "quotes": [
      "周报左侧栏的每周出现时可以换个音效，能配合每个周的出现的"
    ]
  },
  {
    "id": "S3",
    "group": "S",
    "groupCn": "声音",
    "no": 3,
    "title": "声音在画面锁定后做；时间线一动，SFX 全表重钉",
    "rule": "BGM/SFX 排在画面结构基本锁定之后；任何改变镜头时长/顺序的修改，收尾动作固定包含\"全表 SFX 帧号重对\"——音画错位是交付前必查项。",
    "case": "用户：\"改完这些后重新调整音效位置以匹配新的时间线\"。据此按新时间线（总长 1085f）重钉全表 SFX；教训链：首版 SFX 钉完 11 小时后画面大改导致全表重钉，三次重钉中两次纯属画面返工的连带成本。",
    "check": "本轮有没有镜头时长/顺序变化？变了的话 SFX 表逐条重对过了吗？",
    "quotes": [
      "改完这些后重新调整音效位置以匹配新的时间线"
    ]
  },
  {
    "id": "S4",
    "group": "S",
    "groupCn": "声音",
    "no": 4,
    "title": "拟音优先于装饰音：画面动作配该动作的真实声音，音频裁到与动作严格等长",
    "rule": "画面里发生什么动作就配什么声音（打字画面配键盘声、逐条落入配逐个 pop），泛用 swoosh 盖不住有辨识度的画面动作；长样本按画面段落裁剪（Sequence 截断），时长与动作严格等长。",
    "case": "用户：\"周报页面内容出现的时候可以配打字音效\"（模板片中为周报页）。据此给文档页揭示配打字机音，keyboard.mp3 按语境裁 24f/44f 两个用途。 操作要点（库里的两份特殊名单，见 sound-design 4.1）：**>5s 的长样本（21 个）必须显式给 `durationInFrames`**，漏给会拖过动作结束；带长尾混响的 impact 例外，让尾音自然衰减。**峰值 <-12dB 的轻音素材（7 个）**：`volume` 是乘法系数，给到 1.0 也只是原样播放，仍会被 BGM 盖住——首选换素材或预归一化，必要时给 >1 的增益并以渲染产物验峰。",
    "check": "每个有辨识度的画面动作（打字/点击/落地）有没有自己的拟音？音效有没有拖到动作结束之后还在响？每条音效在成片里真的听得见吗（轻音素材音量够不够）？",
    "quotes": [
      "周报页面内容出现的时候可以配打字音效"
    ]
  },
  {
    "id": "S5",
    "group": "S",
    "groupCn": "声音",
    "no": 5,
    "title": "音画对齐补两项偏移：输出音轨偏移逐渲染管线实测统一扣，音源峰值滞后逐文件量",
    "rule": "渲出成片的整条音轨相对视频有固定滞后，根因在输出编码/封装链路（AAC encoder priming，48kHz 典型 2048 samples ≈1.28f@30fps；Remotion 跟踪 remotion-dev/remotion#7099），不是 `<Audio>`/`Sequence.from` 的行为——按渲染管线（Remotion 版本 + codec + sample rate + 容器）实测记档（渲出成片抽音轨，拿 2–3 个尖锐 SFX 原文件做归一化交叉相关，残差一致才算量准），补偿在渲染层的 from 计算式统一扣除，不逐条改帧号；音源自身的峰值滞后（峰值不在文件头）逐文件量。统一公式 `from = 目标峰值帧 − 峰值滞后 − 输出偏移`，方法与边界（截断型音效窗口不加长、片头 2f 内无法全补）见 sound-design §4.6。",
    "case": "AiflPromo 实测 click 滞后 2032 samples、impact 2066 samples（≈1.27–1.29f），与 AAC priming 指纹吻合，渲染品 elst 未声明裁剪垫头；promo-ink 时代实测过 4f（≈133ms，远超 priming 量级，根因未验证）——常数不可跨管线搬运。不补时两项叠加最重一击晚 0.27s，明显读作音画不同步；卡点片里差 2–3 帧就足以让合理的卡点动效被读作无端抖动（2026-08-22 用户反馈的成因之一）。",
    "check": "本管线的输出音轨偏移实测过吗（Remotion 版本/codec/采样率/容器随值记录在哪）？补偿是 from 计算式统一扣的还是散落在各条帧号里？带明显攻击峰的音源，峰值滞后量过了吗？ ---",
    "quotes": []
  },
  {
    "id": "C1",
    "group": "C",
    "groupCn": "文案",
    "no": 1,
    "title": "文案在画面锁定后按最终镜头重写一遍，纯动画段落也配解说",
    "rule": "初稿文案只是占位——画面定稿后对照成片逐镜头重写；纯动画镜头配短解说 caption，不留\"哑巴段落\"（品牌收尾镜头除外，保持干净）。",
    "case": "用户：\"你根据我现在完整的视频内容，重新写文案的词，我感觉现在的和视频画面不是很匹配，再就是在动画的部分是不是也加一些解说？\"。据此重写标题文案，并给实拍镜头补上 caption 解说。",
    "check": "逐句对照：每句文案和它所在的画面匹配吗？有没有超过 3 秒的无解说动画段落？",
    "quotes": [
      "你根据我现在完整的视频内容，重新写文案的词，我感觉现在的和视频画面不是很匹配，再就是在动画的部分是不是也加一些解说？"
    ]
  },
  {
    "id": "C2",
    "group": "C",
    "groupCn": "文案",
    "no": 2,
    "title": "标语写\"团队 + 产品功能名 + 具体收益\"，抽象隐喻词一律具体化",
    "rule": "标语要具体、带产品功能名（Paper Radar / weekly report），避免抽象隐喻词（board/place 类泛化口号）；重要功能出场前加一张引导字卡。",
    "case": "用户逐字改稿：\"'All your research, one board' 改成'All team's research, one place to go'…'The morning reading'那句改成'Paper Radar, tailored for your morning reading'\"；\"最后文档页展示前，还应该加个文字画面\"（模板片中为周报页）。据此三句逐词替换，并加一张文档页 lead-in 引导字卡。",
    "check": "每句标语里有没有具体的功能名/收益词？有没有只靠隐喻撑着的句子？",
    "quotes": [
      "最后文档页展示前，还应该加个文字画面"
    ]
  },
  {
    "id": "C3",
    "group": "C",
    "groupCn": "文案",
    "no": 3,
    "title": "3D 镜头里的注记文字活在同一 3D 空间：page-space、同透视、斜拍，大字 + 荧光笔 highlight",
    "rule": "给 3D 场景中的主体配画内注记时，文字必须进同一 3D 空间（页面坐标系、同一台相机透视、translateZ 悬浮 + 落影），平面叠字与场景脱节；样式用大衬线字 + 马克笔 highlight 关键词。",
    "case": "用户：\"字在左侧，大一些醒目一下，有highlight，然后字的视角也是3d悬空，并且斜着拍摄的\"（第一版平面字卡被否后重做）。改为把 hero-hover 注记放进 3D——页面坐标系斜视、马克笔 highlight。",
    "check": "3D 镜头里的每块文字：它跟着场景相机动吗，还是贴在屏幕玻璃上？ ---",
    "quotes": [
      "字在左侧，大一些醒目一下，有highlight，然后字的视角也是3d悬空，并且斜着拍摄的"
    ]
  },
  {
    "id": "P1",
    "group": "P",
    "groupCn": "流程",
    "no": 1,
    "title": "交付前必须自己渲染截帧逐一检查，不把首检交给用户",
    "rule": "每轮修改后先自行渲染关键帧截图逐一检查（构图/抖动/文字锐度/穿帮），必要时用像素级工具（裁剪放大/两帧 diff）自证，再交用户。",
    "case": "用户第一次看片即质问：\"你自己有截图检查质量吗？镜头视角很差，而且有小抖动不知道怎么回事\"。此后管线里长出 crop/diff/measure 自检脚本与 out/qa/ 逐版本静帧归档，双方进入基于帧的评审。",
    "check": "这一版交出去之前，我自己看过哪些帧？关键镜头有没有截图证据？",
    "quotes": [
      "你自己有截图检查质量吗？镜头视角很差，而且有小抖动不知道怎么回事"
    ]
  },
  {
    "id": "P2",
    "group": "P",
    "groupCn": "流程",
    "no": 2,
    "title": "参考素材先逐帧拆解成手法清单，再逐镜头判断适配性，不全局套用",
    "rule": "有参考片先抽帧做 motion breakdown（每个动画/转场/特效的实现方式清单）写进 spec，按项目适配性取舍；图片参考描述的是\"某一类镜头\"的感觉而非全片风格令——落地前逐镜头判断适不适用，改完自查再交。",
    "case": "用户：\"从原视频里截取尽可能多的帧……加以复现然后适配到我们的项目，不适合的不用强行适配\"——把参考片的 motion breakdown 写进 spec 后连续放行；反例：三张参考图被全局套用为统一倾斜机位，被否\"做的并不好……回滚\"后逐镜头重做。",
    "check": "参考素材的每个手法有没有\"采用/弃用\"的显式决定？有没有把一张参考图当成了全片风格令？",
    "quotes": [
      "从原视频里截取尽可能多的帧……加以复现然后适配到我们的项目，不适合的不用强行适配"
    ]
  },
  {
    "id": "P3",
    "group": "P",
    "groupCn": "流程",
    "no": 3,
    "title": "指代含糊的反馈先确认对象；改错了整 commit 干净 revert，不在错误版本上打补丁",
    "rule": "\"第一个标题\"式模糊反馈先确认所指再动手；落错对象立即整 commit revert 重来；每个改动保持独立 commit 以便干净回滚。",
    "case": "用户：\"不是第一个字卡，我说的是开头和结尾的AI field lab出现的动画\"。先理解错、hold 了 card1，8 分钟内干净 revert，再对正确对象重做通过。",
    "check": "这条反馈的指代对象我确定吗？当前 commit 粒度出了错能一键回滚吗？",
    "quotes": [
      "不是第一个字卡，我说的是开头和结尾的AI field lab出现的动画"
    ]
  },
  {
    "id": "P4",
    "group": "P",
    "groupCn": "流程",
    "no": 4,
    "title": "先列功能清单逐一对应镜头；一种动画手法全片只当一次主角，重复镜头/信息一律删",
    "rule": "开拍前列产品功能清单（dashboard/详情/论文/周报/品牌）逐一映射镜头，核心功能漏拍等于返工；一种手法（飞入/堆叠/翻页）全片只当一次主角；剪辑自查按\"这个镜头给了什么新信息\"过滤，同一素材/信息全片只出现一次，重复即删。",
    "case": "用户：\"其他动画有些同质了。没有充分展示整个网站的特性\"、\"很不错了，但是没有周报部分的展示？\"（模板片中为周报页）——据此补功能镜头；\"倒数第二个镜头是重复的项目卡片的镜头，可以去掉了\"——据此删掉重复的概览镜头、去重收尾标语。",
    "check": "功能清单每项都有对应镜头吗？有没有两个镜头在用同一种手法当主角、或讲同一件事？",
    "quotes": [
      "其他动画有些同质了。没有充分展示整个网站的特性",
      "很不错了，但是没有周报部分的展示？",
      "倒数第二个镜头是重复的项目卡片的镜头，可以去掉了"
    ]
  }
]

export const GENOMES: Genome[] = [
  {
    "id": "explainer",
    "name": "口播科普",
    "from": "实测",
    "persona": "主持人带你查证",
    "method": {
      "name": "按镜头制作",
      "lead": "一句话一个镜头",
        "media": "/cards/posters/cursor-flyover.jpg",
        "mediaMotion": "/cards/motion/cursor-flyover.mp4",
      "steps": [
        {
          "k": "读懂字幕",
          "name": "读懂这句字幕",
          "judge": "遮住字幕，画面还能不能独立说出同一个意思",
          "img": "/assets/home/step-subtitle.jpg"
        },
        {
          "k": "抽参考帧",
          "name": "抽参考帧并排看",
          "judge": "词面相同不等于画面可用，必须真打开参考视频看图",
          "img": "/assets/home/ref-city.webp"
        },
        {
          "k": "定英雄帧",
          "name": "英雄帧先渲成 PNG，看图答四问",
          "judge": "答不上来就回炉，不许先写动画",
          "img": "/frames/film/s18.jpg",
          "star": true
        },
        {
          "k": "按卡实现",
          "name": "拿卡上的调校参数实现",
          "judge": "从卡出发不从零写；同一处改到第 3 版还不行就换设计",
          "img": "/cards/posters/cursor-flyover.jpg",
          "motion": "/cards/motion/cursor-flyover.mp4",
          "star": true
        }
      ]
    },
    "fp": [
      {
        "k": "平均镜长 ASL",
        "v": "2.0–2.6s"
      },
      {
        "k": "出镜占比",
        "v": "27%"
      },
      {
        "k": "锚点回归",
        "v": "每 5.0s"
      },
      {
        "k": "暗部落点",
        "v": "1.7（近纯黑）"
      },
      {
        "k": "响度",
        "v": "−19.5 LUFS"
      }
    ],
    "img": "/frames/film/s09.jpg",
    "traits": [
      "旁白字幕烧入全片",
      "素材插片（新闻/影片/照片）",
      "切点落在语音停顿里 73%"
    ],
    "note": "本项目的片型。"
  },
  {
    "id": "chat",
    "name": "对话访谈",
    "from": "实测",
    "persona": "朋友跟你聊",
    "method": {
      "name": "按话轮制作",
      "lead": "先切话轮，再配画面",
        "media": "/cards/posters/avatar-bracket-carousel.jpg",
        "mediaMotion": "/cards/motion/avatar-bracket-carousel.mp4",
      "steps": [
        {
          "k": "切话轮",
          "name": "切话轮，标出每段的落点句",
          "judge": "落点句决定这一段什么时候上图卡",
          "img": "/frames/film/s13.jpg"
        },
        {
          "k": "补图卡",
          "name": "说到数字就上图卡",
          "judge": "两张脸对切超过 8 秒，观众就想跳过",
          "img": "/cards/posters/hatch-depth.jpg",
          "motion": "/cards/motion/hatch-depth.mp4"
        },
        {
          "k": "锁机位",
          "name": "机位锁死，不做运镜",
          "judge": "机位越稳人格越近，NCC ≥ 0.96 才算锁住",
          "img": "/assets/home/ref-portrait.webp"
        },
        {
          "k": "回锚点",
          "name": "呼吸级锚点：每 3 秒回一次脸",
          "judge": "超过 3 秒没回锚点，观众会走神",
          "img": "/cards/posters/avatar-bracket-carousel.jpg",
          "motion": "/cards/motion/avatar-bracket-carousel.mp4",
          "star": true
        }
      ]
    },
    "fp": [
      {
        "k": "平均镜长 ASL",
        "v": "2.0–2.4s"
      },
      {
        "k": "出镜占比",
        "v": "57%"
      },
      {
        "k": "锚点回归",
        "v": "每 3.0s"
      },
      {
        "k": "机位",
        "v": "锁死（NCC 0.96）"
      },
      {
        "k": "响度",
        "v": "−16.1 LUFS"
      }
    ],
    "img": "/assets/home/ref-portrait.webp",
    "traits": [
      "呼吸级锚点（每 3 秒回一次）",
      "大量图卡做数据可视化",
      "暗部保留细节（12.3）"
    ],
    "note": "机位越稳，人格越近。"
  },
  {
    "id": "book",
    "name": "讲书解读",
    "from": "实测",
    "persona": "讲书人",
    "method": {
      "name": "按页制作",
      "lead": "一页一个论点，不做实拍",
        "media": "/cards/posters/word-relay-filmstrip.jpg",
      "steps": [
        {
          "k": "拆论点",
          "name": "拆成一页一个论点",
          "judge": "论点排好了，节奏自然慢下来",
          "img": "/cards/posters/word-relay-filmstrip.jpg"
        },
        {
          "k": "出版式",
          "name": "先出版式再出动画",
          "judge": "页内只做一次位移或揭示，不许堆效果",
          "img": "/cards/posters/paper-title-card.jpg",
          "star": true
        },
        {
          "k": "放慢节奏",
          "name": "时长给足 4–5s",
          "judge": "慢是这个片型的判据，不是缺点",
          "img": "/cards/posters/outline-word-fill.jpg"
        },
        {
          "k": "不回锚点",
          "name": "不做锚点回归",
          "judge": "不建立亲密感，直接给结论",
          "img": "/cards/posters/grain-dissolve.jpg",
          "motion": "/cards/motion/grain-dissolve.mp4"
        }
      ]
    },
    "fp": [
      {
        "k": "平均镜长 ASL",
        "v": "4.3–5.5s"
      },
      {
        "k": "出镜占比",
        "v": "0%"
      },
      {
        "k": "锚点回归",
        "v": "无"
      },
      {
        "k": "暗部落点",
        "v": "0.0"
      },
      {
        "k": "响度",
        "v": "−9.0（过载）"
      }
    ],
    "img": "/cards/posters/word-relay-geometry.jpg",
    "traits": [
      "全程书页/截图",
      "页内动画，无实拍",
      "极慢节奏"
    ],
    "note": "不建立亲密，直接给结论。"
  },
  {
    "id": "promo",
    "name": "产品宣传",
    "from": "规格",
    "persona": "产品自己说话",
    "method": {
      "name": "按卖点制作",
      "lead": "一个卖点一条镜头",
        "media": "/cards/posters/cube-navigation.jpg",
        "mediaMotion": "/cards/motion/cube-navigation.mp4",
      "steps": [
        {
          "k": "真截图",
          "name": "真实页面截图，不许手搓 UI",
          "judge": "第一步就起 dev server 截全页 2x + 元素级抠图",
          "img": "/cards/posters/dashboard-glow-highlight-pill.jpg",
          "star": true
        },
        {
          "k": "运动弧",
          "name": "一个卖点一条运动弧",
          "judge": "聚光→推近→悬浮→归位，一条弧讲完一个卖点",
          "img": "/cards/posters/cube-navigation.jpg",
          "motion": "/cards/motion/cube-navigation.mp4"
        },
        {
          "k": "卡拍切",
          "name": "转场钉在鼓点上",
          "judge": "先做节奏分析，切点落在真实瞬态而不是网格插值点",
          "img": "/cards/posters/circle-match-iris.jpg",
          "motion": "/cards/motion/circle-match-iris.mp4"
        },
        {
          "k": "一次扫光",
          "name": "一个镜头最多一次扫光",
          "judge": "装饰性 glint 群发即廉价，单点高质量光效可做",
          "img": "/cards/posters/spotlight-hero-card.jpg",
          "star": true
        }
      ]
    },
    "fp": [
      {
        "k": "镜头时长",
        "v": "4–8s"
      },
      {
        "k": "画幅",
        "v": "2.39:1 或 16:9 加黑边"
      },
      {
        "k": "帧率",
        "v": "24fps"
      },
      {
        "k": "目标响度",
        "v": "−14 LUFS"
      },
      {
        "k": "音乐",
        "v": "60–90 BPM"
      }
    ],
    "traits": [
      "真实页面截图（不许手搓 UI）",
      "2.5D 运镜 + 拍点切",
      "一个镜头最多一次扫光"
    ],
    "note": "video-shotcraft 的模板片就是这个型。"
  },
  {
    "id": "short",
    "name": "短视频",
    "from": "规格",
    "persona": "1 秒定生死",
    "method": {
      "name": "按钩子制作",
      "lead": "前三秒定生死",
        "media": "/cards/posters/counter-confetti.jpg",
        "mediaMotion": "/cards/motion/counter-confetti.mp4",
      "steps": [
        {
          "k": "写钩子",
          "name": "先写钩子，再写内容",
          "judge": "3 秒内没说清「这条跟我有关」，后面全是白做",
          "img": "/cards/posters/fracture.jpg",
          "star": true
        },
        {
          "k": "字幕烧入",
          "name": "字幕强制烧入",
          "judge": "85% 的观看是静音，没有字幕等于没有内容",
          "img": "/cards/posters/flying-words.jpg",
          "motion": "/cards/motion/flying-words.mp4"
        },
        {
          "k": "安全区",
          "name": "按 900×1400 安全区居中",
          "judge": "竖屏裁切不许切到主体",
          "img": "/cards/posters/radial-ripple-phone-chips.jpg"
        },
        {
          "k": "按拍排",
          "name": "按 120–140 BPM 排节奏",
          "judge": "完播率优先，不是信息量优先",
          "img": "/cards/posters/counter-confetti.jpg",
          "motion": "/cards/motion/counter-confetti.mp4"
        }
      ]
    },
    "fp": [
      {
        "k": "画幅",
        "v": "9:16（1080×1920）"
      },
      {
        "k": "时长",
        "v": "15s / 30s / 60s"
      },
      {
        "k": "钩子",
        "v": "前 1–2 秒"
      },
      {
        "k": "视觉变化",
        "v": "每 1–3 秒"
      },
      {
        "k": "字号",
        "v": "≥42px"
      }
    ],
    "traits": [
      "字幕强制（85% 静音观看）",
      "安全区 900×1400 居中",
      "音乐 120–140 BPM"
    ],
    "note": "完播率优先，不是信息量优先。"
  },
  {
    "id": "long",
    "name": "长视频",
    "from": "规格",
    "persona": "章节式讲述",
    "method": {
      "name": "按章节制作",
      "lead": "两到四分钟一章",
        "media": "/cards/posters/carousel-3d.jpg",
        "mediaMotion": "/cards/motion/carousel-3d.mp4",
      "steps": [
        {
          "k": "先分章",
          "name": "每章 2–4 分钟，章内自洽",
          "judge": "观众从任何一章进来都要能看懂",
          "img": "/cards/posters/carousel-3d.jpg",
          "motion": "/cards/motion/carousel-3d.mp4",
          "star": true
        },
        {
          "k": "给足信息",
          "name": "30 秒悬崖前给足信息",
          "judge": "前 30 秒是唯一的生死线",
          "img": "/frames/film/s21.jpg"
        },
        {
          "k": "压低音乐",
          "name": "音乐床压低 18–20dB",
          "judge": "人声永远在最前面",
          "img": "/assets/home/temple.webp"
        },
        {
          "k": "留片尾",
          "name": "结尾 20s 留 end screen",
          "judge": "平台会读这 20 秒",
          "img": "/cards/posters/logo-shrink-wordmark-lockup.jpg"
        }
      ]
    },
    "fp": [
      {
        "k": "时长",
        "v": "8–15 min"
      },
      {
        "k": "钩子",
        "v": "0:30 前完成"
      },
      {
        "k": "打断",
        "v": "每 45–90s"
      },
      {
        "k": "留存目标",
        "v": "40–60%"
      },
      {
        "k": "语速",
        "v": "150–160 WPM"
      }
    ],
    "traits": [
      "章节 2–4 分钟",
      "音乐床压低 18–20dB",
      "结尾 20s 留 end screen"
    ],
    "note": "30 秒悬崖是第一个生死线。"
  }
]

/**
 * 支持的动效来源 —— 首页「动效来源」三张卡。
 * 这里放的是**真的能用起来的库**（全部开源），不是装饰性合作伙伴：
 * 每张卡点开就是它的在线画廊，用户自己就能去挑镜头、抄组件。
 * 结构 = 后端 /api/sources 该下发的东西。
 */
export interface MotionSource {
  id: string; name: string; en: string; url: string; logo: string
  /** 一句话：这个库解决什么 */
  what: string
  /** 规模（能数出来的数） */
  count: string
  /** 品牌色：logo 底衬 + 悬停描边用它自己的色，不统一染色 */
  tone: string
}

export const SOURCES: MotionSource[] = [
  {
    "id": "shotcraft",
    "name": "镜刻",
    "en": "video-shotcraft",
    "url": "https://vincentwei1021.github.io/video-shotcraft/",
    "logo": "/assets/partners/shotcraft.svg",
    "what": "这个镜头该长什么样：配方卡 + 动态样片画廊，卡上有调校参数和已知坑",
    "count": "157 张卡 · 214 条样片",
    "tone": "#D3923C"
  },
  {
    "id": "scenes",
    "name": "Remotion Scenes",
    "en": "remotion-scenes",
    "url": "https://lifeprompt-team.github.io/remotion-scenes/",
    "logo": "/assets/partners/scenes.svg",
    "what": "这段效果怎么写：201 个带源码的场景组件，逐条在线预览",
    "count": "201 个场景 · 16 类",
    "tone": "#6366F1"
  },
  {
    "id": "rve",
    "name": "React Video Editor",
    "en": "remotion-templates",
    "url": "https://www.reactvideoeditor.com/",
    "logo": "/assets/partners/rve.svg",
    "what": "复制即用的零依赖模板：单文件不牵连公共库，81 个覆盖 9 类",
    "count": "81 个模板 · 9 类",
    "tone": "#3D4BE0"
  }
]

export const METHODS: Methods = {
  "stages": [
    {
      "id": "1",
      "name": "素材与参照",
      "lead": "先读懂这句话在说什么，再决定画面长什么样",
      "ev": "/assets/home/ref-city.webp",
      "gates": [
        {
          "id": "0-A-0",
          "name": "读懂这句字幕",
          "out": "字面/语气/功能/观众反应/一句话任务",
          "judge": "遮住字幕，画面能不能独立传达同一个意思？不能 = 两张皮",
          "star": true
        },
        {
          "id": "0-A-1",
          "name": "定位参考段落",
          "out": "检索到的候选 + 抽帧看过的证据",
          "judge": "旁白词面相同 ≠ 画面可用，必须抽帧"
        },
        {
          "id": "0-A",
          "name": "抽参考帧并排看",
          "out": "并排图",
          "judge": "不是读报告，是真的打开参考视频看图"
        },
        {
          "id": "0-B",
          "name": "数码表",
          "out": "元素个数/信息量/素材占比",
          "judge": "任何一项差 ≥2 倍 → 重做"
        },
        {
          "id": "0-C",
          "name": "真实素材清单",
          "out": "这一镜需要什么素材",
          "judge": "找不到就停下来问，不许用 CSS 画一个凑",
          "star": true
        }
      ]
    },
    {
      "id": "2",
      "name": "视觉定稿",
      "lead": "先把英雄帧画出来，再设计怎么到达它",
      "ev": "/frames/film/s18.jpg",
      "gates": [
        {
          "id": "1",
          "name": "英雄帧先渲成 PNG，看图答四问",
          "out": "PNG + 四个答案",
          "judge": "答不上来 → 回炉，不许写动画",
          "star": true
        },
        {
          "id": "1+",
          "name": "新增第 5 问",
          "out": "焦点数 / 层数",
          "judge": "焦点 ≥2、层数 ≥3"
        },
        {
          "id": "2",
          "name": "三个方案，必须实质不同",
          "out": "3 个方案",
          "judge": "遮住文字看，三张图是三件不同的事吗"
        }
      ]
    },
    {
      "id": "3",
      "name": "实现",
      "lead": "拿卡上的调校参数实现，不从零写",
      "ev": "/cards/posters/cursor-flyover.jpg",
      "gates": [
        {
          "id": "3",
          "name": "看 → 诊断 → 改",
          "out": "具体到帧的诊断",
          "judge": "先看图再看数字，顺序不能反"
        },
        {
          "id": "4",
          "name": "止损",
          "out": "——",
          "judge": "同一处改到第 3 版还不行 → 换设计，不许调参数",
          "star": true
        },
        {
          "id": "4+",
          "name": "换人",
          "out": "委托说明 + 审核报告",
          "judge": "换了轴还不行 → 换人；但必须三层审核（事实/可行性/判据）",
          "star": true
        }
      ]
    },
    {
      "id": "4",
      "name": "审查",
      "lead": "独立审查必须由子智能体做",
      "ev": "/frames/film/s13.jpg",
      "gates": [
        {
          "id": "5",
          "name": "独立审查",
          "out": "审核报告",
          "judge": "必须由子智能体做，不能自审",
          "star": true
        },
        {
          "id": "6",
          "name": "主智能体逐条核实",
          "out": "核实结论",
          "judge": "子智能体可能给出你做不到的方案"
        }
      ]
    }
  ],
  "retrieval": [
    {
      "n": 1,
      "what": "本机镜头卡库",
      "where": "157 张配方卡 + 221 个 demo 源码",
      "note": "最优先，卡描述只是索引，源码里才是调好的参数"
    },
    {
      "n": 2,
      "what": "本机动效库",
      "where": "301 个现成组件",
      "note": "找 React 零件"
    },
    {
      "n": 3,
      "what": "GitHub / 网络",
      "where": "外部",
      "note": "近似的实现与教程"
    },
    {
      "n": 4,
      "what": "自研",
      "where": "——",
      "note": "实在找不到才走这条"
    }
  ],
  "checklist": [
    {
      "g": "A",
      "name": "自动化检查",
      "items": "帧差 / 空场 / 静止"
    },
    {
      "g": "B",
      "name": "几何检查（用运行时真实几何，不是看源码）",
      "items": "不连续跳变 · 加速突变 · 可读停留太短 · 多数元素同时启动 · 过多焦点同时运动 · 出安全区 · 强烈非计划重叠",
      "n": 7
    },
    {
      "g": "C",
      "name": "边缘检查",
      "items": "防白边 / 黑边"
    },
    {
      "g": "D",
      "name": "音频检查",
      "items": "响度 / 峰值 / 音画对齐"
    },
    {
      "g": "E",
      "name": "语义检查",
      "items": "针对口播配画面：遮住字幕还成立吗"
    },
    {
      "g": "F",
      "name": "节奏检查",
      "items": "ASL / 呼吸 / 峰值"
    },
    {
      "g": "G",
      "name": "素材检查",
      "items": "来源 / 许可 / 分辨率"
    },
    {
      "g": "H",
      "name": "最后一步",
      "items": "自己渲染一版从头看一遍"
    }
  ]
}

/** 首页展示这些 —— 不是全部（157 张全铺会拖垮首屏，也淹没重点） */
/**
 * 首页「镜头卡库」的两组精选 —— 就是将来后端 /api/cards?featured=1 要下发的东西。
 *
 * 分两组的理由：轮播的当前项会**放大到 384px 并播放动作预览**，
 * 静帧卡撑不起这个位置；网格是一排 16:10 的静帧，画面清不清楚一眼能比。
 * 两组**不重叠** —— 同一张卡在轮播里出现又在网格里出现，看着像重复推荐。
 *
 * 排序按分类轮转，让首屏一眼看到「各类都有」，不是清一色的转场或文字。
 */
export const HOME_REEL: string[] = [
  // 开场 → 界面入场 → 运镜 → 转场 → 数据 → 文字 → 节奏
  "opening/magician-card-flourish",
  "ui-entrance/card-stack",
  "camera/cursor-flyover",
  "transition/circle-match-iris",
  "data/counter-confetti",
  "typography/flying-words",
  "ui-entrance/carousel-3d",
  "transition/mosaic-reframe",
  "camera/terminal-3d",
  "transition/cube-navigation",
  "rhythm/beat-step-list-theme-cycle",
  "ui-entrance/avatar-bracket-carousel"
]

export const HOME_GRID: string[] = [
  "opening/fracture",
  "ui-entrance/bezier-source-converge-merge",
  "effects/assemble-then-type-flyin",
  "typography/paper-title-card",
  "transition/bottom-push-stack-wipe",
  "interaction/picker-carousel-feature-cycle",
  "ui-entrance/svg-shape-morph",
  "data/avatar-grid-radial-build-colorize",
  "effects/dashboard-glow-highlight-pill",
  "interaction/autolayout-gap-dial"
]

/** 判例按组归拢，顺序固定：节奏 → 质感 → 声音 → 文案 → 流程 */
export const RULE_GROUPS = ['节奏', '质感·运镜·构图', '声音', '文案', '流程']

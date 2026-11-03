/**
 * 参考片库数据层 —— 从 reference 复刻页抽出并整理。
 *
 * 21 个片段 / 11 部参考片，静帧位于 public/reference/shots/{segmentId}.webp。
 * 单位口径与项目一致：项目已去除「镜头」单位，参考片的分析单位为片段
 * （一段连续时间范围）；数据 id 沿用历史值（shot-*），不影响引用与本地存档。
 * 分析字段与置信度来自现有演示数据，不新增、不推断；pending 字段保持「待分析」。
 */

export type ReferenceStatus = 'analyzed' | 'partial' | 'pending'

export interface ReferenceVideo {
  id: string
  title: string
  duration: number
  source: string
  description: string
  /** 对应现有技法动态示例；缺失时只展示静帧，不模拟视频播放。 */
  previewVideo?: string
  tags: string[]
}

/**
 * 参考片段的「可借鉴点」—— 给用户看的那一层，不是工作流内部记账。
 *
 * 口径（2026-10-29 与作者对齐）：
 *   分析由后端视觉模型完成，前端只负责展示与交互；
 *   用户要回答的是「这条片段能不能拿来创作」，所以只留创作时用得上的六项。
 *
 * 已删掉的：confidence 百分比（编造的数字，工作流只认 high/medium/low）、
 *            「关键帧 00:02」这类无出处的佐证、景别/主体运动/色彩/叙事等
 *            技术分类（用户无法据此决策）。
 */
export interface AnalysisValue {
  value: string
  /** 该值的来源：后端实测（切点/亮度/运动量）还是模型判断。
   *  界面上要能区分 —— 用户需要知道哪些数字是真的量出来的。 */
  source: 'measured' | 'model'
  pending: boolean
}

export type AnalysisKey =
  | 'cameraMove' | 'rhythm' | 'lighting' | 'composition' | 'transition' | 'reusable'

export interface ReferenceSegment {
  id: string
  videoId: string
  index: number
  start: number
  end: number
  status: ReferenceStatus
  tags: string[]
  observation: string
  inference: string
  suggestion: string
  analysis: Record<AnalysisKey, AnalysisValue>
}

export interface ReferenceCollection {
  id: string
  name: string
  note: string
  segmentIds: string[]
}

export const REFERENCE_VIDEOS: ReferenceVideo[] = [
  {
    "id": "ref-dolly-zoom",
    "previewVideo": "./fx/motion/fx-dolly-zoom.mp4",
    "title": "沙漠公路",
    "duration": 10,
    "source": "AI 生成",
    "description": "人物剪影居中，背景纵深持续拉伸的多莉变焦片段。",
    "tags": [
      "多莉变焦",
      "眩晕",
      "人物剪影",
      "沙漠",
      "心理"
    ]
  },
  {
    "id": "ref-glitch",
    "previewVideo": "./fx/motion/fx-glitch-transition.mp4",
    "title": "霓虹故障转场",
    "duration": 10,
    "source": "AI 生成",
    "description": "数字故障撕裂画面的高能量转场，RGB 分离与扫描线。",
    "tags": [
      "故障转场",
      "赛博",
      "跳切",
      "霓虹"
    ]
  },
  {
    "id": "ref-light-leak",
    "previewVideo": "./fx/motion/fx-light-leak.mp4",
    "title": "黄昏山地漏光",
    "duration": 10,
    "source": "AI 生成",
    "description": "暖橙色漏光扫过黄昏山地，复古胶片温度。",
    "tags": [
      "漏光",
      "复古",
      "黄昏",
      "山地",
      "暖调"
    ]
  },
  {
    "id": "ref-ember",
    "previewVideo": "./fx/motion/fx-ember-particles.mp4",
    "title": "暗夜余烬粒子",
    "duration": 10,
    "source": "AI 生成",
    "description": "余烬火星在暗背景中冉冉上升，浅景深。",
    "tags": [
      "粒子",
      "余烬",
      "暗调",
      "氛围"
    ]
  },
  {
    "id": "ref-teal",
    "previewVideo": "./fx/motion/fx-teal-orange.mp4",
    "title": "海岸悬崖",
    "duration": 10,
    "source": "AI 生成",
    "description": "青橙商业片调色的海岸悬崖大远景。",
    "tags": [
      "青橙调",
      "调色",
      "海岸",
      "大远景",
      "史诗"
    ]
  },
  {
    "id": "ref-kinetic",
    "previewVideo": "./fx/motion/fx-kinetic-type.mp4",
    "title": "动态排版律动",
    "duration": 10,
    "source": "AI 生成",
    "description": "抽象字形随节奏缩放位移的动态排版。",
    "tags": [
      "动态排版",
      "文字动画",
      "节奏",
      "抽象"
    ]
  },
  {
    "id": "ref-title",
    "previewVideo": "./fx/motion/fx-title-reveal.mp4",
    "title": "黑底标题揭示",
    "duration": 3,
    "source": "AI 生成",
    "description": "光扫过黑底标题的仪式感揭示。",
    "tags": [
      "标题揭示",
      "片头",
      "极简",
      "黑底"
    ]
  },
  {
    "id": "ref-city-night",
    "title": "雨夜霓虹街道",
    "duration": 10,
    "source": "AI 生成",
    "description": "雨夜霓虹街道的缓慢推镜，湿润路面反射。",
    "tags": [
      "夜景",
      "雨",
      "霓虹",
      "推镜",
      "都市",
      "忧郁"
    ]
  },
  {
    "id": "ref-dialogue",
    "title": "暖调双人对话",
    "duration": 10,
    "source": "AI 生成",
    "description": "暖调室内双人剪影对话，中景，实用光源。",
    "tags": [
      "对话",
      "中景",
      "暖调",
      "室内",
      "剪影"
    ]
  },
  {
    "id": "ref-product",
    "title": "腕表旋转展示",
    "duration": 10,
    "source": "AI 生成",
    "description": "奢华腕表在暗背景中旋转展示，戏剧性轮廓光。",
    "tags": [
      "产品",
      "旋转",
      "特写",
      "影棚",
      "奢华"
    ]
  },
  {
    "id": "ref-ocean",
    "title": "航拍海浪",
    "duration": 10,
    "source": "AI 生成",
    "description": "航拍慢动作海浪，青绿色水面与白色泡沫纹理。",
    "tags": [
      "航拍",
      "海浪",
      "慢动作",
      "自然",
      "舒缓"
    ]
  }
]

export const REFERENCE_SEGMENTS: ReferenceSegment[] = [
  {
    "id": "shot-dolly-a",
    "videoId": "ref-dolly-zoom",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "人物剪影立于沙漠公路中央静止不动，背景道路线条持续向外拉伸。",
    "inference": "多莉变焦制造空间异化感，暗示人物心理剧变或顿悟时刻。",
    "suggestion": "悬疑 / 心理题材的揭示时刻可直接复用此运镜；主体必须居中。",
    "tags": [
      "多莉变焦",
      "中景",
      "剪影",
      "推进"
    ],
    "analysis": {
      "cameraMove": {
        "value": "多莉变焦 · 推进",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓转紧凑",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "逆光剪影",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "中心构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-dolly-b",
    "videoId": "ref-dolly-zoom",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "analyzed",
    "observation": "变焦方向反转，背景向内压缩，人物依然居中静止。",
    "inference": "拉远变焦常用于情绪抽离或梦醒段落。",
    "suggestion": "与推进段落配对使用，形成完整的心理起伏。",
    "tags": [
      "多莉变焦",
      "中景",
      "拉远"
    ],
    "analysis": {
      "cameraMove": {
        "value": "多莉变焦 · 拉远",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "紧凑",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "逆光剪影",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "中心构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-glitch-a",
    "videoId": "ref-glitch",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "抽象霓虹画面被数字故障撕裂，出现 RGB 分离与扫描线。",
    "inference": "故障作为转场手段，适用于高能量跳切。",
    "suggestion": "科技产品片与 MV 跳切可复用；故障区控制在 1 秒内。",
    "tags": [
      "故障转场",
      "赛博",
      "跳切"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "急促",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "自发光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "碎片化",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "故障撕裂切入",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-glitch-b",
    "videoId": "ref-glitch",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "partial",
    "observation": "故障减弱，新场景在残留伪影中建立。",
    "inference": "转场收尾段，伪影残留用于衔接连贯性。",
    "suggestion": "收尾时让伪影快速衰减，避免拖节奏。",
    "tags": [
      "故障转场",
      "新场景"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "中速",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "碎片化",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "故障收尾",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-leak-a",
    "videoId": "ref-light-leak",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "黄昏山地全景，暖橙色漏光从右上扫过画面。",
    "inference": "漏光赋予复古温度，常用于回忆段落。",
    "suggestion": "回忆 / 婚礼段落叠加漏光；避开主体面部。",
    "tags": [
      "漏光",
      "全景",
      "黄昏",
      "复古"
    ],
    "analysis": {
      "cameraMove": {
        "value": "缓慢横移",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "自然黄昏光 + 漏光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "三分法 · 地平线",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-leak-b",
    "videoId": "ref-light-leak",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "analyzed",
    "observation": "漏光强度减弱，山地轮廓更清晰。",
    "inference": "漏光起伏与情绪曲线同步。",
    "suggestion": "漏光强度做关键帧起伏，避免全程恒定。",
    "tags": [
      "漏光",
      "全景",
      "减弱"
    ],
    "analysis": {
      "cameraMove": {
        "value": "缓慢横移",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "自然黄昏光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "三分法 · 地平线",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-ember-a",
    "videoId": "ref-ember",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "余烬火星在暗背景中冉冉上升，浅景深。",
    "inference": "余烬营造温暖或毁灭氛围，取决于上下文。",
    "suggestion": "篝火夜话 / 废墟段落叠加余烬；暗背景效果最佳。",
    "tags": [
      "粒子",
      "余烬",
      "暗调",
      "氛围"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "点光源",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "散点构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-ember-b",
    "videoId": "ref-ember",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "partial",
    "observation": "粒子密度略降，运动轨迹延续。",
    "inference": "氛围延续段。",
    "suggestion": "长段落可循环使用，注意首尾衔接。",
    "tags": [
      "粒子",
      "余烬",
      "延续"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "散点构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-teal-a",
    "videoId": "ref-teal",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "海岸悬崖大远景，阴影偏青、高光偏橙。",
    "inference": "经典商业片青橙调，用于史诗感建立。",
    "suggestion": "预告片 / 人物特写可套用此调色；注意保护肤色。",
    "tags": [
      "青橙调",
      "大远景",
      "海岸",
      "史诗"
    ],
    "analysis": {
      "cameraMove": {
        "value": "缓慢推镜",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "黄昏侧光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "三分法",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-teal-b",
    "videoId": "ref-teal",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "partial",
    "observation": "推镜继续，海岸线细节渐显。",
    "inference": "建立段落的延续。",
    "suggestion": "推镜速度保持线性，避免中段加速。",
    "tags": [
      "青橙调",
      "大远景",
      "延续"
    ],
    "analysis": {
      "cameraMove": {
        "value": "缓慢推镜",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "三分法",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-kinetic-a",
    "videoId": "ref-kinetic",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "抽象字形在深色背景上缩放位移，带动态模糊。",
    "inference": "文字随节奏运动，用于信息强调。",
    "suggestion": "歌词视频 / 广告口号可复用；断句决定节奏。",
    "tags": [
      "动态排版",
      "文字动画",
      "节奏"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "紧凑",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "不适用",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "居中排印",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-kinetic-b",
    "videoId": "ref-kinetic",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "analyzed",
    "observation": "字形运动延续，出现新的排印组合。",
    "inference": "排版段落的延续。",
    "suggestion": "重音词放大强调，与鼓点对齐。",
    "tags": [
      "动态排版",
      "延续"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "紧凑",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "不适用",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "居中排印",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-title-a",
    "videoId": "ref-title",
    "index": 0,
    "start": 0,
    "end": 3,
    "status": "analyzed",
    "observation": "黑底上标题渐显，一束光横向扫过字形。",
    "inference": "电影片头式揭示，用于仪式感开场。",
    "suggestion": "片头 / 章节转场使用；标题宜短，落幅留白 0.5 秒。",
    "tags": [
      "标题揭示",
      "片头",
      "极简"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "不适用",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "居中排印",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "渐显 + 光扫",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-city-a",
    "videoId": "ref-city-night",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "雨夜霓虹街道全景，缓慢推镜，湿润路面反射招牌。",
    "inference": "都市忧郁氛围的经典建立方式。",
    "suggestion": "离别 / 悬疑段落可用；可叠加雨效增强。",
    "tags": [
      "夜景",
      "雨",
      "霓虹",
      "推镜",
      "都市"
    ],
    "analysis": {
      "cameraMove": {
        "value": "缓慢推镜",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "霓虹实用光 + 雨反射",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "引导线 · 街道纵深",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-city-b",
    "videoId": "ref-city-night",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "partial",
    "observation": "推镜继续，街道细节渐近。",
    "inference": "建立段落的延续。",
    "suggestion": "推镜落幅宜落在有视觉重心的位置。",
    "tags": [
      "夜景",
      "雨",
      "推镜",
      "延续"
    ],
    "analysis": {
      "cameraMove": {
        "value": "缓慢推镜",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "霓虹实用光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-dlg-a",
    "videoId": "ref-dialogue",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "暖调室内双人剪影中景，隔桌对谈，实用光源。",
    "inference": "亲密对话场景的经典处理。",
    "suggestion": "文戏对话可复用此光位；注意双人视线关系。",
    "tags": [
      "对话",
      "中景",
      "暖调",
      "室内"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "实用光源 · 暖",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "双人对称",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-dlg-b",
    "videoId": "ref-dialogue",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "analyzed",
    "observation": "对话继续，剪影姿态微变。",
    "inference": "对话段落的延续。",
    "suggestion": "长对话可插入过肩镜头打破单一机位。",
    "tags": [
      "对话",
      "中景",
      "延续"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "实用光源 · 暖",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "双人对称",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "延续（无剪辑点）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-prod-a",
    "videoId": "ref-product",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "奢华腕表特写在暗背景中匀速旋转，戏剧性轮廓光。",
    "inference": "高端产品展示的标准手法。",
    "suggestion": "产品片可直接复用此机位与光位；转速保持恒定。",
    "tags": [
      "产品",
      "特写",
      "旋转",
      "影棚"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位 · 主体旋转",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "中速",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "轮廓光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "中心构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-prod-b",
    "videoId": "ref-product",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "partial",
    "observation": "切入更近的微距细节，表盘纹理清晰。",
    "inference": "产品细节强调段落。",
    "suggestion": "特写接大特写时注意旋转方向一致。",
    "tags": [
      "产品",
      "大特写",
      "细节"
    ],
    "analysis": {
      "cameraMove": {
        "value": "固定机位 · 主体旋转",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "中速",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "中心构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "跳切（景别变化）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-ocean-a",
    "videoId": "ref-ocean",
    "index": 0,
    "start": 0,
    "end": 5,
    "status": "analyzed",
    "observation": "航拍大远景，海浪缓慢涌向岸边，青绿色水面。",
    "inference": "冥想式空镜，常用于转场呼吸。",
    "suggestion": "章节间转场可用作呼吸点；配乐宜极简。",
    "tags": [
      "航拍",
      "海浪",
      "慢动作",
      "自然"
    ],
    "analysis": {
      "cameraMove": {
        "value": "航拍悬停",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "舒缓",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "阴天柔光",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "纹理构图",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "硬切入（段落首镜）",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  },
  {
    "id": "shot-ocean-b",
    "videoId": "ref-ocean",
    "index": 1,
    "start": 5,
    "end": 10,
    "status": "pending",
    "observation": "海浪延续。",
    "inference": "尚未分析。",
    "suggestion": "等待分析完成后可用于转场参考。",
    "tags": [
      "海浪",
      "待分析"
    ],
    "analysis": {
      "cameraMove": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "rhythm": {
        "value": "待分析",
        "source": "measured",
        "pending": false
      },
      "lighting": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "composition": {
        "value": "待分析",
        "source": "model",
        "pending": false
      },
      "transition": {
        "value": "待分析",
        "source": "measured",
        "pending": false
      },
      "reusable": {
        "value": "可借鉴结构，不建议照搬画面",
        "source": "model",
        "pending": false
      }
    }
  }
]

export const REFERENCE_COLLECTIONS: ReferenceCollection[] = [
  {
    "id": "col-transition",
    "name": "转场与节奏",
    "note": "故障、漏光、排版与标题",
    "segmentIds": [
      "shot-glitch-a",
      "shot-glitch-b",
      "shot-leak-a",
      "shot-leak-b",
      "shot-kinetic-a",
      "shot-kinetic-b",
      "shot-title-a"
    ]
  },
  {
    "id": "col-character",
    "name": "人物与情绪",
    "note": "剪影、对话与都市夜景",
    "segmentIds": [
      "shot-dolly-a",
      "shot-dolly-b",
      "shot-dlg-a",
      "shot-dlg-b",
      "shot-city-a",
      "shot-city-b",
      "shot-ember-a",
      "shot-ember-b"
    ]
  },
  {
    "id": "col-nature",
    "name": "自然与空镜",
    "note": "海岸、山地与暗夜余烬",
    "segmentIds": [
      "shot-ocean-a",
      "shot-ocean-b",
      "shot-teal-a",
      "shot-teal-b",
      "shot-ember-a",
      "shot-ember-b"
    ]
  },
  {
    "id": "col-product",
    "name": "产品与细节",
    "note": "腕表旋转与微距细节",
    "segmentIds": [
      "shot-prod-a",
      "shot-prod-b"
    ]
  }
]

/**
 * 参考片段的六项可借鉴点。
 * 前五项是「怎么做出来的」（创作时照着模仿），最后一项是「能不能用」的结论。
 * 分组只留两组：画面 / 时间后面再加「结论」由界面单独处理。
 */
export const ANALYSIS_FIELDS: Array<{ key: AnalysisKey; label: string; hint: string; group: '画面' | '时间' }> = [
  { key: 'cameraMove',   label: '运镜', hint: '镜头怎么动',   group: '画面' },
  { key: 'composition',  label: '构图', hint: '主体怎么放',   group: '画面' },
  { key: 'lighting',     label: '光线', hint: '光从哪来',     group: '画面' },
  { key: 'rhythm',       label: '节奏', hint: '快慢与停顿',   group: '时间' },
  { key: 'transition',   label: '转场', hint: '镜头怎么接',   group: '时间' },
]

export const STATUS_META: Record<ReferenceStatus, { label: string; short: string }> = {
  analyzed: { label: '已分析', short: '已分析' },
  partial: { label: '部分分析', short: '部分' },
  pending: { label: '待分析', short: '待分析' },
}

export const VIDEO_BY_ID = new Map(REFERENCE_VIDEOS.map((v) => [v.id, v]))

/** 时间码统一 MM:SS:FF（25fps），全站数字等宽。 */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  const f = Math.floor((safe % 1) * 25)
  return [m, s, f].map((n) => String(n).padStart(2, '0')).join(':')
}

export function pendingFieldCount(segment: ReferenceSegment): number {
  return Object.values(segment.analysis).filter((a) => a.pending).length
}

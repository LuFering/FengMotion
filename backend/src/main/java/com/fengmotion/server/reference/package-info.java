// 参考片库（ReferenceVideo / ReferenceSegment）。
//
// 职责边界：管理**真实视频 + 时间片段 + 对片段的观察与分析**。
// 文件本体复用素材库的记录（assetId），不存两份视频；
// 技法定义属特效库，不在这里。
// 见 docs/contracts/library.md §4。
package com.fengmotion.server.reference;

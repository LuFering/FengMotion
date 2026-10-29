# 非首页排版打磨

最终方案：标题独立呈现，移除标题旁数量徽标。特效库去掉泛化说明，搜索/操作位于页头右侧，分类标签位于下一行；数量留在分类标签，搜索或筛选后按需显示结果数。素材页保留项目上下文，工作流数量回归分类。首页及卡片排版不改。

参考：[Atlassian Page header](https://atlassian.design/components/page-header) 的标题、页面操作与底部筛选分层。

最终截图：final-fx-header.png、final-assets-header.png、final-workflow-header.png。reflow-* 是已被替换的标题徽标中间方案，after-* 是早期样式打磨截图。

验证：刷新 localhost:4173 后检查三页截图；特效搜索空结果及结果数提示正常，清除后恢复16项。特效卡片仍为452×283.25，双列，间距16px（1054×658视口）。npm run build、npm run lint 通过；保留已有资源/包体积警告。

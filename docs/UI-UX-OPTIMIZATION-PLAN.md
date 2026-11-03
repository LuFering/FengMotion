# FengMotion UI/UX 优化方案

## 📋 问题诊断总结

### 核心问题："界面孤岛"的根本原因

**不是缺少导航结构，而是三套并行的设计系统：**

| 设计系统 | 使用页面 | 特征 | 问题 |
|---------|---------|------|------|
| **首页纸层系统** | Home.tsx | `--ht-*` 变量、大圆角、纸张隐喻 | 与其他页面视觉断裂 |
| **工作台面板系统** | Workbench.tsx | 灰阶递进、6px 小圆角、无阴影 | 与三库岛屿风格不统一 |
| **三库岛屿系统** | Assets/RefLibrary/FxLibrary | A2 云端岛屿 V3、玻璃覆层 + 悬浮卡片 | 与首页/工作台割裂 |

### 关键数据

- **15 个页面中仅 3 个使用统一的 PageHeader 组件**
- **12 个页面各自实现头部样式**（高度从 49px 到 56px 不等）
- **颜色系统分裂**：深黑/浅白/触感三个主题下，强调色各不相同
- **按钮样式**：shadcn Button 使用率平均仅约 25%
- **状态反馈**：仅 Workbench 和 Assets 有完整状态处理

---

## 🎯 优化目标

**让所有界面看起来像一个产品，而不是拼凑的应用集合。**

### 核心原则

1. **视觉连续性** - 用户在不同页面切换时感觉流畅，没有"跳屏"感
2. **交互一致性** - 同样的操作在所有页面表现一致
3. **状态可见性** - 用户永远知道当前在做什么、等什么、结果如何
4. **渐进披露** - 首屏只给核心内容，高级功能按需才出现

---

## 🔧 实施方案

### Phase 0: 建立统一设计基础 (P0 - 必须改)

#### 0.1 统一 PageHeader 组件

**现状问题：**
- 12 个页面各自实现头部样式
- 高度不一致（49px-56px）
- 返回按钮位置/样式不统一

**改法：**

创建 `src/components/PageHeader.tsx`：

```tsx
export function PageHeader({ 
  title, 
  subtitle, 
  breadcrumbs, 
  actions,
  onBack 
}: {
  title: string
  subtitle?: string
  breadcrumbs?: { label: string; href: string }[]
  actions?: ReactNode () => void
}) {
  return (
    <header className="fm-page-header">
      <div className="fm-page-header-content">
        {onBack && (
          <button className="fm-back-btn" onClick={onBack} aria-label="返回">
            <Icon name="chevron-left" />
          </button>
        )}
        <div className="fm-page-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {breadcrumbs && (
          <nav className="fm-breadcrumbs">
            {breadcrumbs.map((crumb, i) => (
              <span key={i}>
                {i > 0 && <Icon name="chevron-right" className="fm-crumb-sep" />}
                <a href={crumb.href}>{crumb.label}</a>
              </span>
            ))}
          </nav>
        )}
        {actions && <div className="fm-page-actions">{actions}</div>}
      </div>
    </header>
  )
}
```

**样式定义** (`src/styles/fm-page.css`)：

```css
.fm-page-header {
  padding: 24px 32px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  position: sticky; top: 0; z-index: 10;
}

.fm-page-header-content {
  max-width: 1440px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.fm-page-title h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--fg);
}

.fm-page-title p {
  font-size: 13px;
  color: var(--dim);
  margin: 0;
}

.fm-breadcrumbs {
  display: flex;
  gap: 4px;
  font-size: 13px;
  color: var(--ph);
}

.fm-breadcrumbs a {
  color: var(--acc);
  text-decoration: none;
}

.fm-breadcrumbs a:hover {
  text-decoration: underline;
}

.fm-crumb-sep {
  width: 14px;
  height: 14px;
  opacity: 0.5;
}

.fm-page-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.fm-back-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  background: var(--hole);
  color: var(--fg);
  border-radius: 6px;
  cursor: pointer;
  transition: background-color .14s;
}

.fm-back-btn:hover {
  background: var(--surf);
}

.fm-back-btn .ui-icon {
  width: 16px;
  height: 16px;
}
```

**适用范围：**
- ✅ WorkbenchCatalog.tsx - 已有类似结构，改造
- ✅ ProjectOverview.tsx - 已有类似结构，改造
- ⚠️ Home.tsx - 不需要（首页无返回）
- ⚠️ StartCreation.tsx - 不需要（弹窗模式）
- ⚠️ Workflow.tsx - 需要
- ⚠️ WorkflowEditor.tsx - 需要
- ⚠️ Assets.tsx - 需要
- ⚠️ RefLibrary.tsx - 需要
- ⚠️ FxLibrary.tsx - 需要
- ⚠️ RenderDelivery.tsx - 需要
- ⚠️ CreationTask.tsx - 不需要（侧边抽屉）

#### 0.2 统一品牌色 #3B8CF8

**现状问题：**
- 深黑主题下品牌色恒定
- 浅白/触感主题下品牌色偏移

**改法：**

修改 `src/styles/brand.css`：

```css
/* 品牌蓝冻结 #3B8CF8 - 所有主题下恒定 */
html[data-theme="dark"]  { --acc: #3B8CF8; }
html[data-theme="light"] { --acc: #3B8CF8; }
html[data-theme="tactile"] { --acc: #3B8CF8; }

/* 强调色变体（根据背景明暗自动调整） */
html[data-theme="dark"]  { --acc-d: #2563EB; --acc-l: #60A5FA; }
html[data-theme="light"] { --acc-d: #1D4ED8; --acc-l: #2563EB; }
html[data-theme="tactile"] { --acc-d: #2563EB; --acc-l: #FBBF24; }
```

#### 0.3 统一按钮样式系统

**现状问题：**
- shadcn Button 使用率低
- 各页面自定义按钮样式混乱

**改法：**

创建 `src/components/ui/button-system.tsx`：

```tsx
import { cva, type VariantProps } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--acc)] text-white hover:bg-[var(--acc-d)]',
        secondary: 'bg-[var(--surf)] text-[var(--fg)] hover:bg-[var(--hole)]',
        ghost: 'hover:bg-[var(--hole)] text-[var(--fg)]',
        link: 'text-[var(--acc)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-12 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
)

export interface ButtonProps 
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
```

**适用范围：**
- 所有页面的主操作按钮 → `variant="primary"`
- 次要操作按钮 → `variant="secondary"`
- 图标按钮 → `variant="ghost"` + `size="icon"`

#### 0.4 统一间距节奏

**现状问题：**
- padding/margin 数值不统一
- 元素间距忽大忽小

**改法：**

在 `src/styles/tokens.css` 中添加：

```css
/* 统一间距系统 - 4px 步长 */
:root {
  --fm-space-1: 4px;   /* 最小间距 */
  --fm-space-2: 8px;   /* 元素内间距 */
  --fm-space-3: 12px;  /* 小组件间距 */
  --fm-space-4: 16px;  /* 标准间距 */
  --fm-space-5: 20px;  /* 中等间距 */
  --fm-space-6: 24px;  /* 大间距 */
  --fm-space-8: 32px;  /* 区块间距 */
  --fm-space-10: 40px; /* 大区块间距 */
  --fm-space-12: 48px; /* 页边距 */
}

/* 通用布局类 */
.fm-container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--fm-space-12);
}

.fm-section {
  padding: var(--fm-space-8) 0;
}

.fm-grid {
  display: grid;
  gap: var(--fm-space-4);
}
```

---

### Phase 1: 补全状态反馈 (P0 - 必须改)

#### 1.1 统一 LoadingState 组件

**现状问题：**
- Home/StartCreation 等页面无加载提示
- 各页面 loading 样式不统一

**改法：**

复用已有的 `src/components/LoadingState.tsx`，添加骨架屏变体：

```tsx
export function LoadingState({ 
  message = '加载中...',
  skeleton = 'default'
}: {
  message?: string
  skeleton?: 'default' | 'large' | 'list'
}) {
  return (
    <div className="fm-loading-overlay">
      <div className={`fm-loading-${skeleton}`}>
        <div className="fm-loading-spinner" />
        <p className="fm-loading-text">{message}</p>
      </div>
    </div>
  )
}
```

**适用场景：**
- Home.tsx - 发送后显示 "正在创建任务..."
- StartCreation.tsx - 项目创建时显示 "正在初始化..."
- Workbench.tsx - 工作流加载时显示 "正在加载时间线..."

#### 1.2 统一 EmptyState 组件

**现状问题：**
- 空状态无引导动作
- 文案不友好

**改法：**

复用已有的 `src/components/EmptyState.tsx`，标准化文案：

```tsx
export function EmptyState({ 
  icon,
  title,
  description,
  action 
}: {
  icon: string
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="fm-empty-state">
      <Icon name={icon} className="fm-empty-icon" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button onClick={action.onClick} className="fm-empty-action">
          {action.label}
        </button>
      )}
    </div>
  )
}
```

**适用场景：**
- WorkbenchCatalog.tsx - 搜索无结果
- Assets.tsx - 素材库为空
- RenderDelivery.tsx - 无历史版本

#### 1.3 统一 ErrorState 组件

**现状问题：**
- 错误状态无恢复路径
- 技术术语过多

**改法：**

复用已有的 `src/components/ErrorState.tsx`，简化文案：

```tsx
export function ErrorState({ 
  error,
  onRetry 
}: {
  error: Error
  onRetry?: () => void
}) {
  return (
    <div className="fm-error-state">
      <Icon name="alert-circle" className="fm-error-icon" />
      <h3>出错了</h3>
      <p>{error.message || '操作失败，请重试'}</p>
      {onRetry && (
        <button onClick={onRetry} className="fm-error-retry">
          重试
        </button>
      )}
      <button onClick={() => window.location.reload()} className="fm-error-reload">
        刷新页面
      </button>
    </div>
  )
}
```

---

### Phase 2: 完善信息架构 (P1 - 应该改)

#### 2.1 面包屑导航

**改法：**

在 PageHeader 中集成面包屑：

```tsx
<Breadcrumbs 
  items={[
    { label: '首页', href: '#' },
    { label: '我的创作', href: '#project' },
    { label: currentProject.name, href: `#project/${currentProject.id}` }
  ]} 
/>
```

**适用范围：**
- WorkbenchCatalog.tsx - 首页无面包屑
- Workbench.tsx - 显示 "首页 > 我的创作 > [项目名称]"
- Assets.tsx - 显示 "首页 > 我的创作 > [项目名称] > 素材库"

#### 2.2 当前位置指示器

**改法：**

在侧边栏导航高亮当前页面：

```tsx
<SidebarNav 
  current={view}
  onNavigate={setView}
  highlightCurrent={true}
/>
```

---

### Phase 3: 优化交互细节 (P2 - 可优化)

#### 3.1 键盘快捷键

**改法：**

在全局监听快捷键：

```tsx
useEffect(() => {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setMenu(null)
    if (e.ctrlKey && e.key === 'z') handleUndo()
    if (e.ctrlKey && e.key === 'y') handleRedo()
  }
  window.addEventListener('keydown', handleKey)
  return () => window.removeEventListener('keydown', handleKey)
}, [])
```

#### 3.2 悬停预览

**改法：**

在工作台时间线上添加悬停预览：

```tsx
<div 
  onMouseEnter={() => showPreview(scene)}
  onMouseLeave={() => hidePreview()}
>
  {scene.thumbnail}
</div>
```

---

## 📊 实施优先级

### P0 (本周必须完成)
1. ✅ 统一 PageHeader 组件 - 3 个页面改造
2. ✅ 统一品牌色 #3B8CF8 - brand.css 修改
3. ✅ 统一按钮样式系统 - 新建组件
4. ✅ 补全 LoadingState - Home/StartCreation 集成
5. ✅ 补全 EmptyState - Assets/RenderDelivery 集成

### P1 (下周完成)
1. 统一间距节奏 - tokens.css 扩展
2. 面包屑导航 - 5 个页面集成
3. 当前位置指示器 - SidebarNav 增强
4. 统一表单输入体验 - Input/Select/Checkbox 组件

### P2 (后续迭代)
1. 键盘快捷键体系
2. 悬停预览功能
3. 动画过渡平滑度
4. 可访问性增强 (ARIA)

---

## 🎨 预期效果

**改前：**
- 用户感觉在切换不同应用
- 找不到返回按钮
- 不知道是否操作成功
- 视觉跳跃感强

**改后：**
- 所有界面像同一个产品
- 返回路径清晰可见
- 状态反馈即时明确
- 视觉流动自然连贯

---

*方案生成时间：2026-10-24*  
*基线版本：main (PR #4)*  
*分支：optimize-user-flows*

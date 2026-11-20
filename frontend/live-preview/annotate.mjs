/**
 * Babel 插件：给项目源码里的每个 JSX 元素标上源码位置 `data-fm-src="src/Coffee.tsx:171:6"`。
 *
 * <p>为什么要标：预览窗口里点中的是页面节点，要知道它出自源码哪一行，
 * 属性小窗才能显示「这是 Coffee.tsx 第 171 行的标题」，以后的写回源码也靠它定位。
 * React 19 去掉了元素上的 _debugSource，只能在打包时自己标。</p>
 *
 * <p>DOM 元素会把这个属性渲染出来（data-* 是合法属性）；自定义组件会把它当成 props 收下，
 * 探针沿 React 组件树往上读，就能拿到「组件在哪里被调用」的整条链。
 * Fragment 不标（它不接受属性）；已有同名属性的不重复标。</p>
 *
 * @param {{ types: import('@babel/types') }} babel
 * @param {{ root: string }} options 项目根目录，位置写成相对它的路径
 */
export default function annotateSource({ types: t }, options) {
  const root = String(options.root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  const isFragment = (name) => (t.isJSXIdentifier(name) && name.name === 'Fragment')
    || (t.isJSXMemberExpression(name) && t.isJSXIdentifier(name.property) && name.property.name === 'Fragment')
  return {
    name: 'fengmotion-annotate-source',
    visitor: {
      JSXOpeningElement(path, state) {
        const node = path.node
        if (!node.loc || isFragment(node.name)) return
        if (node.attributes.some((a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'data-fm-src')) return
        const file = String(state.filename ?? '').replace(/\\/g, '/')
        const rel = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
        const where = `${rel}:${node.loc.start.line}:${node.loc.start.column + 1}`
        node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-fm-src'), t.stringLiteral(where)))
      },
    },
  }
}

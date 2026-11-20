/**
 * 行菜单的 ref 回调：菜单默认在行的下方弹出，若下沿会超出面板列表的可视区，就改成往上弹。
 *
 * <p>面板是固定高度、内部滚动的，靠近底部那几行的菜单往下弹会被列表裁掉一半。
 * 挂上就量一次，直接写 data-up，不为一次测量多渲染一轮。</p>
 */
export function flipMenuUp(menu: HTMLDivElement | null) {
  if (!menu) return
  const list = menu.closest('.cv3-side-list')
  if (!list) return
  const box = list.getBoundingClientRect()
  const rect = menu.getBoundingClientRect()
  if (rect.bottom > box.bottom - 6) menu.dataset.up = ''
}

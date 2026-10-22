/**
 * 搜索框 —— 三个库页共用的唯一实现（01 期 P0）。
 *
 * 宽度由容器决定（默认 flex:1 1 180px），不写死像素：
 * 现状是三库各自 190 / 300 / 320 / 360 四套宽度，正是这个组件要消掉的差异。
 *
 * 不负责：筛选、排序、视图切换（放 Toolbar）；搜索什么字段由页面决定。
 */
export function SearchField({
  value, onChange, placeholder = '搜索', ariaLabel, onClear,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  onClear?: () => void
}) {
  return (
    <div className="fm-searchfield" role="search">
      <svg className="ui-icon fm-searchfield-icon" aria-hidden="true">
        <use href="/assets/paba-icons.svg#search" />
      </svg>
      <input
        className="fm-searchfield-input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && onClear ? (
        <button className="fm-searchfield-clear" type="button" aria-label="清空搜索" onClick={onClear}>
          <svg className="ui-icon" aria-hidden="true"><use href="/assets/paba-icons.svg#x" /></svg>
        </button>
      ) : null}
    </div>
  )
}

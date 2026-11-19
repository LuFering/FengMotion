

export function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 分段选择：复用 paba 全局的 .ch-tabs（bg hole + 按下 surf） */
export function Seg({ value, options, onChange, ariaLabel }: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <div className="ch-tabs" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio"
                aria-checked={value === o.value}
                tabIndex={value === o.value ? 0 : -1}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                  event.preventDefault()
                  const step = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1
                  const next = (options.findIndex((option) => option.value === o.value) + step + options.length) % options.length
                  onChange(options[next].value)
                  const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                  buttons?.[next]?.focus()
                }}
                onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-label">
        <b>{label}</b>
        {hint && <em>{hint}</em>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

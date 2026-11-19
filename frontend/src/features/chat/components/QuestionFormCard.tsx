/**
 * 提问表单：把模型发来的 `<question-form>` 渲染成可交互控件。
 *
 * 提交时把答案拼成一条普通用户消息发出去（见 `formatFormAnswers`）——
 * 不经过任何工具应答通道，这是本方案能工作的前提。
 *
 * ## 设计来源
 *
 * 两处独立实现给出同一结论，所以选项做成**整行可点区域**而不是小 chip：
 *
 * - shadcn/ui `Questionnaire`：`min-h-11` 整行卡片 + 左侧圆形单选指示器，
 *   选中 `data-checked:border-primary/40 data-checked:bg-muted`
 * - open-design `QuestionForm`：`width:100%` 的 button，15×15 选择框，
 *   选中改字重 500 + 换色
 *
 * 第一版是小 chip 平铺，问题在于：点击区小、长选项被挤成多行、
 * 看不出「单选还是多选」。整行 + 选择框把这三件事一起解决。
 */
import { useMemo, useState } from 'react'
import { UiIcon } from '@/shared/icons/UiIcon'
import { Send01 } from '@untitledui/icons'
import { formatFormAnswers as formatAnswersFor, type QuestionForm } from '@/features/chat/model/questionForm'
import './question-form.css'

/**
 * @param form       解析出的表单
 * @param onSubmit   提交答案；参数是拼好的用户消息文本
 * @param interactive 还能不能作答（助手那一轮已过去就置灰，避免答了没人接）
 */
export function QuestionFormCard({
  form,
  onSubmit,
  interactive,
  submitLabel,
}: {
  form: QuestionForm
  onSubmit: (message: string) => void
  interactive: boolean
  submitLabel?: (form: QuestionForm) => string
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

  /* 必填项都填了才能提交。checkbox 视为空数组也算未填。 */
  const missing = useMemo(
    () =>
      form.questions.filter((q) => {
        if (!q.required) return false
        const v = answers[q.id]
        if (Array.isArray(v)) return v.length === 0
        return typeof v !== 'string' || v.trim().length === 0
      }),
    [form, answers],
  )

  const setOne = (id: string, value: string) => setAnswers((a) => ({ ...a, [id]: value }))
  const toggle = (id: string, option: string) =>
    setAnswers((a) => {
      const cur = a[id]
      const list = Array.isArray(cur) ? cur : []
      return { ...a, [id]: list.includes(option) ? list.filter((x) => x !== option) : [...list, option] }
    })

  /* 已回答题数：给顶部一个「3 / 5」的进度，长表单里让人知道还剩多少。 */
  const answered = form.questions.filter((q) => {
    const v = answers[q.id]
    if (Array.isArray(v)) return v.length > 0
    return typeof v === 'string' && v.trim().length > 0
  }).length

  return (
    <div className="qf" role="group" aria-label={form.title}>
      <div className="qf-head">
        <span className="qf-title">{form.title}</span>
        {form.questions.length > 1 && (
          <span className="qf-progress num" aria-live="polite">
            {answered}/{form.questions.length}
          </span>
        )}
      </div>

      <div className="qf-body">
        {form.questions.map((q) => {
          const value = answers[q.id]
          const choice = q.type === 'radio' || q.type === 'checkbox' || q.type === 'select'
          return (
            <div key={q.id} className="qf-q">
              <div className="qf-label">
                {q.label}
                {q.required && <span className="qf-req" aria-label="必填">*</span>}
              </div>

              {choice && (
                <div className="qf-opts" role={q.type === 'checkbox' ? 'group' : 'radiogroup'}>
                  {(q.options ?? []).map((opt) => {
                    const on = q.type === 'checkbox'
                      ? Array.isArray(value) && value.includes(opt)
                      : value === opt
                    return (
                      <button
                        key={opt}
                        type="button"
                        className="qf-opt"
                        data-on={on || undefined}
                        data-multi={q.type === 'checkbox' || undefined}
                        role={q.type === 'checkbox' ? 'checkbox' : 'radio'}
                        aria-checked={on}
                        disabled={!interactive}
                        onClick={() => (q.type === 'checkbox' ? toggle(q.id, opt) : setOne(q.id, opt))}
                      >
                        {/* 选择框自己画，但语义交给 role/aria-checked ——
                            读屏和键盘照常，不因为「不是原生 input」而降级。 */}
                        <span className="qf-box" aria-hidden="true" />
                        <span className="qf-opt-text">{opt}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {(q.type === 'text' || q.type === 'textarea') && (
                q.type === 'text' ? (
                  <input
                    className="qf-input"
                    value={typeof value === 'string' ? value : ''}
                    placeholder={q.placeholder}
                    disabled={!interactive}
                    onChange={(e) => setOne(q.id, e.target.value)}
                  />
                ) : (
                  <textarea
                    className="qf-input qf-textarea"
                    rows={3}
                    value={typeof value === 'string' ? value : ''}
                    placeholder={q.placeholder}
                    disabled={!interactive}
                    onChange={(e) => setOne(q.id, e.target.value)}
                  />
                )
              )}
            </div>
          )
        })}
      </div>

      <div className="qf-foot">
        <button
          type="button"
          className="qf-submit"
          disabled={!interactive || missing.length > 0}
          onClick={() => onSubmit(formatAnswersFor(form, answers))}
          title={missing.length > 0 ? `还差 ${missing.length} 项必填` : undefined}
        >
          {submitLabel ? submitLabel(form) : (form.submitLabel ?? '提交')}
          <UiIcon icon={Send01} size="xs" aria-hidden="true" />
        </button>
        {/* 提示说清「为什么不能提交」。只在真挡路时出现，不占常驻位置。 */}
        {!interactive ? (
          <span className="qf-hint">这条提问已经过去了</span>
        ) : missing.length > 0 ? (
          <span className="qf-hint">还差 {missing.length} 项必填</span>
        ) : null}
      </div>
    </div>
  )
}

export default QuestionFormCard

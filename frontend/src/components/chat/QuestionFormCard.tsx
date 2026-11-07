/**
 * 提问表单：把模型发来的 `<question-form>` 渲染成可交互控件。
 *
 * 提交时把答案拼成一条普通用户消息发出去（见 `formatFormAnswers`）——
 * 不经过任何工具应答通道，这是本方案能工作的前提。
 */
import { useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import { formatFormAnswers as formatAnswersFor, type QuestionForm } from './questionForm'
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

  return (
    <div className="qf" role="group" aria-label={form.title}>
      <div className="qf-head">{form.title}</div>
      <div className="qf-body">
        {form.questions.map((q) => {
          const value = answers[q.id]
          return (
            <div key={q.id} className="qf-q">
              <div className="qf-label">
                {q.label}
                {q.required && <span className="qf-req" aria-label="必填">*</span>}
              </div>

              {(q.type === 'radio' || q.type === 'select') && (
                <div className="qf-opts" data-layout={q.type === 'select' ? 'list' : 'chips'}>
                  {(q.options ?? []).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className="qf-opt"
                      data-on={value === opt || undefined}
                      disabled={!interactive}
                      onClick={() => setOne(q.id, opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {q.type === 'checkbox' && (
                <div className="qf-opts" data-layout="chips">
                  {(q.options ?? []).map((opt) => {
                    const checked = Array.isArray(value) && value.includes(opt)
                    return (
                      <button
                        key={opt}
                        type="button"
                        className="qf-opt"
                        data-on={checked || undefined}
                        aria-pressed={checked}
                        disabled={!interactive}
                        onClick={() => toggle(q.id, opt)}
                      >
                        {opt}
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
          <Send size={12} aria-hidden="true" />
          {submitLabel ? submitLabel(form) : (form.submitLabel ?? '提交')}
        </button>
        {!interactive && <span className="qf-hint">这条提问已经过去了</span>}
        {interactive && missing.length > 0 && (
          <span className="qf-hint">还差 {missing.length} 项必填</span>
        )}
      </div>
    </div>
  )
}

export default QuestionFormCard

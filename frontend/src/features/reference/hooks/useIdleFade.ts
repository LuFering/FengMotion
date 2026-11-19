import type * as React from 'react'
import { useEffect } from 'react'

export interface UseIdleFadeArgs {
  setIdle: React.Dispatch<React.SetStateAction<boolean>>
}

/** 参考片库播放时的闲置检测，用于让界面控件在无操作时淡出。 */
export function useIdleFade({ setIdle }: UseIdleFadeArgs) {
  /** 影院态控件闲置淡出：3 秒无鼠标/键盘活动后淡出头部与操作控件，活动即恢复 */
  useEffect(() => {
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 3000)
    }
    const wake = () => {
      setIdle(false)
      arm()
    }
    arm()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])
  return {  }
}

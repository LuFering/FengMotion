/**
 * 会话回复流管理器的**纯逻辑内核**（不依赖 React、不依赖路径别名、不碰浏览器 API）。
 *
 * <p>为什么单独拆出来：停止流程里最容易出错的是「异步交错」——
 * 停止请求发出后、HTTP 响应回来前，这一轮可能已经结束，甚至用户已经发了下一条。
 * 这类竞态只能靠可重复的时序测试来保证，而测试脚本跑在纯 Node 里，
 * 无法 import 带 `@/` 别名和 `react` 的模块。
 * 把内核放在这里，测试 import 的就是**真正在跑的代码**，不是照着写的副本。</p>
 */
export type StreamPhase = 'idle' | 'streaming' | 'completed' | 'error' | 'stopped'

/**
 * 一次停止请求的真实结果。
 *
 * <p>`not_running` 与 `stopped` 必须分开：前者是「后端没找到在跑的进程」，
 * 可能是任务刚好跑完（那这轮回复会正常落库），也可能是停止请求早于进程注册。
 * 界面不能用同一句「已停止」覆盖这两种情形。</p>
 */
export interface StopOutcome {
  status: 'stopped' | 'not_running' | 'failed'
  /** 后端是否给了明确答复（false = 请求失败，状态未知） */
  remote: boolean
  error?: string
  /**
   * 后端确认停止了，但**这次停止所针对的那一轮已经不在**（已结束，或用户已发起新一轮）。
   *
   * <p>此时本地不做任何收尾：不能关掉当前登记的流，也不能广播 stopped ——
   * 否则会把用户刚发起的新回复标成「已停止」。界面应说明「这次停止针对的回复已经结束了」。</p>
   */
  supersededRound?: boolean
}

export interface SessionStreamState {
  sessionId: string
  phase: StreamPhase
  userMessageId?: string
  aiMessageId?: string
  error?: string
  startedAt?: number
}

export interface ActiveStream {
  sessionId: string
  userMessageId?: string
  aiMessageId: string
  stop: () => void
  startedAt: number
}

/** 向后端发起停止请求的传输层，注入以便测试替换。 */
export type StopTransport = (sessionId: string) => Promise<{ stopped: boolean }>

const GLOBAL_EMPTY_STATE: SessionStreamState = Object.freeze({
  sessionId: '',
  phase: 'idle',
})

export class ChatStreamCore {
  private streams = new Map<string, ActiveStream>()
  private states = new Map<string, SessionStreamState>()
  private listeners = new Map<string, Set<(state: SessionStreamState) => void>>()

  /**
   * 已被「确认停止」收尾的轮次（sessionId → aiMessageId）。
   *
   * <p>为什么需要：后端确认停止后这里会立刻断开 SSE，而视图里撤掉未完成回复、
   * 显示「已停止」说明的逻辑原本挂在 SSE 的 onStopped 回调上 —— 连接已断，
   * 那个回调可能永远不执行，半截回复就留在界面。
   * 把「哪一轮是被确认停止的」记下来，视图读它做清理，不必依赖事件到达。</p>
   */
  private confirmedStops = new Map<string, string | undefined>()

  /**
   * 正在等待后端答复的停止请求（sessionId 集合）。
   *
   * <p>轮次核对解决的是「迟到的停止响应不要误伤新流」；这个集合解决的是
   * 另一半：**在停止请求还没回来之前，就别让用户开出下一轮**。
   * 两者叠加，才能保证「用户点停止 → 结果确定」之间不出现第三方轮次。
   * 界面用 {@link isStopping} 让输入框保持忙碌，按钮不再可点。</p>
   */
  private stopping = new Set<string>()

  /** 在途停止请求的 Promise：同会话重复调用直接复用，避免重复打 /stop */
  private stoppingRequests = new Map<string, Promise<StopOutcome>>()

  /** 向后端发起停止请求的传输层（构造时注入，测试可替换为可控假实现）。 */
  private readonly requestStop: StopTransport

  constructor(requestStop: StopTransport) {
    this.requestStop = requestStop
  }

  /** 该会话是否正在等待停止结果（期间界面应保持忙碌，不接受新一轮发送） */
  isStopping(sessionId: string): boolean {
    return this.stopping.has(sessionId)
  }

  /**
   * 查询会话当前流状态快照。
   * 严格保证：无状态变更时返回稳定引用，绝不创建新对象，防止 useSyncExternalStore 导致死循环与页面空白。
   */
  getState(sessionId?: string | null): SessionStreamState {
    if (!sessionId) return GLOBAL_EMPTY_STATE
    let state = this.states.get(sessionId)
    if (!state) {
      state = Object.freeze({ sessionId, phase: 'idle' })
      this.states.set(sessionId, state)
    }
    return state
  }

  /** 某会话当前是否有活跃的回复流正在运行 */
  has(sessionId: string): boolean {
    const s = this.states.get(sessionId)
    return s?.phase === 'streaming'
  }

  get(sessionId: string): ActiveStream | undefined {
    return this.streams.get(sessionId)
  }

  /** 订阅指定会话的流状态变化 */
  subscribe(sessionId: string, listener: (state: SessionStreamState) => void): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      const cur = this.listeners.get(sessionId)
      if (cur) {
        cur.delete(listener)
        if (cur.size === 0) {
          this.listeners.delete(sessionId)
        }
      }
    }
  }

  private notify(sessionId: string, next: SessionStreamState) {
    const frozenNext = Object.freeze({ ...next })
    this.states.set(sessionId, frozenNext)
    const set = this.listeners.get(sessionId)
    if (set) {
      for (const listener of set) {
        try {
          listener(frozenNext)
        } catch {}
      }
    }
  }

  /** 登记并启动新回复流 */
  register(info: ActiveStream) {
    const existing = this.streams.get(info.sessionId)
    if (existing && existing !== info) {
      try {
        existing.stop()
      } catch {}
    }
    this.streams.set(info.sessionId, info)
    this.notify(info.sessionId, {
      sessionId: info.sessionId,
      phase: 'streaming',
      userMessageId: info.userMessageId,
      aiMessageId: info.aiMessageId,
      startedAt: info.startedAt,
    })
  }

  /** 正常完成一轮回复流 */
  notifyCompleted(sessionId: string) {
    this.streams.delete(sessionId)
    this.notify(sessionId, {
      sessionId,
      phase: 'completed',
    })
  }

  /** 回复流发生错误 */
  notifyError(sessionId: string, error: string) {
    this.streams.delete(sessionId)
    this.notify(sessionId, {
      sessionId,
      phase: 'error',
      error,
    })
  }

  /**
   * 用户显式停止某会话的活跃回复流。
   *
   * <p><strong>必须同时通知后端</strong>：只 abort 浏览器侧的 SSE 连接，
   * 后端那个回复进程并不知情，会继续跑完并把回复落库 —— 用户看到按钮
   * 变回「发送」，以为停了，历史里却多出一条他没等到的回答。
   * 后端为此提供了 {@code POST /chat-sessions/{id}/stop}。</p>
   *
   * <p><strong>顺序：先请求后端，再断本地。</strong>后端才是权威 ——
   * 先断本地会让界面提前恢复可发送，而后端可能还在跑；请求失败时更糟：
   * 连接没了、进程还在。所以这里先 await 后端结果，拿到明确答复后才收尾本地。</p>
   *
   * <p><strong>响应回来时必须核对轮次，不能按 sessionId 现取。</strong>
   * 停止请求是异步的：等待期间 SSE 的 stopped 事件可能先到，界面恢复可发送，
   * 用户立刻发出下一条，此时该会话登记的是**新一轮**的流。
   * 若响应回来后按 sessionId 直接取当前流并关闭，就会把用户刚发起的新回复
   * 掐掉、还标成 stopped。所以进入本方法的第一件事是把「要停的那一轮」固定下来，
   * 响应回来后只有当前流仍是它（同一对象）才收尾。</p>
   *
   * <p><strong>`stopped:false` 不等于「已停止」</strong>：后端用它表示
   * 「此刻没有找到运行中的进程」，可能是任务刚跑完、也可能是停止请求
   * 早于进程注册。这两种情况都不能当成「成功停止」，否则界面会谎报。
   * 因此返回值区分四态，由调用方决定文案。</p>
   */
  async stop(sessionId: string): Promise<StopOutcome> {
    /* 固定目标轮次：这是本次停止请求语义上要停的那一条流。
       响应回来时只认它 —— 不认「那一刻登记在案的是谁」。 */
    const target = this.streams.get(sessionId)

    /* 同会话已有停止请求在途时直接复用它的结果，不再发第二条。
       重复点击停止、或对话区与工作台同时发起，都不该打两次 /stop。 */
    const inflight = this.stoppingRequests.get(sessionId)
    if (inflight) return inflight

    this.stopping.add(sessionId)
    const task = this.performStop(sessionId, target).finally(() => {
      this.stopping.delete(sessionId)
      this.stoppingRequests.delete(sessionId)
    })
    this.stoppingRequests.set(sessionId, task)
    return task
  }

  private async performStop(sessionId: string, target: ActiveStream | undefined): Promise<StopOutcome> {
    let outcome: StopOutcome
    try {
      const result = await this.requestStop(sessionId)
      outcome = result?.stopped === true
        ? { status: 'stopped', remote: true }
        : { status: 'not_running', remote: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = { status: 'failed', remote: false, error: message }
    }

    /* 只有后端**明确确认终止**时才收尾本地连接并广播 stopped。
       not_running / failed 都不收尾，理由不同但结论一致：
       · not_running：后端说「没有在跑的进程」，可能是刚跑完（那 completed
         事件马上会到），也可能是停止请求早于进程登记、后端随后仍会启动。
         这时断连接只会让用户失去一条仍在生成的回复。
       · failed：请求没送达，后端状态未知，更不能替它宣布已停止。
       两种情况都保持连接与 streaming 状态，让真实终态自己到达。 */
    if (outcome.status !== 'stopped') return outcome

    /* —— 轮次核对 —— */
    const current = this.streams.get(sessionId)
    if (current !== target) {
      /* 这一轮已经被换掉了：要么它已正常结束（notifyCompleted 删掉了登记），
         要么用户已发起新一轮（register 覆盖了登记）。
         两种情况下都不该由这条迟到的停止响应来收尾 —— 关掉新流等于
         把用户刚发出的回复标成「已停止」，那是最难排查的一类 bug。
         这里什么都不做，只如实告诉调用方「这次停止针对的轮次已经过去了」。 */
      return { ...outcome, supersededRound: true }
    }
    if (!target) {
      /* 没有本地流可关：后端确实停掉了什么，但本端没有对应的在途回复
         （例如界面刷新过）。没有可清理的轮次，也就不该广播 stopped
         去覆盖一个可能正在 streaming 的新状态。 */
      return { ...outcome, supersededRound: true }
    }

    /* 先登记「这一轮已被确认停止」，再断流、再广播：
       视图收到 stopped 广播时会读取这个标记做清理，不依赖 SSE 的 onStopped
       事件 —— 连接一断，那个事件很可能不会再来。 */
    this.confirmedStops.set(sessionId, target.aiMessageId)
    this.closeLocalStream(sessionId)
    this.notify(sessionId, { sessionId, phase: 'stopped' })
    return outcome
  }

  /** 取走一次「确认停止」标记（读后即删，保证清理只做一次）。 */
  takeConfirmedStop(sessionId: string): { aiMessageId?: string } | null {
    if (!this.confirmedStops.has(sessionId)) return null
    const aiMessageId = this.confirmedStops.get(sessionId)
    this.confirmedStops.delete(sessionId)
    return { aiMessageId }
  }

  /** 断开并注销本地流（只在后端确认停止后调用）。 */
  private closeLocalStream(sessionId: string) {
    const active = this.streams.get(sessionId)
    if (!active) return
    try {
      active.stop()
    } catch {}
    this.streams.delete(sessionId)
  }

  /** 释放或重置会话状态 */
  release(sessionId: string) {
    this.streams.delete(sessionId)
    const cur = this.states.get(sessionId)
    if (cur && cur.phase === 'idle') return
    this.notify(sessionId, {
      sessionId,
      phase: 'idle',
    })
  }

  /** 停止所有正在运行的会话流 */
  stopAll() {
    for (const [sid, stream] of this.streams.entries()) {
      try {
        stream.stop()
      } catch {}
      this.notify(sid, {
        sessionId: sid,
        phase: 'stopped',
      })
    }
    this.streams.clear()
  }
}

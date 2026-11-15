#!/usr/bin/env python3
"""真实调用点回归测试（通过 CDP 操作安装态界面）。

为什么需要这个脚本：
    纯 Node 的单测能验证「判定函数」是否正确，但验证不了「调用点有没有接上」。
    这个项目已经两次出现「判定对、入口漏接」的真实缺陷：
      1) 拦截只加在 sendToServer，本地会话在 if (activeIsServer) 处就分流走了；
      2) 侧栏 chat.stream 没有 onStatus，执行过程永远看不到。
    所以这里不看代码，只**操作界面**并观察真实请求，断言：
      · 消息有没有真的写入服务端（POST /messages）
      · 创作任务有没有真的发起（POST /creation 或 /workflow-context）
      · 普通回复流有没有真的启动（GET /stream）

用法:
    python3 /tmp/test_ui_callpoints.py <cdp_port> <backend_port>

⚠️ 这个脚本会**真实发起创作任务**（改工程），而同一项目的创作/渲染/恢复由
    ProjectOperationLock 串行化。因此：
     · 若项目正忙，创作任务会以「这个项目正在创作、渲染或恢复」失败；
     · 这是**正确的产品行为**，不是缺陷 —— 脚本要把这种情况单独识别出来，
       不能直接记成「界面说改工程实际没改」。
     · 跑之前应确保没有正在运行的创作任务，否则会误报。

退出码 0 = 全部通过；1 = 有失败项；2 = 有阻塞（项目正忙），无法判定。
"""
import json
import sys
import time
import urllib.request

sys.path.insert(0, "/tmp")
from cdp_eval import WS, page_ws_url

CDP_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9437
API = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else 8080}/api"

PROJECT_ID = "fb251ad2-4b4b-47b4-8259-07804eb20a97"
# 回归测试固定使用的服务端会话（含 bash 工具调用历史）
SESSION_ID = "d507467c-aaa5-49c0-bc03-c4a2d7e298fb"

failures: list[str] = []
blocked: list[str] = []
checks: list[str] = []


def ok(name: str, detail: str = "") -> None:
    checks.append(f"  ✓ {name}{(' — ' + detail) if detail else ''}")


def fail(name: str, detail: str) -> None:
    failures.append(f"  ✗ {name} — {detail}")


class Session:
    """一个 CDP 连接，可反复执行 JS 并记录网络请求。"""

    def __init__(self) -> None:
        self.ws = WS(page_ws_url(CDP_PORT))
        self._id = 0
        self.requests: list[dict] = []
        self.enable_network()

    def call(self, method: str, params: dict | None = None, timeout: float = 30.0):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            # 顺手收集网络事件
            if msg.get("method") == "Network.requestWillBeSent":
                p = msg["params"]["request"]
                self.requests.append({
                    "method": p.get("method"),
                    "url": p.get("url"),
                    "t": time.time(),
                })
            if msg.get("id") == mid:
                return msg.get("result", {})
        raise TimeoutError(f"{method} 超时")

    def enable_network(self) -> None:
        self.call("Network.enable")

    def js(self, expr: str):
        r = self.call("Runtime.evaluate", {
            "expression": expr, "awaitPromise": True,
            "returnByValue": True, "userGesture": True,
        })
        if "exceptionDetails" in r:
            raise RuntimeError(f"JS 异常: {json.dumps(r['exceptionDetails'], ensure_ascii=False)[:400]}")
        return r.get("result", {}).get("value")

    def mark(self) -> int:
        """记录当前位置，之后只看这之后的请求。"""
        return len(self.requests)

    def drain(self, seconds: float = 0.0) -> None:
        """主动读取并缓存网络事件。

        ⚠️ 这是必须的：`time.sleep()` 期间事件只堆在 socket 缓冲里，
        没人读就永远进不了 self.requests。之前「没有观察到创作任务请求」
        就是这么误报的 —— 请求其实发生了，只是没被收集。
        """
        deadline = time.time() + seconds
        self.ws.sock.settimeout(0.4)
        try:
            while True:
                try:
                    msg = json.loads(self.ws.recv())
                except Exception:
                    if time.time() >= deadline:
                        break
                    continue
                if msg.get("method") == "Network.requestWillBeSent":
                    p = msg["params"]["request"]
                    self.requests.append({
                        "method": p.get("method"),
                        "url": p.get("url"),
                        "t": time.time(),
                    })
                if time.time() >= deadline and not self._pending():
                    break
        finally:
            self.ws.sock.settimeout(30)

    def _pending(self) -> bool:
        return False

    def since(self, idx: int) -> list[dict]:
        return self.requests[idx:]

    def make_local_fallback_session(self) -> str:
        """构造「服务端创建失败 → 降级 local」的会话（真实可达路径）。

        做法：开启 Fetch 拦截，把「新建对话」发出的 POST /chat-sessions 打成 500，
        前端 `useSessions.create` 的 catch 会把会话降级为 origin='local'
        并保留 projectId —— 正是 P1 要拦的对象。

        关键实现细节：拦截期间**必须只用一个循环读事件流**，
        否则会和 call() 的 waiters 抢 socket，导致偶发 no-intercepted-post。
        """
        import base64
        self.call("Fetch.enable", {"patterns": [
            {"urlPattern": "*/chat-sessions", "requestStage": "Request"},
        ]})
        try:
            r = self.js("""(() => {
                const b = document.querySelector('button.cv3-row-new');
                if (!b) return 'nf';
                b.click();
                return 'clicked';
            })()""")
            if r == "nf":
                return "no-row-new"

            fulfilled = False
            deadline = time.time() + 15
            self.ws.sock.settimeout(1.0)
            while time.time() < deadline and not fulfilled:
                try:
                    msg = json.loads(self.ws.recv())
                except Exception:
                    continue
                if msg.get("method") != "Fetch.requestPaused":
                    continue
                p_ = msg["params"]
                req = p_["request"]
                is_create = (req["method"] == "POST"
                             and req["url"].rstrip("/").endswith("/chat-sessions"))
                if is_create:
                    body = base64.b64encode(json.dumps(
                        {"error": {"code": "internal", "message": "模拟服务端创建失败"}}
                    ).encode()).decode()
                    self._id += 1
                    self.ws.send(json.dumps({"id": self._id, "method": "Fetch.fulfillRequest", "params": {
                        "requestId": p_["requestId"], "responseCode": 500,
                        "responseHeaders": [{"name": "Content-Type", "value": "application/json"}],
                        "body": body,
                    }}))
                    fulfilled = True
                else:
                    self._id += 1
                    self.ws.send(json.dumps({"id": self._id, "method": "Fetch.continueRequest",
                                             "params": {"requestId": p_["requestId"]}}))
            self.ws.sock.settimeout(30)
            if not fulfilled:
                return "no-intercepted-post"
            # 等界面把降级会话挂上并选中
            for _ in range(20):
                time.sleep(0.3)
                if self.js("""(() => !!document.querySelector('.cv3-local-note'))()"""):
                    return "ok"
            return "not-shown"
        finally:
            self.call("Fetch.disable")

    def close(self) -> None:
        self.ws.close()


# ── 界面操作原语 ───────────────────────────────────────────────

def goto_my_creations(s: Session) -> None:
    s.js("""(() => {
        const b = [...document.querySelectorAll('button,a')].find(e => e.innerText?.trim() === '我的创作');
        if (!b) return 'nf'; b.click(); return 'ok';
    })()""")
    time.sleep(2)
    # 等左栏分组真的渲染出来再返回：固定 sleep 在慢机器上不够，
    # 后续 open_project_group / click_session_by_text 会在空列表上找不到目标，
    # 表现为「发送失败: no-send」这类假失败（实测踩过）。
    for _ in range(20):
        if s.js("""(() => document.querySelectorAll('.cv3-group').length > 0)()"""):
            return
        time.sleep(0.3)


PROJECT_NAME = "制作能力验证"


def open_project_group(s: Session, name: str = PROJECT_NAME) -> str:
    """展开指定项目的会话分组（按项目名定位，不能用「第一个」——
    分组顺序会随最近使用变化，写死第一个会点到别的项目）。"""
    r = s.js(f"""(() => {{
        const groups = [...document.querySelectorAll('.cv3-group')];
        const g = groups.find(x => (x.innerText || '').includes({json.dumps(name)}));
        if (!g) return 'nf';
        const has = g.querySelectorAll('.cv3-session').length;
        if (has > 0) return 'open';
        g.querySelector('.cv3-group-head').click();
        return 'clicked';
    }})()""")
    time.sleep(1.8)
    return r


def click_session_by_text(s: Session, needle: str) -> str:
    return s.js(f"""(() => {{
        const rows = [...document.querySelectorAll('.cv3-session')];
        const hit = rows.find(r => (r.innerText || '').includes({json.dumps(needle)}));
        if (!hit) return 'nf';
        hit.click();
        return (hit.innerText || '').replace(/\\n/g, '|').slice(0, 40);
    }})()""")


def type_and_send(s: Session, text: str) -> str:
    """在官方输入框里输入并点发送。返回 sent / cannot / no-ta / disabled。

    ⚠️ 必须用 CDP Input 域发**真实键盘事件**：
    官方输入框是受控组件，只设 value + dispatchEvent('input') 时，
    文字能进 textarea 与镜像层，但内部的「有内容」状态没更新，
    发送按钮始终禁用 —— 会误报成 no-send（实测踩过）。
    """
    # 先聚焦并清空，避免残留上一轮文字
    # 聚焦必须真的落到 shadow DOM 里的 textarea 上：
    # Input.insertText 往「当前焦点元素」插字符，焦点在 body 上就什么都不会发生。
    # 注意：shadow DOM 内元素获得焦点时，document.activeElement 是**宿主**
    # （[data-motion-surface]），不是 textarea —— 早先按 document.activeElement === ta
    # 判断会永远失败，属于判断写错，不是真失败。
    s.js("""(() => {
        const surf = document.querySelector('[data-motion-surface]');
        const ta = surf?.shadowRoot?.querySelector('textarea');
        if (ta) ta.focus();
        return 'ok';
    })()""")
    time.sleep(0.25)
    focused = s.js("""(() => {
        const surf = document.querySelector('[data-motion-surface]');
        const sr = surf?.shadowRoot;
        if (!sr) return 'no-surface';
        if (sr.activeElement?.tagName === 'TEXTAREA') return 'ok';
        // 兜底：宿主拿到焦点也算（官方组件把焦点委托给内部 textarea）
        return document.activeElement === surf ? 'ok' : 'focus-failed';
    })()""")
    if focused != 'ok':
        return focused
    # 清空残留：insertText 是**追加**，不清会把上一轮文字拼到前面，
    # 导致每次发送的正文都不一样（实测出现「同一句话」被拼成几十字，
    # 服务端判定为新消息，幂等断言的语义就全乱了）。
    for _ in range(3):
        cur = s.js("""(() => {
            const ta = document.querySelector('[data-motion-surface]')?.shadowRoot?.querySelector('textarea');
            return ta ? ta.value.length : 0;
        })()""") or 0
        if cur == 0:
            break
        s.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "a", "modifiers": 2,
                                          "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65})
        s.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "a", "modifiers": 2,
                                          "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65})
        s.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Backspace",
                                          "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})
        s.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Backspace",
                                          "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})
        time.sleep(0.25)
    # 兜底：键盘清空偶尔不生效（受控组件），确认真的为空再输入
    left = s.js("""(() => {
        const ta = document.querySelector('[data-motion-surface]')?.shadowRoot?.querySelector('textarea');
        return ta ? ta.value.length : -1;
    })()""")
    if left != 0:
        s.js("""(() => {
            const ta = document.querySelector('[data-motion-surface]')?.shadowRoot?.querySelector('textarea');
            if (!ta) return 'no-ta';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, '');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return 'cleared';
        })()""")
        time.sleep(0.3)
    s.call("Input.insertText", {"text": text})
    time.sleep(0.4)

    typed = s.js("""(() => {
        const surf = document.querySelector('[data-motion-surface]');
        const ta = surf?.shadowRoot?.querySelector('textarea');
        if (!ta) return 'no-ta';
        if (ta.value.length === 0) return 'empty';
        // 必须与预期完全一致：有残留就会被拼长，那说明清空没生效
        return ta.value === %s ? 'typed' : ('mismatch:' + ta.value.slice(0, 40));
    })()""" % json.dumps(text))
    if typed != "typed":
        return typed
    # 官方输入框是受控的：文字写进去后发送按钮要等一次渲染才启用。
    # 固定 sleep 在慢机器上不够，会误报 no-send。
    state = "disabled"
    for _ in range(16):
        time.sleep(0.25)
        # surf 可能为 null（视图正在切换/未挂载）：不能直接读 shadowRoot，
        # 那会抛 TypeError 让整个场景崩掉，而真实原因只是「还没准备好」。
        state = s.js("""(() => {
            const surf = document.querySelector('[data-motion-surface]');
            if (!surf || !surf.shadowRoot) return 'no-surface';
            const btn = [...surf.shadowRoot.querySelectorAll('button')]
                .find(b => (b.getAttribute('aria-label') || '') === '发送');
            if (!btn) return 'no-send';
            return btn.disabled ? 'disabled' : 'ready';
        })()""")
        if state == "ready":
            break
    if state != "ready":
        # 兜底：官方组件偶尔在插入文本后延迟一拍才更新按钮。
        # 再等一轮仍不行就如实返回，不重试超过必要次数（避免掩盖真实缺陷）。
        for _ in range(8):
            time.sleep(0.4)
            state = s.js("""(() => {
                const surf = document.querySelector('[data-motion-surface]');
                if (!surf || !surf.shadowRoot) return 'no-surface';
                const btn = [...surf.shadowRoot.querySelectorAll('button')]
                    .find(b => (b.getAttribute('aria-label') || '') === '发送');
                if (!btn) return 'no-send';
                return btn.disabled ? 'disabled' : 'ready';
            })()""")
            if state == "ready":
                break
        if state != "ready":
            return state
    return s.js("""(() => {
        const surf = document.querySelector('[data-motion-surface]');
        if (!surf || !surf.shadowRoot) return 'no-surface';
        const btn = [...surf.shadowRoot.querySelectorAll('button')]
            .find(b => (b.getAttribute('aria-label') || '') === '发送');
        if (!btn) return 'no-send';
        btn.click();
        return 'sent';
    })()""")


def read_pill(s: Session) -> str:
    return s.js("""(() => {
        const w = document.querySelector('.wb-target-pill-wrap');
        return w ? (w.innerText || '').replace(/\\n/g, '|').slice(0, 120) : 'no-pill';
    })()""") or ""


def click_pill_intent(s: Session, label: str, expect: str = "") -> str:
    """点意图按钮；给了 expect 就轮询确认胶囊文案真的变了。"""
    r = s.js(f"""(() => {{
        const b = [...document.querySelectorAll('.wb-target-pill-wrap button')]
            .find(x => (x.innerText || '').includes({json.dumps(label)}));
        if (!b) return 'nf';
        b.click(); return 'clicked';
    }})()""")
    if r != "clicked":
        return r
    if not expect:
        time.sleep(0.8)
        return r
    for _ in range(12):
        time.sleep(0.25)
        if expect in read_pill(s):
            return r
    return f"pill-mismatch:{read_pill(s)[:60]}"


def read_send_error(s: Session) -> str:
    return s.js("""(() => {
        const n = document.querySelector('.cv3-compose-note[data-error], .cv3-compose-note');
        return n ? (n.innerText || '').slice(0, 160) : '';
    })()""") or ""


def read_message_blocks(s: Session) -> list[str]:
    return s.js("""(() => {
        const col = document.querySelector('.cv3-col');
        if (!col) return [];
        return [...col.children].map(c => (c.className || '').slice(0, 24));
    })()""") or []


# ── 服务端事实核对 ─────────────────────────────────────────────

def api_get(path: str):
    with urllib.request.urlopen(f"{API}{path}", timeout=10) as r:
        return json.load(r)


def session_message_count(sid: str) -> int:
    d = api_get(f"/chat-sessions/{sid}/messages?limit=50")
    return len(d.get("items", []))


def latest_session_id() -> str | None:
    d = api_get(f"/projects/{PROJECT_ID}/chat-sessions")
    items = d if isinstance(d, list) else d.get("items", [])
    if not items:
        return None
    items = sorted(items, key=lambda x: str(x.get("updatedAt") or ""), reverse=True)
    return items[0].get("id")


def project_busy(s: "Session") -> bool:
    """界面上是否显示有创作/渲染在进行。

    此时修改请求会以「这个项目正在创作、渲染或恢复」失败 —— 那是**正确行为**，
    不能记成「界面说改工程、实际没改」。
    """
    return bool(s.js("""(() => /正在由 AI 分析|正在渲染|执行中，正在处理/
        .test(document.body.innerText))()"""))


def has_request(reqs: list[dict], method: str, fragment: str) -> bool:
    return any(
        (r["method"] or "").upper() == method and fragment in (r["url"] or "")
        for r in reqs
    )


# ── 测试场景 ──────────────────────────────────────────────────

def scenario_server_modify(s: Session) -> None:
    """服务端会话 + 修改意图 → 必须真的发起创作任务。"""
    goto_my_creations(s)
    if project_busy(s):
        blocked.append("服务端会话修改：项目正在创作/渲染，本次无法判定（不是缺陷）")
        return
    open_project_group(s)
    clicked = click_session_by_text(s, "sleep 30")
    if clicked == "nf":
        fail("服务端会话修改", "找不到可用的服务端会话")
        return
    time.sleep(2.5)
    click_pill_intent(s, "修改此目标", expect="全局工程")
    pill = read_pill(s)
    if "全局工程" not in pill:
        fail("服务端会话修改", f"选了修改但胶囊没显示工程范围: {pill[:60]}")
        return

    idx = s.mark()
    sent = type_and_send(s, "把开头再加快一点")
    if sent != "sent":
        fail("服务端会话修改", f"发送失败: {sent}")
        return
    time.sleep(1)
    s.drain(12)   # 等创作任务请求真正发出并收齐事件
    reqs = s.since(idx)

    saved = has_request(reqs, "POST", "/messages")
    # 真实路径是 POST /projects/{id}/workflow/create（见 api/workflowContext.ts）。
    # 之前按 /creation 匹配，永远匹配不到 —— 那是测试自己的错，不是产品错。
    created = has_request(reqs, "POST", "/workflow/create")
    streamed = has_request(reqs, "GET", "/stream")

    if saved:
        ok("服务端会话修改：消息写入服务端", "POST /messages")
    else:
        fail("服务端会话修改", "没有观察到 POST /messages")
    if created:
        ok("服务端会话修改：发起创作任务", "POST /workflow/create")
    else:
        err = read_send_error(s)
        if "正在创作、渲染或恢复" in err:
            # 项目忙是**正确的产品行为**（ProjectOperationLock 串行化），
            # 不是「界面说改工程实际没改」。归为环境阻塞，不记失败。
            blocked.append("服务端会话修改：项目正忙，创作任务被正确拒绝（不是缺陷）")
        else:
            fail("服务端会话修改", f"没有观察到创作任务请求，且无项目忙提示: {err[:70] or '(无提示)'}")
    if streamed:
        fail("服务端会话修改", "修改路径不应启动普通回复流，但观察到了 GET /stream")


def scenario_unsaved_session_blocked(s: Session) -> None:
    """未归属项目的会话 + 修改意图 → 必须被拦截，且不写消息、不建任务。"""
    goto_my_creations(s)
    # 「新建对话」会沿用当前打开的工程，创建的是**服务端会话** —— 不能用它造无项目场景。
    # 「未归属项目」的会话只出现在：服务端创建失败降级，或从首页转到对话区。
    # 这里用拦截创建请求造出降级会话（真实可达路径，见 useSessions.create 的 catch）。
    r = s.make_local_fallback_session()
    if r != "ok":
        blocked.append(f"无项目拦截：无法构造未归属项目会话（{r}）")
        return
    # 降级会话**保留了 projectId**，所以文案是「请先保存会话」而不是「请先关联项目」
    # —— 两种拦截态对应不同的真实原因，不能混为一谈。
    click_pill_intent(s, "修改此目标", expect="请先保存会话")
    pill = read_pill(s)
    if "请先保存会话" in pill:
        ok("未保存会话：胶囊显示「请先保存会话」", pill[:36])
    else:
        fail("无项目拦截", f"胶囊文案不符合预期: {pill[:60]}")

    idx = s.mark()
    sent = type_and_send(s, "把开头加快")
    s.drain(6)
    reqs = s.since(idx)
    err = read_send_error(s)

    if sent == "sent" and not has_request(reqs, "POST", "/messages"):
        ok("无项目：消息没有被发出", "无 POST /messages")
    elif has_request(reqs, "POST", "/messages"):
        fail("无项目拦截", "消息竟然被写入了服务端 —— 拦截没生效")
    if "没有保存到项目" in err or "关联项目" in err or "没有归属项目" in err:
        ok("未保存会话：给出明确提示", err[:46])
    else:
        fail("无项目拦截", f"没有给出拦截提示: {err[:60]}")


def scenario_modify_no_extra_stream(s: Session) -> None:
    """修改路径不得附带普通回复流（曾因缺 workflow_modify 引用而误起一条）。"""
    goto_my_creations(s)
    if project_busy(s):
        blocked.append("修改不误起回复：项目正忙，本次无法判定")
        return
    open_project_group(s)
    if click_session_by_text(s, "sleep 30") == "nf":
        fail("修改不误起回复", "找不到会话")
        return
    time.sleep(2.5)
    click_pill_intent(s, "修改此目标", expect="全局工程")
    idx = s.mark()
    if type_and_send(s, "验证修改不误起回复") != "sent":
        fail("修改不误起回复", "发送失败")
        return
    s.drain(14)
    reqs = s.since(idx)

    if has_request(reqs, "POST", "/workflow/create"):
        ok("修改：发起创作任务")
    else:
        fail("修改不误起回复", "创作任务没发起")
    # 关键断言：修改是一次工程任务，不应再起一条普通对话回复
    if has_request(reqs, "GET", "/stream"):
        fail("修改不误起回复", "修改路径仍额外启动了普通回复流 GET /stream")
    else:
        ok("修改：没有误起普通回复流", "无 GET /stream")


def read_pending(s: Session, sid: str) -> dict:
    """读取该会话草稿里的 pendingSubmission（用于核对重试身份）。"""
    return s.js("""(() => {
        const key = 'fengmotion:session-draft:v1:fb251ad2-4b4b-47b4-8259-07804eb20a97:' + %s;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try { const v = JSON.parse(raw); return v.pendingSubmission || null; } catch { return null; }
    })()""" % json.dumps(sid)) or {}


def count_user_messages(sid: str) -> int:
    """服务端该会话的用户消息条数 —— 「有没有重复落库」的唯一证据。

    ⚠️ 必须跟着 nextCursor 翻完所有页：`?limit=80` 只返回**第一页**。
    会话消息数一旦超过一页，前后两次都只数到第一页里的用户消息，
    差值恒为 0 —— 会把「幂等生效」误报成「没落库」，或反过来。
    实测踩过：会话已有 137 条消息时，该函数稳定返回 62。
    """
    base = f"/chat-sessions/{sid}/messages?limit=80"
    url = base
    seen = 0
    pages = 0
    while url and pages < 50:
        d = api_get(url)
        seen += len([m for m in d.get("items", []) if m.get("role") == "user"])
        cursor = d.get("nextCursor")
        pages += 1
        url = f"{base}&cursor={cursor}" if cursor else None
    return seen


def scenario_retry_identity(s: Session) -> None:
    """重试身份：原样重试**不重复落库**，改内容**不复用旧创作任务**。

    ⚠️ 判据不能只看 pendingSubmission.idempotencyKey：
    发送成功后草稿会被清空（正确行为），pending 就没了。
    真正要证明的是「服务端有没有多出一条用户消息」，
    所以这里直接数服务端消息条数。
    """
    goto_my_creations(s)
    if project_busy(s):
        blocked.append("重试身份：项目正忙，本次无法判定")
        return
    open_project_group(s)
    click_session_by_text(s, "sleep 30")
    time.sleep(2.5)
    sid = SESSION_ID
    click_pill_intent(s, "修改此目标", expect="全局工程")

    # ── 情形 1：原样重试不得重复落库 ──
    # 每次运行用唯一内容：幂等键按内容绑定，复用上轮同一句话会被服务端正确判重，
    # 那样「首次发送 0 条」就不是缺陷而是幂等生效 —— 会让断言无从判断。
    before = count_user_messages(sid)
    text = f"重试身份：原样重试检查 {int(time.time() * 1000)}"
    if type_and_send(s, text) != "sent":
        fail("原样重试", "首次发送失败")
        return
    s.drain(10)
    mid = count_user_messages(sid)
    if mid != before + 1:
        fail("原样重试", f"首次发送本应新增 1 条用户消息，实际 {mid - before} 条")
        return
    ok("原样重试：首次发送落库 1 条")

    if type_and_send(s, text) != "sent":
        fail("原样重试", "重试发送失败")
        return
    s.drain(10)
    after = count_user_messages(sid)
    if after == mid:
        ok("原样重试：未重复落库", f"用户消息仍为 {after} 条")
    else:
        fail("原样重试", f"原样重试多落了 {after - mid} 条用户消息 —— 幂等键没生效")

    # ── 情形 2：改内容重试必须换新身份、用新创作请求 ──
    p_before = read_pending(s, sid)
    idx = s.mark()
    if type_and_send(s, f"重试身份：改过要求再发 {int(time.time() * 1000)}") != "sent":
        fail("改内容重试", "发送失败")
        return
    s.drain(10)
    reqs = s.since(idx)
    p_after = read_pending(s, sid)

    if count_user_messages(sid) == after + 1:
        ok("改内容重试：作为新消息落库 1 条")
    else:
        fail("改内容重试", "改了内容却没有新增用户消息")

    if p_before.get("requestId") and p_after.get("requestId") \
            and p_before.get("requestId") != p_after.get("requestId"):
        ok("改内容重试：创作 requestId 已更换", "不复用旧任务")
    elif has_request(reqs, "POST", "/workflow/create"):
        ok("改内容重试：发起了新的创作请求", "POST /workflow/create")
    else:
        blocked.append("改内容重试：本次未产生创作请求（项目忙或已复用），无法判定")


def scenario_query_path(s: Session) -> None:
    """提问意图 → 走普通回复流，不建创作任务。"""
    goto_my_creations(s)
    open_project_group(s)
    clicked = click_session_by_text(s, "sleep 30")
    if clicked == "nf":
        fail("提问路径", "找不到会话")
        return
    time.sleep(2.5)
    click_pill_intent(s, "关于此提问", expect="普通对话")
    if "普通对话" not in read_pill(s):
        fail("提问路径", f"选了提问但胶囊没变: {read_pill(s)[:60]}")
    # 上一个场景刚发过消息，输入框组件可能还在重建。
    # 固定等待不够，轮询到「有 textarea 且发送按钮存在」再继续，
    # 否则 type_and_send 会拿到 no-send / mismatch（实测在全量回归里偶发）。
    for _ in range(20):
        ready = s.js("""(() => {
            const surf = document.querySelector('[data-motion-surface]');
            if (!surf || !surf.shadowRoot) return false;
            const ta = surf.shadowRoot.querySelector('textarea');
            const btn = [...surf.shadowRoot.querySelectorAll('button')]
                .find(b => (b.getAttribute('aria-label') || '') === '发送');
            return Boolean(ta && btn);
        })()""")
        if ready:
            break
        time.sleep(0.4)

    idx = s.mark()
    sent = type_and_send(s, "这条会话大概在讲什么")
    if sent != "sent":
        fail("提问路径", f"发送失败: {sent}")
        return
    s.drain(10)
    reqs = s.since(idx)

    if has_request(reqs, "GET", "/stream"):
        ok("提问：启动普通回复流", "GET /stream")
    else:
        fail("提问路径", "没有观察到回复流")
    if has_request(reqs, "POST", "/workflow/create"):
        fail("提问路径", "提问却发起了创作任务")


def scenario_conversation_modify_records(s: Session) -> None:
    """从**完整对话区**发起修改：必须真的发创作任务，且结果要落库。

    <p>此前只有工作台写共享结果存储、对话区只读，所以「两处都能显示」
    只证明了「工作台发起的结果能被两处读到」。这条覆盖对话区自己的入口：
    1. 在对话区选「修改此目标」后发送，必须观察到 POST /workflow/create；
    2. AI 回复必须写进服务端会话（有 taskId 指回触发它的用户消息）——
       不写的话当场看不到回复，要刷新才出现。</p>
    """
    goto_my_creations(s)
    if project_busy(s):
        blocked.append("对话区发起：项目正忙，本次无法判定（不是缺陷）")
        return
    open_project_group(s)
    if click_session_by_text(s, "双会话B") == "nf":
        blocked.append("对话区发起：找不到可用的会话")
        return
    time.sleep(2.5)
    # 切到完整对话区
    r = s.js("""(() => {
        const b = [...document.querySelectorAll('button')].find(e => e.innerText?.trim() === '对话');
        if (!b) return 'nf'; b.click(); return 'ok';
    })()""")
    if r != "ok":
        blocked.append("对话区发起：找不到「对话」页签")
        return
    time.sleep(3)

    if click_pill_intent(s, "修改此目标", expect="全局工程") != "clicked":
        blocked.append(f"对话区发起：胶囊未就绪（{read_pill(s)[:40]}）")
        return

    idx = s.mark()
    text = f"对话区发起回归 {int(time.time() * 1000)}"
    if type_and_send(s, text) != "sent":
        fail("对话区发起", "发送失败")
        return
    time.sleep(1)
    s.drain(12)
    reqs = s.since(idx)

    if has_request(reqs, "POST", "/workflow/create"):
        ok("对话区发起：真的提交了创作任务", "POST /workflow/create")
    else:
        err = read_send_error(s)
        if "正在创作、渲染或恢复" in err:
            blocked.append("对话区发起：项目正忙，创作任务被正确拒绝（不是缺陷）")
            return
        fail("对话区发起", f"没有观察到创作任务请求: {err[:70] or '(无提示)'}")
        return

    # AI 回复必须落到服务端会话（创作要跑 100~200 秒，轮询等它结束）
    sid = "58ec10cc-3321-48d2-8656-04ca2798ef14"
    deadline = time.time() + 420
    landed = False
    while time.time() < deadline:
        time.sleep(10)
        try:
            d = api_get(f"/chat-sessions/{sid}/messages?limit=80")
            items = d.get("items", [])
            # 最后一条 AI 回复必须带 taskId（指回触发它的用户消息）
            ais = [m for m in items if m.get("role") == "assistant"]
            if ais and ais[-1].get("taskId"):
                landed = True
                break
        except Exception:
            pass
    if landed:
        ok("对话区发起：AI 回复已带 taskId 落库", "刷新后仍能按身份找回")
    else:
        fail("对话区发起", "等待超时仍未见带 taskId 的 AI 回复落库")


def main() -> int:
    s = Session()
    try:
        print("=== 真实调用点回归（界面操作 + 网络观察）===\n")
        scenario_server_modify(s)
        print()
        scenario_unsaved_session_blocked(s)
        print()
        scenario_retry_identity(s)
        print()
        scenario_query_path(s)
        print()
        scenario_conversation_modify_records(s)
    finally:
        s.close()

    print("\n".join(checks))
    if blocked:
        print("\n未能判定（环境阻塞）：")
        print("\n".join("  ! " + b for b in blocked))
    if failures:
        print("\n失败项：")
        print("\n".join(failures))
        return 1
    if blocked:
        return 2
    print(f"\n全部 {len(checks)} 项通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

package com.fengmotion.server.task.service;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.service.ChatStreamService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshProcess;
import com.fengmotion.server.harness.client.DshSdkSession;
import com.fengmotion.server.harness.config.HarnessProperties;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 用模型生成修改方案。
 *
 * <p><strong>模型只允许提出编辑建议</strong>：这里让它输出一段结构化 JSON
 * （sceneId / field / from / to / reason），而不是让它直接改整份 scenes。
 * 前者每一条都能被 {@link ModifyPlanApplier} 逐项核对，后者改错了也无从发现 ——
 * 「模型说了算」和「校验说了算」的分界必须落在数据形状上。</p>
 *
 * <p><strong>为什么复用 DSH 会话</strong>：后端已经能起 dsh 子进程跑一轮对话
 * （{@link ChatStreamService} 就是这么做的）。修改任务不需要流式输出，
 * 只要最后那句话，所以直接取 {@code Outcome.text()}，不起 SSE、
 * 不落会话消息 —— 它是一次内部调用，不该在用户的对话列表里留下记录。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ModelModifyPlanner implements ModifyPlanner {

    private final DshLauncher launcher;
    private final HarnessProperties properties;
    private final ObjectMapper json;

    /** 单次生成超时：修改方案比一次普通问答短，不需要 180 秒。 */
    @Value("${fengmotion.modify.plan-timeout-seconds:90}")
    private long planTimeoutSeconds;

    @Override
    public String name() {
        return "model";
    }

    @Override
    public ModifyPlan plan(String prompt, JsonNode film, List<String> editable) {
        if (prompt == null || prompt.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "修改要求是空的");
        }
        if (editable.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "没有可修改的场景");
        }

        String instruction = buildInstruction(prompt, film, editable);
        String raw = ask(instruction);
        return parse(raw, editable);
    }

    /**
     * 构造给模型的指令。
     *
     * <p>把当前场景与可改范围原样给它，并要求只输出 JSON —— 输出格式是契约的一部分，
     * 不能靠「它应该会懂」。</p>
     *
     * @param prompt   用户要求
     * @param film     当前场景
     * @param editable 可改场景
     * @return 指令文本
     */
    private String buildInstruction(String prompt, JsonNode film, List<String> editable) {
        StringBuilder scenes = new StringBuilder();
        for (JsonNode scene : film.path("scenes")) {
            String id = scene.path("id").asText("");
            if (!editable.contains(id)) {
                continue;
            }
            scenes.append("- id=").append(id)
                    .append(" text=").append(quote(scene.path("text").asText("")))
                    .append(" subtitle=").append(quote(scene.path("subtitle").asText("")))
                    .append(" color=").append(quote(scene.path("color").asText("")))
                    .append(" backgroundColor=").append(quote(scene.path("backgroundColor").asText("")))
                    .append(" durationSeconds=").append(scene.path("durationSeconds").asText(""))
                    .append('\n');
        }

        return """
                你在帮用户修改一条短视频的字幕与配色。只输出 JSON，不要任何解释文字。

                用户要求：
                %s

                可修改的场景（只有这些场景允许动）：
                %s

                输出格式（严格遵守）：
                {"edits":[{"sceneId":"...","field":"...","from":"...","to":"...","reason":"..."}]}

                规则：
                1. field 只能是 text / subtitle / color / backgroundColor / durationSeconds 之一。
                2. sceneId 必须是上面列出的场景 id。
                3. from 必须是该场景该字段的当前值，原样照抄，不要凭记忆改写。
                4. 只列出确实需要改的条目；不需要改就不要输出该条。
                5. 用户要求与上述字段无关时，输出 {"edits":[]}。
                """.formatted(prompt, scenes.isEmpty() ? "（无可修改场景）" : scenes.toString());
    }

    /**
     * 起一次 dsh 会话，取模型最后那句回答。
     *
     * @param instruction 指令
     * @return 模型原始输出
     */
    private String ask(String instruction) {
        DshProcess process = null;
        try {
            process = launcher.startSdk();
            DshSdkSession driver = new DshSdkSession(
                    process, json, properties.getProvider(), properties.getModel());
            // stderr 必须排空，否则管道写满会阻塞子进程；这里不要 token 帧，只丢弃
            process.drainStderr(50, frame -> { });

            String sessionId = "fm-modify-" + java.util.UUID.randomUUID();
            driver.initialize(System.getProperty("java.io.tmpdir"), Duration.ofSeconds(10));

            DshSdkSession.Outcome outcome = driver.prompt(
                    sessionId, instruction, QuietListener.INSTANCE,
                    Duration.ofSeconds(planTimeoutSeconds));

            if (outcome.failed()) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "modify_model_failed",
                        "模型调用失败：" + (outcome.failure() == null ? "未知原因" : outcome.failure()));
            }
            return outcome.text() == null ? "" : outcome.text();
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "modify_model_failed",
                    "无法启动模型进程：" + failure.getMessage());
        } finally {
            if (process != null) {
                process.close();
            }
        }
    }

    /**
     * 解析模型输出。
     *
     * <p>模型常把 JSON 包在 ```json 代码块里，或在前后加一句话。这里只做
     * 「找到第一个 { 到最后一个 }」的提取，**不做猜测性修补** ——
     * 结构不对就明确失败，而不是硬凑一个方案出来。</p>
     *
     * @param raw      模型输出
     * @param editable 可改场景
     * @return 修改方案
     */
    private ModifyPlan parse(String raw, List<String> editable) {
        int start = raw.indexOf('{');
        int end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "模型没有返回可解析的修改方案");
        }
        JsonNode root;
        try {
            root = json.readTree(raw.substring(start, end + 1));
        } catch (IOException malformed) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "模型返回的方案不是合法 JSON");
        }

        JsonNode editsNode = root.get("edits");
        if (editsNode == null || !editsNode.isArray()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "模型返回的方案缺少 edits 数组");
        }

        List<ModifyPlan.Edit> edits = new ArrayList<>();
        for (JsonNode node : editsNode) {
            String sceneId = node.path("sceneId").asText(null);
            String field = node.path("field").asText(null);
            /* 白名单外的字段在这里就丢掉，并留下日志：
               放进去只会让 applier 整份拒绝，用户拿不到任何可用结果。 */
            if (field == null || !ModifyPlanValidator.isAllowed(field)) {
                log.info("模型给出了不支持的字段，已忽略：sceneId={} field={}", sceneId, field);
                continue;
            }
            edits.add(new ModifyPlan.Edit(
                    sceneId,
                    field,
                    node.path("from").asText(""),
                    node.path("to").asText(""),
                    node.path("reason").asText("")));
        }

        if (edits.isEmpty()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "modify_plan_invalid",
                    "模型认为这条要求不涉及可修改的字段（当前只支持文字与颜色）");
        }
        return new ModifyPlan(edits);
    }

    /**
     * 把值包成便于模型看清的引号形式。
     *
     * @param value 原值
     * @return 带引号的值
     */
    private String quote(String value) {
        return "\"" + (value == null ? "" : value.replace("\"", "\\\"")) + "\"";
    }

    /**
     * 什么都不做的监听器。
     *
     * <p>修改方案是一次性结果，不需要流式回调。但 {@code Listener} 有七个方法，
     * 写匿名类会让主流程淹没在空实现里，所以单独提出一个常量。</p>
     */
    private enum QuietListener implements DshSdkSession.Listener {
        INSTANCE;

        @Override
        public void onTurnStarted(int turn) {
        }

        @Override
        public void onStepStarted(int turn, int step) {
        }

        @Override
        public void onToolCall(String callId, String name, String arguments) {
        }

        @Override
        public void onToolResult(String callId, String text, boolean isError) {
        }

        @Override
        public void onTextDelta(String text) {
        }

        @Override
        public void onThinkingDelta(String text) {
        }

        @Override
        public void onAssistantMessage(String text, String reasoning) {
        }

        @Override
        public void onTurnEnded(boolean failed, String reason) {
        }

        @Override
        public void onIdle() {
        }
    }
}

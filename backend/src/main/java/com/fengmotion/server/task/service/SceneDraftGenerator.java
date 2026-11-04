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
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshProcess;
import com.fengmotion.server.harness.client.DshSdkSession;
import com.fengmotion.server.harness.config.HarnessProperties;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 用模型把一句需求变成初始视频场景。
 *
 * <p><strong>这一步是「从零创作」的最小真实闭环</strong>：用户说一句想要什么，
 * 模型产出结构化的分镜（若干场景，各有标题、副标题、配色、时长），
 * 校验通过后交给已有的渲染链路出片。它不假装能生成画面素材、动画和转场 ——
 * 那需要的能力远超当前范围，硬做只会得到一段和需求无关的东西。</p>
 *
 * <p><strong>为什么模型只出数据、不直接出 film</strong>：与修改方案同理，
 * 让模型直接产出完整的 Remotion props 意味着它可以写任意字段、任意结构，
 * 出错也无从校验。这里限定它只能填一张固定的字段表，
 * 由本类组装成 film —— 「模型说了算」的边界落在数据形状上。</p>
 *
 * <p><strong>为什么字段范围与修改能力一致</strong>：只有 text / subtitle / color /
 * backgroundColor / durationSeconds 这几个字段既能被创建、也能被后续修改。
 * 如果创建时能生成模型无法修改的结构（比如图片、动画），
 * 用户下一步想调整就只能得到 unsupported_field，体验是断的。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SceneDraftGenerator {

    private final DshLauncher launcher;
    private final HarnessProperties properties;
    private final ObjectMapper json;

    /** 单次生成超时。生成分镜比改一句字幕要久，给得比修改方案宽一些。 */
    @Value("${fengmotion.create.draft-timeout-seconds:120}")
    private long draftTimeoutSeconds;

    /** 一版最多几幕。太多会让单条片子过长，也容易让模型敷衍。 */
    static final int MAX_SCENES = 6;

    /** 单条片子的时长上限（秒），防止模型给出离谱数字导致渲染失控。 */
    static final double MAX_TOTAL_SECONDS = 60;

    /** 单个场景的时长上下限。 */
    static final double MIN_SCENE_SECONDS = 1;
    static final double MAX_SCENE_SECONDS = 15;

    /**
     * 把需求生成为 film。
     *
     * @param prompt  用户需求
     * @param width   画布宽
     * @param height  画布高
     * @param fps     帧率
     * @return 可直接渲染与提交的 film
     */
    public JsonNode generate(String prompt, int width, int height, int fps) {
        if (prompt == null || prompt.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "创作需求是空的");
        }

        String raw = ask(buildInstruction(prompt));
        JsonNode draft = parse(raw);
        return assemble(draft, width, height, fps);
    }

    /**
     * 构造给模型的指令。
     *
     * @param prompt 用户需求
     * @return 指令文本
     */
    private String buildInstruction(String prompt) {
        return """
                你是短视频分镜设计。根据用户需求，设计一条由若干「场景」组成的短片。
                只输出 JSON，不要任何解释文字。

                用户需求：
                %s

                输出格式（严格遵守）：
                {"title":"短片标题","scenes":[
                  {"text":"主标题文字","subtitle":"副标题文字","color":"#ffffff",
                   "backgroundColor":"#101010","durationSeconds":3}
                ]}

                规则：
                1. scenes 至少 1 项，最多 %d 项。按叙事顺序排列。
                2. 每个场景的 durationSeconds 在 %s 到 %s 秒之间，所有场景总时长不超过 %s 秒。
                3. color 与 backgroundColor 必须是 #rrggbb 形式的十六进制颜色。
                4. text 是这一幕的主文字，简洁有力；subtitle 是补充说明，可为空字符串。
                5. 只输出上述字段，不要添加图片、动画、转场等字段 —— 它们不会被接受。
                6. 内容用中文，除非用户需求明确要求其它语言。
                """.formatted(
                prompt,
                MAX_SCENES,
                num(MIN_SCENE_SECONDS),
                num(MAX_SCENE_SECONDS),
                num(MAX_TOTAL_SECONDS));
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
            // stderr 必须排空，否则管道写满会阻塞子进程
            process.drainStderr(50, frame -> { });

            String sessionId = "fm-create-" + java.util.UUID.randomUUID();
            driver.initialize(System.getProperty("java.io.tmpdir"), Duration.ofSeconds(10));

            DshSdkSession.Outcome outcome = driver.prompt(
                    sessionId, instruction, SilentListener.INSTANCE,
                    Duration.ofSeconds(draftTimeoutSeconds));

            if (outcome.failed()) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "create_model_failed",
                        "模型调用失败：" + (outcome.failure() == null ? "未知原因" : outcome.failure()));
            }
            return outcome.text() == null ? "" : outcome.text();
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "create_model_failed",
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
     * <p>与修改方案同一套严格度：只取第一个 { 到最后一个 }，结构不对就明确失败，
     * 不做猜测性修补。修补出来的片子看起来「成了」，但内容是模型没说过的。</p>
     *
     * @param raw 模型输出
     * @return 解析后的 JSON
     */
    private JsonNode parse(String raw) {
        int start = raw.indexOf('{');
        int end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "create_draft_invalid",
                    "模型没有返回可解析的分镜");
        }
        try {
            return json.readTree(raw.substring(start, end + 1));
        } catch (IOException malformed) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "create_draft_invalid",
                    "模型返回的分镜不是合法 JSON");
        }
    }

    /**
     * 校验分镜并组装成 film。
     *
     * <p>任何一项不合法就整份拒绝：创建出来的是项目的第一个版本，
     * 后续所有修改都基于它，起点错了后面全错。</p>
     *
     * @param draft  模型返回的分镜
     * @param width  画布宽
     * @param height 画布高
     * @param fps    帧率
     * @return film
     */
    private JsonNode assemble(JsonNode draft, int width, int height, int fps) {
        JsonNode scenesNode = draft.get("scenes");
        if (scenesNode == null || !scenesNode.isArray() || scenesNode.isEmpty()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "create_draft_invalid",
                    "模型返回的分镜没有 scenes，或 scenes 为空");
        }
        if (scenesNode.size() > MAX_SCENES) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "create_draft_invalid",
                    "模型返回了 " + scenesNode.size() + " 个场景，超过上限 " + MAX_SCENES);
        }

        List<String> problems = new ArrayList<>();
        double total = 0;
        for (int i = 0; i < scenesNode.size(); i++) {
            JsonNode scene = scenesNode.get(i);
            String text = scene.path("text").asText("");
            if (text.isBlank()) {
                problems.add("第 " + (i + 1) + " 个场景缺少主文字");
            }
            if (!isColor(scene.path("color").asText(""))) {
                problems.add("第 " + (i + 1) + " 个场景的 color 不是 #rrggbb");
            }
            if (!isColor(scene.path("backgroundColor").asText(""))) {
                problems.add("第 " + (i + 1) + " 个场景的 backgroundColor 不是 #rrggbb");
            }
            JsonNode duration = scene.get("durationSeconds");
            if (duration == null || !duration.isNumber()) {
                problems.add("第 " + (i + 1) + " 个场景缺少 durationSeconds");
            } else {
                double value = duration.asDouble();
                if (value < MIN_SCENE_SECONDS || value > MAX_SCENE_SECONDS) {
                    problems.add("第 " + (i + 1) + " 个场景时长 " + num(value)
                            + " 秒超出范围 " + num(MIN_SCENE_SECONDS) + "~" + num(MAX_SCENE_SECONDS));
                }
                total += value;
            }
        }
        if (total > MAX_TOTAL_SECONDS) {
            problems.add("总时长 " + num(total) + " 秒超过上限 " + num(MAX_TOTAL_SECONDS) + " 秒");
        }
        if (!problems.isEmpty()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "create_draft_invalid",
                    "模型返回的分镜未通过校验：" + String.join("；", problems));
        }

        ObjectNode film = json.createObjectNode();
        film.put("width", width);
        film.put("height", height);
        film.put("fps", fps);
        // 场景 id 由后端生成而不是用模型给的值：模型可能重复、可能给出怪字符，
        // 而 id 是后续修改定位场景的依据，必须可控。
        ArrayNode scenes = film.putArray("scenes");
        for (int i = 0; i < scenesNode.size(); i++) {
            JsonNode scene = scenesNode.get(i);
            ObjectNode out = scenes.addObject();
            out.put("id", "s" + (i + 1));
            out.put("text", scene.path("text").asText(""));
            out.put("subtitle", scene.path("subtitle").asText(""));
            out.put("color", scene.path("color").asText("#ffffff"));
            out.put("backgroundColor", scene.path("backgroundColor").asText("#101010"));
            out.put("durationSeconds", scene.path("durationSeconds").asDouble());
        }
        return film;
    }

    /**
     * 是否是合法的 #rrggbb 颜色。
     *
     * @param value 值
     * @return 合法为 true
     */
    private boolean isColor(String value) {
        return value != null && value.matches("^#[0-9a-fA-F]{6}$");
    }

    /**
     * 数字转成不带多余小数点的字符串，用于提示语。
     *
     * @param value 数字
     * @return 文本
     */
    private String num(double value) {
        return value == Math.rint(value) ? String.valueOf((long) value) : String.valueOf(value);
    }

    /**
     * 什么都不做的监听器：生成分镜不需要流式回调。
     */
    private enum SilentListener implements DshSdkSession.Listener {
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

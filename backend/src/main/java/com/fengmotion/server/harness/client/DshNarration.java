package com.fengmotion.server.harness.client;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * DSH agent 的交流方式：按工作阶段说正文，不逐个工具汇报，也不把说明全攒到最后。
 *
 * <p><strong>放在哪</strong>：正常写在项目 {@code AGENTS.md} 的一段里（DSH 会自动加载），
 * 不在每条消息里重复。项目没有这段时（会话没有项目目录，或用户自己维护的指引里没写），
 * 才由调用方把同一份规则拼进本轮消息兜底。</p>
 */
public final class DshNarration {
    private DshNarration() {}

    /** 项目指引里这一段的标题；工作目录的 AGENTS.md 含有它，就说明规则已随指引加载。 */
    public static final String GUIDE_HEADING = "## 交流方式（用户可见的正文）";

    public static final String WORK_BLOCKS = """
            需要用工具时，按「工作阶段」交流，不逐个工具汇报：

            - 开始第一个阶段前，先用一两句正文说清你理解的目标和这一步要做什么，再调用工具。
            - 一个阶段是围绕同一个小目标的一组操作（通常 3–8 次工具调用）。阶段内连续读取、检查、修改直接调用，不必每次都说话。
            - 完成一个阶段、转向下一阶段、有关键发现或取舍、遇到阻塞或需要用户决定时，用一两句正文说明结果和下一步。
            - 最后给结论：先说做成了什么、没做成什么。
            - 阶段说明写在正文里，不要藏在思考或工具参数里；不披露内部推理，也不要把计划说成已完成。
            - 简单问题直接回答，不必硬拆阶段。
            """;

    /** 写进项目 AGENTS.md 的完整段落。 */
    public static String guideSection() {
        return GUIDE_HEADING + "\n\n" + WORK_BLOCKS;
    }

    /**
     * 工作目录的 AGENTS.md 是否已经写有交流规则。
     *
     * <p>读不到按「没有」处理：多拼一段规则只是重复，丢掉规则则会退回说明与调用分离的状态。</p>
     *
     * @param workingDirectory agent 的工作目录；可为 null
     */
    public static boolean inGuide(Path workingDirectory) {
        if (workingDirectory == null) return false;
        Path guide = workingDirectory.resolve("AGENTS.md");
        try {
            return Files.isRegularFile(guide)
                    && Files.readString(guide, StandardCharsets.UTF_8).contains(GUIDE_HEADING);
        } catch (IOException | RuntimeException unreadable) {
            return false;
        }
    }

    /**
     * 拼进本轮消息的兜底规则；指引里已有时为空串。
     *
     * @param workingDirectory agent 的工作目录；可为 null
     */
    public static String inlineFallback(Path workingDirectory) {
        return inGuide(workingDirectory) ? "" : "\n\n【交流方式】\n" + WORK_BLOCKS;
    }
}

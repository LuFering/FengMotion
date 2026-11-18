package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 制作指令：项目选用了视频类型时要求先读指引，并重申优先级与不执行脚本。 */
class CreateInstructionSkillGuideTest {

    private static final ResourceContextBuilder.ResourceContext NONE = new ResourceContextBuilder.ResourceContext(false, "", List.of());

    @Test
    @DisplayName("有 skill-guide.md：指令里有读指引这一步；没有：不提")
    void mentionsGuideOnlyWhenPresent() {
        String with = CreateAgentRunner.buildInstruction(null, NONE, "", true);
        assertTrue(with.contains("再读 skill-guide.md"));
        assertTrue(with.contains("以原文和纠正为准"));
        assertTrue(with.contains("脚本一律不要执行"));
        assertTrue(with.indexOf("再读 skill-guide.md") < with.indexOf("2. 修改 src/"), "读指引要在动手改源码之前");

        String without = CreateAgentRunner.buildInstruction(null, NONE, "", false);
        assertFalse(without.contains("skill-guide.md"));
        assertTrue(without.contains("\n2. 修改 src/"), "没有指引时第 2 步不能多出缩进");
    }
}

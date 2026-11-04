package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 「agent 到底改没改工程」的判定。
 *
 * <p>这组测试防的是一个具体的误报：对已有工程，{@code src/index.tsx} 与
 * {@code film.config.json} 本来就在。若用「文件是否存在」判断，
 * agent 只提问不动手也会被记成完成，旧工程再渲一遍就成了「修改成功」——
 * 用户看到的版本号变了，画面其实没变。</p>
 */
@DisplayName("agent 修改判定")
class AgentChangeDetectionTest {

    /** 临时工程目录。 */
    @TempDir
    Path root;

    /**
     * 造一个「已有的」工程：源码与配置都在。
     *
     * @throws Exception 写文件失败
     */
    private void seedExistingProject() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export const A = () => null;\n");
        Files.writeString(root.resolve("film.config.json"),
                "{\"entry\":\"src/index.tsx\",\"compositionId\":\"m\",\"width\":1920,\"height\":1080,\"fps\":30}");
    }

    @Test
    @DisplayName("工程文件都在但内容没变：判为未修改")
    void unchangedProjectIsNotAChange() throws Exception {
        seedExistingProject();
        String before = CreateAgentRunner.sourceFingerprint(root);
        String after = CreateAgentRunner.sourceFingerprint(root);

        assertEquals(before, after, "同一份内容两次算出的指纹必须相同");
        assertFalse(CreateAgentRunner.didChange(before, after),
                "文件存在不等于改过：只提问也必须判为未修改");
    }

    @Test
    @DisplayName("改了源码内容：判为已修改")
    void changedSourceIsAChange() throws Exception {
        seedExistingProject();
        String before = CreateAgentRunner.sourceFingerprint(root);
        Files.writeString(root.resolve("src/index.tsx"), "export const A = () => <div>new</div>;\n");
        String after = CreateAgentRunner.sourceFingerprint(root);

        assertNotEquals(before, after);
        assertTrue(CreateAgentRunner.didChange(before, after));
    }

    @Test
    @DisplayName("改了工程配置：也算修改")
    void changedConfigIsAChange() throws Exception {
        seedExistingProject();
        String before = CreateAgentRunner.sourceFingerprint(root);
        Files.writeString(root.resolve("film.config.json"),
                "{\"entry\":\"src/index.tsx\",\"compositionId\":\"m\",\"width\":1080,\"height\":1920,\"fps\":30}");
        assertTrue(CreateAgentRunner.didChange(before, CreateAgentRunner.sourceFingerprint(root)));
    }

    @Test
    @DisplayName("新增源码文件：算修改")
    void addedSourceFileIsAChange() throws Exception {
        seedExistingProject();
        String before = CreateAgentRunner.sourceFingerprint(root);
        Files.writeString(root.resolve("src/Scene.tsx"), "export const S = () => null;\n");
        assertTrue(CreateAgentRunner.didChange(before, CreateAgentRunner.sourceFingerprint(root)));
    }

    @Test
    @DisplayName("新工程：动手前没有 src 目录，建出源码要判为已修改")
    void brandNewProjectIsAChange() throws Exception {
        /* 真实踩到的误报：新建工程时 agent 一开始还没有 src/，
           若把「目录不存在」当成读取失败，整个从零建出的工程会被判成「没改动」。 */
        String before = CreateAgentRunner.sourceFingerprint(root);
        assertEquals(CreateAgentRunner.EMPTY_FINGERPRINT, before, "没有 src 时应是确定的空指纹，而不是 error");

        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export const A = () => null;\n");
        Files.writeString(root.resolve("film.config.json"),
                "{\"entry\":\"src/index.tsx\",\"compositionId\":\"m\",\"width\":1920,\"height\":1080,\"fps\":30}");

        assertTrue(CreateAgentRunner.didChange(before, CreateAgentRunner.sourceFingerprint(root)),
                "从零建出的工程必须算改动");
    }

    @Test
    @DisplayName("指纹读取失败时判为未修改，不把未知当成功")
    void fingerprintFailureIsNotAChange() {
        assertFalse(CreateAgentRunner.didChange("error:AccessDeniedException", "files=1;sha256=ab"));
        assertFalse(CreateAgentRunner.didChange(null, "files=1;sha256=ab"));
        assertFalse(CreateAgentRunner.didChange("files=1;sha256=ab", null));
    }
}

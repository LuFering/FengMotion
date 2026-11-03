package com.fengmotion.server.project.service;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.stereotype.Service;
/** 提供项目目录的基础文件操作；异常由调用方处理。 */

@Service 
public class ProjectDirectoryService {

    /**
     * 确保工作区目录存在；必要时一并创建缺失的父目录。
     *
     * @param workspace 工作区目录路径
     * @return 工作区目录路径
     * @throws IOException 无法创建目录或路径已存在但不是目录
     */
    public Path ensureWorkspace(Path workspace) throws IOException {
        return Files.createDirectories(workspace);
    }

    /**
     * 创建项目目录；父目录必须存在，目标路径不得已存在。
     *
     * @param projectPath 要创建的项目目录
     * @return 创建的目录路径
     * @throws IOException 目录已存在或文件系统操作失败
     */
    public Path create(Path projectPath) throws IOException{
        Path created = Files.createDirectory(projectPath);
        writeAgentGuide(created);
        return created;
    }

    /**
     * 在项目目录写入 {@code AGENTS.md}：告诉 Agent 这个项目怎么出片。
     *
     * <p><strong>为什么用 AGENTS.md 而不是别的方式</strong>：DSH 会自动加载工作目录
     * 及其上层的 {@code AGENTS.md} 作为工作区指引（{@code dsh-agent-instructions}），
     * 不需要在每条消息里重复交代。写文件也比改 SDK 协议干净 ——
     * {@code initialize} 没有注入系统提示的参数。</p>
     *
     * <p>写失败不影响建项目：没有这份指引，Agent 只是不知道渲染接口，
     * 但仍能正常对话与写文件。为此让整个建项目流程失败是不划算的。</p>
     *
     * @param projectDir 项目目录
     */
    private void writeAgentGuide(Path projectDir) {
        String guide = """
                # 这个项目怎么出片

                你在一个 FengMotion 项目目录里工作。除了普通的对话与写文件，
                你可以直接**渲染出一部真实的 mp4**。

                ## 出片方式

                把画面内容写成场景 JSON，POST 给后端渲染接口：

                ```bash
                curl -s -X POST "http://127.0.0.1:8080/api/projects/%s/renders" \\
                  -H 'Content-Type: application/json' \\
                  -d @film.json
                ```

                `film.json` 的格式（字段都在这里列全，不需要猜）：

                ```json
                {
                  "width": 1280, "height": 720, "fps": 30,
                  "backgroundColor": "#0b1220", "color": "#ffffff",
                  "scenes": [
                    { "id": "s1", "text": "标题", "subtitle": "副标题",
                      "durationSeconds": 2, "textAnimation": "fade" },
                    { "id": "s2", "text": "第二幕", "backgroundColor": "#1d4ed8",
                      "durationSeconds": 2, "textAnimation": "slide", "transition": "fade" }
                  ]
                }
                ```

                | 字段 | 取值 |
                |---|---|
                | `textAnimation` | `fade` / `slide` / `none` |
                | `transition` | `cut` / `fade`（首个场景忽略） |
                | `backgroundImage` | 相对项目目录的路径或 http URL |

                渲染成功后回应形如：
                `{"artifact":{"path":"renders/render-xxx.mp4","width":1280,...}}`

                产物落在本项目的 `renders/` 子目录，用户能在工作台的「产物」页看到并播放。

                ## 注意

                - 一次渲染通常 10~60 秒，`curl` 会等到出片才返回，不要设太短的超时
                - 时长 = 所有场景 `durationSeconds` 之和，由帧率换算成帧数
                - 先想清楚分镜再写 JSON，一次提交整部片；不要逐场景分别渲染
                """.formatted(projectIdOf(projectDir));
        try {
            Files.writeString(projectDir.resolve("AGENTS.md"), guide, java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // 指引写不进去不影响项目可用，见方法注释
        }
    }

    /**
     * 从目录名推断项目 ID 不可行 —— 渲染接口需要的是项目 ID 而不是目录名。
     *
     * <p>这里返回占位符，由调用方（{@code ProjectService}）在拿到 ID 后替换。
     * 见 {@link #rewriteAgentGuide(Path, String)}。</p>
     *
     * @param projectDir 项目目录
     * @return 占位符
     */
    private static String projectIdOf(Path projectDir) {
        return "__PROJECT_ID__";
    }

    /**
     * 项目 ID 生成之后，回填到 {@code AGENTS.md} 里的渲染命令中。
     *
     * <p>建目录时还不知道 ID（ID 由后端生成），所以先写占位符，拿到 ID 再改。
     * 这样目录与 ID 的创建顺序不用互相迁就。</p>
     *
     * @param projectDir 项目目录
     * @param projectId  真实项目 ID
     */
    public void rewriteAgentGuide(Path projectDir, String projectId) {
        Path guide = projectDir.resolve("AGENTS.md");
        if (!Files.isRegularFile(guide)) {
            return;
        }
        try {
            String text = Files.readString(guide, java.nio.charset.StandardCharsets.UTF_8);
            Files.writeString(guide, text.replace("__PROJECT_ID__", projectId),
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // 同上：指引缺失不阻断主流程
        }
    }
    /**
     * 删除指定路径，可用于清理创建失败后留下的空目录；不会递归删除内容。
     *
     * @param projectPath 要删除的路径
     * @throws IOException 路径不存在、目录非空或文件系统操作失败
     */
    public void deleteEmpty(Path projectPath) throws IOException{
        Files.delete(projectPath);
    }
}

package com.fengmotion.server.project.service;
import java.io.IOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
/** 提供项目目录的基础文件操作；异常由调用方处理。 */

@Service 
public class ProjectDirectoryService {

    /**
     * workflow-v5 目录的真实绝对路径。
     *
     * <p>指引里原先只写了「工具在 {@code workflow-v5/} 下」，而 agent 的工作目录是
     * 项目目录 —— 相对路径它根本找不到，于是那些校验工具从来没被调用过。
     * 这里注入安装/开发时的真实路径，写进指引让 agent 能直接执行。</p>
     */
    @Value("${fengmotion.workflow.dir:}")
    private String workflowDir = "";

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
     * 创建项目目录；同名时按需避让。
     *
     * <p><strong>为什么默认目录要避让</strong>：目录名由项目名推导，而「新建项目」
     * 本来就会重复用同一个默认名。一律报「目录已存在」，用户就再也建不出第二个。
     * 显式指定 rootPath 时不避让 —— 那是用户点名的位置，悄悄换到别处更糟。</p>
     *
     * <p>避让采用「名称-2、名称-3 …」：保留原名便于辨认，又不会盖掉已有目录。</p>
     *
     * @param projectPath 期望路径
     * @param failIfExists true 表示同名即失败（显式路径的情况）
     * @return 实际创建的目录
     * @throws IOException 无法创建，或显式路径已存在
     */
    public Path createAvoidingCollision(Path projectPath, boolean failIfExists) throws IOException {
        if (failIfExists || !Files.exists(projectPath)) {
            return create(projectPath);
        }
        String base = projectPath.getFileName().toString();
        Path parent = projectPath.getParent();
        /* 上限 1000：同名项目堆到上千个说明有别的毛病，
           继续试探只会让请求卡在这里。到上限后如实报冲突。 */
        for (int suffix = 2; suffix <= 1000; suffix++) {
            Path candidate = parent.resolve(base + "-" + suffix);
            if (Files.exists(candidate)) continue;
            try {
                return create(candidate);
            } catch (FileAlreadyExistsException raced) {
                // 并发下被别人抢先建走，继续试下一个后缀
            }
        }
        throw new FileAlreadyExistsException(projectPath.toString(), null, "同名项目目录过多");
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
    /**
     * 框架生成指引的头部标记。
     *
     * <p>用来区分「这份 AGENTS.md 是框架写的」还是「用户自己改过」。
     * 只升级带标记的文件：用户改过的指引属于他的创作资产，
     * 框架无权覆盖 —— 那会把他写下的项目约定悄悄冲掉。</p>
     */
    static final String GENERATED_MARKER = "<!-- fengmotion:agent-guide:v4 -->";

    /**
     * 识别任意版本的框架标记。
     *
     * <p>用来判断「这份指引是框架生成的」，与「这是哪一版」无关。
     * 只看当前版本会导致每次升级都把所有旧项目当成用户自维护而跳过。</p>
     */
    private static final java.util.regex.Pattern FRAMEWORK_MARKER =
            java.util.regex.Pattern.compile("<!--\\s*fengmotion:agent-guide:v\\d+\\s*-->");

    private void writeAgentGuide(Path projectDir) {
        writeText(projectDir.resolve("AGENTS.md"), agentGuide(projectIdOf(projectDir), workflowDir));
    }

    /**
     * 指引里展示的 workflow-v5 路径。
     *
     * <p>没配置时给一句人话，别写一个空路径让 agent 去猜。</p>
     *
     * @return 绝对路径或提示语
     */
    private static String effectiveWorkflowDir(String workflowDir) {
        return (workflowDir == null || workflowDir.isBlank())
                ? "（未配置 workflow-v5 目录，校验工具本轮不可用）"
                : workflowDir;
    }

    /**
     * 生成当前的 agent 指引正文。
     *
     * @param projectId 项目 ID（可能是占位符）
     * @return 指引全文
     */
    private static String agentGuide(String projectId, String workflowDir) {
        return GENERATED_MARKER + """
                # 这个项目怎么创作

                你在一个 FengMotion 项目目录里工作。这个项目按 **workflow-v5 的 Prompt-first**
                路径创作：先读用户原文，决定画面，再写 Remotion 代码，渲染出来看片、修改。

                **不要先把整部片写成一份「场景 JSON」。** 那种做法只能表达文字、颜色和时长，
                画面里没有可看的东西；去掉字幕就什么都看不懂 —— 这不是这个项目要的片子。

                ## 创作依据（先读这些）

                - `prompt.original.md`：用户原始需求，**逐字保存，不要改写**。这是创作依据。
                - `corrections.md`：用户后续纠正，较新的优先。
                - `decisions.md`：已确认或已推翻的关键决定。
                - `references/`：用户提供的参考与素材。
                - `qa/passes/`：每轮渲染与观察记录。

                原文与摘要冲突时以原文为准。看不懂需求就先问，不要自己编一个。

                ## 创作方式（方法，不是必过门槛）

                下面这些是 workflow-v5 Prompt-first 的推荐做法，**按项目需要采用，不是每个需求都要走完的流程**。
                用户明确要求的表达形式、风格或结构，优先于这里的建议。

                - **先想清画面再写代码**：这条片的视觉命题、关键画面、光与镜头是什么？
                  需要时记进 `lookdev-brief.md`。一句话的简单需求，可能几行代码就够了，不必为此写一份完整 brief。
                - **能算的先算**：构图、字号、安全区、时长、缓动这些能写成规则的就别靠反复渲染试。
                  `workflow-v5/prompt-first/templates/visual-encoding.ts` 是骨架，按需复制，不必强行套用。
                - **渲染用来验证算不出来的东西**：材质、光、合成、文字实际落位。
                  不必大批量抽帧；想验证什么，就先说清假设再看对应的帧。
                - **看片后再改**：需要留痕时把这一轮的渲染与观察记进 `qa/passes/NN/`。

                ## 工作流工具（真实路径，可直接执行）

                workflow-v5 的校验工具装在下面这个绝对路径下（不是项目目录里，用相对路径找不到）：

                ```
                %s
                ```

                常用的几个（用 `node` 执行，参数一般是项目目录）：

                - `prompt-first/tools/validate-shot-plan.mjs` —— 检查镜头计划是否可执行（Prompt-first 的主校验）
                - `prompt-first/tools/validate-animatic-review.mjs` —— 检查动画预览与审阅记录是否成对
                - `gates/tools/validate-gates.mjs` —— 各层 gate 的总校验
                - `intent/tools/validate-intent.mjs`、`execution/tools/validate-execution.mjs` —— 意图与执行层

                **它们是判断工具，不是必过门槛**：Prompt-first 不要求每部片都逐层填完这些文件。
                简单需求几步代码就够了，为了「走完流程」去补一堆用不上的文档是浪费时间。
                但**只要你写了 `film-plan.md` 这类结构化文件，就该跑对应校验**，
                别把一份自己都没验过的计划当依据。

                ## 语义检索（创作前必做一次）

                三库（素材/参考片/特效）与外部能力库（风格 51 个、镜头卡 136 张、Remotion 组件）
                已经统一建好语义索引。**用自然语言查，不要靠猜**：

                ```bash
                curl -s "http://127.0.0.1:8080/api/retrieval/search?q=镜头快速推近背景被拉开的眩晕感&limit=8"
                ```

                - `q` 写你想要的**视觉感受**，不是库里的术语。说「老电影那种颗粒感」比说「film grain」更容易命中。
                - `kinds` 可选：`technique`（特效）、`capability`（风格/镜头卡/组件）、`asset`、`reference`。
                - 返回 `score` 是相似度（0–1，越大越像），`text` 是命中的原文片段，`id` 是资源标识。

                **什么时候查**：定视觉方向（lookdev）、排镜头计划（film-plan）、需要具体动效写法时。
                每轮至少查一次；没有匹配就写一句「已检索，无匹配」再自己设计 ——
                不查就自己编视觉，是画面平庸的直接原因。

                ## 三个资源库（素材 / 参考片 / 特效）

                应用里有三个库，它们**不在项目目录里**，要靠下面的接口取：

                ```bash
                curl -s "http://127.0.0.1:8080/api/assets?limit=20"                    # 素材库
                curl -s "http://127.0.0.1:8080/api/reference-videos?limit=20"          # 参考片库
                curl -s "http://127.0.0.1:8080/api/fx-techniques?limit=100"            # 特效库
                ```

                **什么时候该去查**：用户说「找个合适的素材」「用手法像某某的片」「加个转场特效」
                这类没点名具体条目的要求时，**先调上面接口看库里有什么**，再决定用哪个；
                不要凭空编一个素材名或假装用了某条参考片。

                **用户已经点名给资源时**，本轮的项目目录里有一份 `resources-in-use.md`，
                里面写了每个资源的绝对文件路径、用途（放进画面 / 仅参考 / 音频 / 资料）与
                参考片的具体时间区间。**按那份文件用，不要自行更改用途**：
                「仅参考」的不要去改画面，「用作画面」的必须真的出现在成片里。

                素材与参考片是真实文件，用 `staticFile()` 引用前要先复制进项目的 `public/`
                （参考片按需抽帧观察，但成片里不得出现它的画面）。
                特效是「技法说明 + 做法步骤」，照着它写代码，不是一段可直接调用的组件。

                ## 出片（当前能力的真实边界，别当成全能）

                现在后端只有一个渲染接口，它接受的是**场景 props**：

                ```bash
                curl -s -X POST "http://127.0.0.1:8080/api/projects/%s/renders" \\
                  -H 'Content-Type: application/json' \\
                  -d @film.json
                ```

                `film.json` 形如 `{width, height, fps, backgroundColor, color, scenes:[{id, text, subtitle, color, backgroundColor, backgroundImage, durationSeconds, textAnimation, transition}]}`。

                **这条路径的局限要说清**：它只经共享的 `Film` 组件按字段装配画面，
                能表达背景图、文字动画和转场，但表达不了复杂的运镜、光、材质与合成。
                拿它做氛围短片会得到一张张「会动的字幕卡」。
                所以：**它是验证与兜底手段，不是创作方式**。真正的画面要靠你在本目录里
                写 Remotion 源码。写完把 `film.config.json` 的 `entry` 指到入口，
                由后端渲染你的工程（你不需要自己调渲染接口）。

                产物落在本项目 `renders/`，用户能在工作台「产物」页看到并播放。

                ## 注意

                - 一次渲染通常 10~60 秒，不要设太短的超时。
                - 不要伪造渲染结果：没出片就说没出片，不要编一个路径。
                - 如果只能用上面那条场景 props 路径，就明确告诉用户「这一版是文字卡，画面还没做」，
                  不要把它描述成完成的创作。
                """.formatted(effectiveWorkflowDir(workflowDir), projectId);
    }

    /**
     * 写文件；失败只记日志不阻断主流程。
     *
     * @param target 目标路径
     * @param text   内容
     */
    private static void writeText(Path target, String text) {
        try {
            Files.writeString(target, text, java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // 指引写不进去不影响项目可用，见 writeAgentGuide 注释
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
     * 把已有项目的 agent 指引升级到当前版本。
     *
     * <p><strong>为什么需要它</strong>：早期框架写入的指引要求「先想清楚分镜再写 JSON」，
     * 与 workflow-v5 的 Prompt-first 方向相反。只改新建模板的话，
     * 所有已有项目的 agent 仍会被旧指引引向文字卡片，
     * 等于改了一半。</p>
     *
     * <p><strong>只升级框架自己写的</strong>：判据是头部标记。
     * 没有标记的文件可能是用户自己维护的，也可能是很早期的框架产物 ——
     * 后者无法区分，所以宁可不覆盖：覆盖用户手写的项目约定，
     * 比留一份旧指引更糟。返回状态让调用方能把「跳过了」如实告诉用户。</p>
     *
     * @param projectDir 项目目录
     * @param projectId  项目 ID
     * @return 升级结果
     */
    public GuideUpgrade upgradeAgentGuide(Path projectDir, String projectId) {
        Path guide = projectDir.resolve("AGENTS.md");
        if (!Files.isRegularFile(guide)) {
            // 没有指引：补一份。旧项目也该拿到正确的创作依据。
            writeAgentGuide(projectDir, projectId);
            return GuideUpgrade.WRITTEN;
        }
        String text;
        try {
            text = Files.readString(guide, java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException unreadable) {
            return GuideUpgrade.UNREADABLE;
        }
        /* 判断「是不是框架写的」要看任意版本的标记，不能只看当前版本 ——
           否则每次升版本（v2 → v3）旧文件都对不上，全被当成「用户改过」跳过，
           已有项目永远拿不到新指引。实测：25 个项目全部被跳过。 */
        if (FRAMEWORK_MARKER.matcher(text).lookingAt()) {
            // 已是当前版本：只在确实需要时重写，避免无谓改动文件时间
            if (text.equals(agentGuide(projectId, workflowDir))) {
                return GuideUpgrade.CURRENT;
            }
            writeAgentGuide(projectDir, projectId);
            return GuideUpgrade.UPDATED;
        }
        /* 没有标记：可能是用户改过的。不覆盖，如实报告，让用户自己决定。 */
        return GuideUpgrade.SKIPPED_USER_EDITED;
    }

    /**
     * 用指定项目 ID 重写指引。
     *
     * @param projectDir 项目目录
     * @param projectId  项目 ID
     */
    private void writeAgentGuide(Path projectDir, String projectId) {
        writeText(projectDir.resolve("AGENTS.md"), agentGuide(projectId, workflowDir));
    }

    /** 指引升级结果。 */
    public enum GuideUpgrade {
        /** 原本没有指引，已补写 */
        WRITTEN,
        /** 是框架旧版，已更新 */
        UPDATED,
        /** 已是当前版本 */
        CURRENT,
        /** 无框架标记（可能是用户改过的），未改动 */
        SKIPPED_USER_EDITED,
        /** 文件读不出来，未改动 */
        UNREADABLE
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

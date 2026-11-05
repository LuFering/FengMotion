package com.fengmotion.server.fx.service.capability;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

/**
 * 能力库条目的解析器：一种文件格式一个实现。
 *
 * <p><strong>为什么要有这层抽象</strong>：之前的导入器把三条路径写死
 * （lemo 的 styles、shotcraft 的 shots、remotion 的 scenes），
 * 换一个库、换一种目录布局就不认了。用户提出「不能做通用导入器吗」，
 * 指的就是这个。</p>
 *
 * <p>拆开之后，导入器只负责「遍历目录 → 问每个解析器能不能认 → 收结果」，
 * 新增格式只需要多写一个实现，不必再改遍历逻辑。</p>
 *
 * <p><strong>「通用」的边界</strong>：这里说的通用是<em>格式</em>通用，
 * 不是「读懂任意内容」。解析器不猜文件名含义、不把源码翻译成人话；
 * 认不出就如实返回空，由上层记为「跳过」并说明原因。</p>
 */
public interface CapabilitySource {

    /** 解析结果的来源标识，会写进 {@code source_kind}，例如 lemo / shotcraft / md / json。 */
    String kind();

    /**
     * 判断某个文件是否由本解析器负责。
     *
     * <p>只做「认格式」的判断，不做内容校验：内容坏了应该由
     * {@link #parse} 抛错，那样错误信息才能定位到具体文件。</p>
     *
     * @param file 候选文件
     * @return 认这个文件时返回 true
     */
    boolean supports(Path file);

    /**
     * 解析一个文件，可能产出多条条目。
     *
     * <p>返回空列表表示「这个文件认得出格式但没有可用内容」——
     * 调用方会记为跳过，而不是静默当成成功。</p>
     *
     * @param file      文件
     * @param scanRoot  本次扫描的根目录，用来推算相对路径（写进 source_path）
     * @return 解析出的原始条目
     * @throws Exception 格式错误；由调用方记为该文件失败
     */
    List<ParsedItem> parse(Path file, Path scanRoot) throws Exception;

    /**
     * 扫描根目录，产出该解析器负责的全部条目。
     *
     * <p>默认实现是「深度有限地遍历 + 对每个文件试 {@link #supports}」。
     * 需要特殊布局的解析器（例如「一个目录聚合一份元数据」）可以覆写。</p>
     *
     * @param root 扫描根
     * @param out  收集器
     * @return 被跳过的文件数
     */
    default int scan(Path root, List<ParsedItem> out) {
        if (!Files.isDirectory(root)) {
            return 0;
        }
        int skipped = 0;
        try (Stream<Path> walk = Files.walk(root, 6)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                if (isNoise(file)) {
                    continue;
                }
                if (!supports(file)) {
                    continue;
                }
                try {
                    List<ParsedItem> items = parse(file, root);
                    if (items.isEmpty()) {
                        skipped++;
                    } else {
                        out.addAll(items);
                    }
                } catch (Exception failed) {
                    /* 单个文件解析失败不该让整批泡汤，但必须计入跳过数，
                       否则「少了几个条目」会变成查不出来的问题。 */
                    skipped++;
                }
            }
        } catch (Exception unreadable) {
            return skipped + 1;
        }
        return skipped;
    }

    /**
     * 是否是明显不该被导入的文件。
     *
     * <p>这些不是「解析失败」，是「根本不该当成条目」：
     * 仓库说明、许可、依赖目录。把它们收进特效库，
     * 用户会在技法列表里看到一条叫 README 的「技法」。</p>
     */
    static boolean isNoise(Path file) {
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        if (name.startsWith("readme") || name.startsWith("attribution")
                || name.startsWith("license") || name.startsWith("changelog")
                || name.startsWith("contributing") || name.startsWith("code_of_conduct")) {
            return true;
        }
        /* 「这个条目自己的说明书」不是独立条目。
           实测：lemo 的每个风格目录里同时有 style.json（元数据）与
           STYLE.md / DEMO.md（说明），不排除时同一个风格会被收成 3 条。 */
        if (name.equals("style.md") || name.equals("demo.md") || name.equals("meta.md")
                || name.equals("index.md") || name.equals("skill.md")) {
            return true;
        }
        /* 仓库级文档：讲的是「这个库怎么用」，不是某条技法。
           实测：不排除时 AGENTS.md / DIRECTOR.md / MY-STYLES.md 会被当成 4 条技法。 */
        if (name.equals("agents.md") || name.equals("director.md") || name.equals("my-styles.md")
                || name.equals("technique.md") || name.equals("guide.md")
                || name.equals("usage.md") || name.equals("install.md")) {
            return true;
        }
        /* 模板与草稿目录不是真实条目。 */
        for (Path segment : file) {
            String dir = segment.toString().toLowerCase(Locale.ROOT);
            if (dir.equals("_template") || dir.equals("template") || dir.equals("draft")
                    || dir.equals("sample") || dir.equals("samples")) {
                return true;
            }
        }
        /* 「references/ 下、但不在 shots/ 里」的是流程与方法论文档，
           不是可借鉴的技法本身。
           为什么用这条结构性规则而不是继续加关键词：关键词只能一个一个补，
           遇到英文 slug（如 promo-energy-arc）就漏。目录层次才是稳定信号。 */
        List<String> parts = new ArrayList<>();
        for (Path segment : file) {
            parts.add(segment.toString().toLowerCase(Locale.ROOT));
        }
        int referencesAt = parts.indexOf("references");
        if (referencesAt >= 0 && !parts.contains("shots")) {
            return true;
        }
        for (Path segment : file) {
            String dir = segment.toString().toLowerCase(Locale.ROOT);
            if (dir.equals("node_modules") || dir.equals(".git") || dir.equals("dist")
                    || dir.equals("build") || dir.equals("__pycache__")) {
                return true;
            }
            /* 实现工程与资产目录里放的是「这条风格怎么被做出来的」，
               不是技法本身。实测：不排除这些目录时，从 lemo 里多收了
               300 多条 demo/lines.json、demo/cues.json 之类的台词与音乐提示，
               条目名叫 "L1"、"5.4" —— 看起来像数据损坏，实际是收了实现细节。 */
            if (dir.equals("demo") || dir.equals("demos") || dir.equals("src")
                    || dir.equals("assets") || dir.equals("videos") || dir.equals("audio")
                    || dir.equals("template") || dir.equals("templates")
                    || dir.equals("core") || dir.equals("plugin") || dir.equals("scripts")) {
                return true;
            }
        }
        return false;
    }

    /**
     * 名字是否像一个「可借鉴的东西」，而不是一条数据记录。
     *
     * <p>实测动机：不设这道闸时，从 lemo 的 demo 里收进了大量名字为
     * "L1"、"L2"、"5.4" 的条目 —— 它们是台词行和音乐提示点。
     * 这类名字的共同点是极短、且几乎全是数字或编号。</p>
     *
     * <p>规则刻意保守：宁可漏收几条边缘条目，也不要让特效库里出现
     * 一眼就是数据的行。纯中文名（如「装饰艺术」）不受长度限制影响，
     * 因为 4 个汉字已经表达了完整概念。</p>
     *
     * @param name 候选名字
     * @return 像条目时返回 true
     */
    static boolean looksLikeEntryName(String name) {
        if (name == null) {
            return false;
        }
        String trimmed = name.strip();
        if (trimmed.isEmpty()) {
            return false;
        }
        /* 纯数字/编号：5.4、L1、#12、2/3 —— 都是数据记录。 */
        if (trimmed.matches("^[A-Za-z]?[0-9.\\-/:]+$")) {
            return false;
        }
        /* 只由一两个字符组成的名字没有信息量。中文按字算，英文按词算。 */
        long letters = trimmed.codePoints().filter(Character::isLetter).count();
        return letters >= 2;
    }

    /**
     * 解析出来的原始条目。
     *
     * <p>刻意保持与 {@code FxTechnique} 不同的形状：解析器只提供
     * 「这个源说了什么」，如何落成特效条目（分类映射、执行状态、
     * 来源信息合并）由导入器决定。混在一起会让每个解析器都要重复一遍这些规则。</p>
     *
     * @param id          稳定 ID（带来源前缀，避免跨库撞 ID）
     * @param name        展示名
     * @param nameEn      英文名；没有为空串
     * @param intent      一句话说明它在解决什么表达问题
     * @param categoryHint 源给出的分类提示（中文标签或目录名），由导入器映射到枚举
     * @param scenes      适用场合
     * @param keywords    额外检索词
     * @param steps       步骤/说明
     * @param previewImage 预览图相对路径；没有为空串
     * @param sourceProject 来源项目名
     * @param sourceUrl   原始链接
     * @param sourceVersion 版本或编号
     * @param licenseCode 代码/文档许可
     * @param licensePreview 预览素材许可
     * @param attribution 署名要求
     * @param sourcePath  本地文件路径
     */
    record ParsedItem(
            String id,
            String name,
            String nameEn,
            String intent,
            String categoryHint,
            List<String> scenes,
            List<String> keywords,
            List<String> steps,
            String previewImage,
            String sourceProject,
            String sourceUrl,
            String sourceVersion,
            String licenseCode,
            String licensePreview,
            String attribution,
            String sourcePath) {
    }
}

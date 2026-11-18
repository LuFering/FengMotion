package com.fengmotion.server.skill.domain;

import java.util.List;
import java.util.Map;

/**
 * skill 包的静态清点报告。
 *
 * <p>只读取和解析文件，不执行任何东西；同一份文件内容总是得到同一份报告。
 * import 依赖靠正则提取，是近似结果（{@link Dependencies#approximate()} 恒为 true）。</p>
 *
 * @param version            报告格式版本
 * @param skills             包内的 skill（每个 SKILL.md 一个）
 * @param files              全部文件
 * @param scripts            脚本文件与 package.json scripts，全部未执行
 * @param instructedCommands SKILL.md 里要求运行的命令，需人工批准
 * @param dependencies       npm 依赖对照
 * @param license            许可证
 * @param warnings           警告
 * @param summary            汇总
 */
public record SkillInventory(int version, List<Skill> skills, List<FileEntry> files, List<ScriptEntry> scripts,
                             List<InstructedCommand> instructedCommands, Dependencies dependencies,
                             License license, List<String> warnings, Summary summary) {

    /** 当前报告格式版本。字段只增不改义；改义时升版本。 */
    public static final int VERSION = 1;

    /**
     * @param path             SKILL.md 的包内路径
     * @param directory        skill 所在目录；包根目录为空串
     * @param name             frontmatter 的 name；缺失时为 null
     * @param description      frontmatter 的 description；缺失时为 null
     * @param frontmatter      frontmatter 全部字段（原样保留）
     * @param frontmatterError frontmatter 解析失败的原因；成功或没有 frontmatter 时为 null
     */
    public record Skill(String path, String directory, String name, String description,
                        Map<String, Object> frontmatter, String frontmatterError) {
    }

    /**
     * @param path     包内路径
     * @param size     字节数
     * @param sha256   内容 sha256
     * @param category 类别：skill / doc / component / code / script / config / asset / other
     * @param imports  代码文件的 import；非代码文件为 null
     */
    public record FileEntry(String path, long size, String sha256, String category, List<ImportRef> imports) {
    }

    /**
     * @param specifier 源码里写的模块名
     * @param kind      relative / package / builtin / alias
     * @param resolved  relative、alias 解析到的包内路径，package 为包名；解析不了为 null
     */
    public record ImportRef(String specifier, String kind, String resolved) {
    }

    /**
     * @param path   包内路径（npm script 为 package.json 的路径）
     * @param kind   file / npm-script
     * @param name   npm script 名；文件为 null
     * @param reason 为什么认定是脚本：扩展名、shebang 或 package.json scripts
     */
    public record ScriptEntry(String path, String kind, String name, String reason) {
    }

    /**
     * @param skillPath 出现这条命令的 SKILL.md
     * @param command   命令原文
     */
    public record InstructedCommand(String skillPath, String command) {
    }

    /**
     * @param declared         package.json 声明的依赖（含 dev / peer），包名 → 版本范围
     * @param used             代码里实际 import 的 npm 包
     * @param undeclared       用到却没有声明的包
     * @param remotionPackages 声明的 remotion 相关包及版本
     * @param approximate      依赖靠正则提取，恒为 true
     */
    public record Dependencies(Map<String, String> declared, List<String> used, List<String> undeclared,
                               Map<String, String> remotionPackages, boolean approximate) {
    }

    /**
     * @param spdx               识别出的许可证；认不出为 unknown
     * @param files              许可证文件
     * @param packageJsonLicense package.json 的 license 字段；没有为 null
     */
    public record License(String spdx, List<String> files, String packageJsonLicense) {
    }

    /**
     * @param skills            skill 数
     * @param files             文件数
     * @param totalBytes        总字节数
     * @param categories        各类别文件数
     * @param scripts           脚本条目数
     * @param unresolvedImports 解析不了的 relative / alias import 数
     */
    public record Summary(int skills, int files, long totalBytes, Map<String, Integer> categories,
                          int scripts, int unresolvedImports) {
    }
}

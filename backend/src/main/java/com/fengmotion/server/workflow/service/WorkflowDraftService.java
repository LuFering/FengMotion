package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;

/**
 * Prompt-first 工作稿文件（{@code lookdev-brief.md}、{@code film-plan.md}）的读写。
 *
 * <p><strong>为什么工作稿是文件而不是工作流节点</strong>：创作 agent 在项目目录里工作，
 * 它读写的是这两份文件。以前画布上的「视觉构想 / 导演处理」节点只把文字拼进当轮指令，
 * 下一轮就丢了，还会混进原文。文件是唯一事实来源：用户在界面里改的、agent 在创作中写的，
 * 都落在同一个文件上。</p>
 *
 * <p><strong>并发</strong>：agent 也会写这两份文件，所以写入必须带上读取时的 sha256，
 * 内容已变就拒绝（409），由用户看过新内容再决定；项目有制作任务在排队或运行时也拒绝，
 * 避免和 agent 同时改。</p>
 */
@Service
@RequiredArgsConstructor
public class WorkflowDraftService {

    /** 界面可读写的工作稿：对外名称 → 项目内文件名。只允许这两份，不开放任意路径。 */
    static final Map<String, String> DRAFTS;
    static {
        var drafts = new LinkedHashMap<String, String>();
        drafts.put("lookdev-brief", "lookdev-brief.md");
        drafts.put("film-plan", "film-plan.md");
        DRAFTS = java.util.Collections.unmodifiableMap(drafts);
    }

    /** 单份工作稿上限。模板约 6KB，一页导演处理远小于此。 */
    static final int MAX_BYTES = 200_000;

    private final ProjectRepository projects;
    private final WorkflowToolRunner tools;
    private final ProjectOperationLock operations;
    private final CreationJobs jobs;

    /**
     * 列出全部工作稿的状态（不含正文）。
     *
     * @param projectId 项目 ID
     * @return 按固定顺序的状态
     */
    public List<Draft> list(String projectId) {
        Path root = requireInitializedRoot(projectId);
        return DRAFTS.keySet().stream().map(name -> read(root, name, false)).toList();
    }

    /**
     * 读取一份工作稿。
     *
     * @param projectId 项目 ID
     * @param name      工作稿名称
     * @return 正文与状态；文件不存在时 {@code exists=false}、正文为空串
     */
    public Draft get(String projectId, String name) {
        requireKnown(name);
        return read(requireInitializedRoot(projectId), name, true);
    }

    /**
     * 写入一份工作稿。
     *
     * @param projectId  项目 ID
     * @param name       工作稿名称
     * @param content    完整正文，逐字保存
     * @param baseSha256 读取时的 sha256；文件当时不存在则为 null
     * @return 写入后的工作稿
     */
    public synchronized Draft put(String projectId, String name, String content, String baseSha256) {
        requireKnown(name);
        if (content == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "工作稿内容缺失");
        }
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "工作稿超过 " + (MAX_BYTES / 1000) + "KB，请精简后再保存");
        }
        Path root = requireInitializedRoot(projectId);
        if (operations.isBusy(projectId) || jobs.hasActive(projectId)) {
            throw new ApiException(HttpStatus.CONFLICT, "project_busy",
                    "这个项目正在制作，agent 可能也在改工作稿，请等本轮结束后再保存");
        }

        Path file = root.resolve(DRAFTS.get(name));
        rejectSymlink(file);
        String current = Files.exists(file, LinkOption.NOFOLLOW_LINKS) ? sha256(readBytes(file)) : null;
        String base = baseSha256 == null || baseSha256.isBlank() ? null : baseSha256;
        if (!java.util.Objects.equals(current, base)) {
            throw new ApiException(HttpStatus.CONFLICT, "draft_conflict",
                    current == null
                            ? "这份工作稿已被删除，请重新读取后再保存"
                            : "这份工作稿在你编辑期间被修改过（可能是 agent 写的），请先查看最新内容");
        }

        writeAtomically(file, bytes);
        return read(root, name, true);
    }

    private Draft read(Path root, String name, boolean withContent) {
        Path file = root.resolve(DRAFTS.get(name));
        rejectSymlink(file);
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            return new Draft(name, DRAFTS.get(name), false, withContent ? "" : null, null, null, 0, null);
        }
        byte[] bytes = readBytes(file);
        String text = new String(bytes, StandardCharsets.UTF_8);
        String updatedAt;
        try {
            updatedAt = Files.getLastModifiedTime(file, LinkOption.NOFOLLOW_LINKS).toInstant().toString();
        } catch (IOException unreadable) {
            updatedAt = null;
        }
        return new Draft(name, DRAFTS.get(name), true, withContent ? text : null, sha256(bytes),
                isTemplate(name, text), bytes.length, updatedAt);
    }

    /**
     * 正文是否仍是 init 时写入的工作流模板原样。供预设落地判断「能不能替换」。
     *
     * @param name 工作稿名称：lookdev-brief / film-plan
     * @return 找不到模板目录时为 null（不知道），不猜
     */
    public Boolean matchesWorkflowTemplate(String name, String text) {
        requireKnown(name);
        return isTemplate(name, text);
    }

    /**
     * 是否仍是 init 时写入的模板原样。
     *
     * @return 找不到模板目录时为 null（不知道），不猜
     */
    private Boolean isTemplate(String name, String text) {
        Path workflowRoot = tools.resolveWorkflowRoot();
        if (workflowRoot == null) return null;
        Path template = workflowRoot.resolve("prompt-first").resolve("templates").resolve(DRAFTS.get(name));
        if (!Files.isRegularFile(template)) return null;
        try {
            return normalize(Files.readString(template)).equals(normalize(text));
        } catch (IOException unreadable) {
            return null;
        }
    }

    private static String normalize(String text) {
        return text.replace("\r\n", "\n").strip();
    }

    private void writeAtomically(Path file, byte[] bytes) {
        Path temp = file.resolveSibling("." + file.getFileName() + "." + UUID.randomUUID() + ".tmp");
        try {
            Files.write(temp, bytes);
            try {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException failed) {
            try {
                Files.deleteIfExists(temp);
            } catch (IOException ignored) {
                // 临时文件清理失败不影响结论：写入已经失败
            }
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "draft_write_failed", "工作稿未能保存，原文件未改动");
        }
    }

    private static byte[] readBytes(Path file) {
        try {
            return Files.readAllBytes(file);
        } catch (IOException unreadable) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "draft_unreadable", "无法读取工作稿文件");
        }
    }

    /** 项目目录里的符号链接可能指向目录外；读写都不跟随，直接拒绝。 */
    private static void rejectSymlink(Path file) {
        if (Files.isSymbolicLink(file)) {
            throw new ApiException(HttpStatus.CONFLICT, "draft_unsafe", "工作稿是符号链接，已拒绝读写，请在项目目录里改成普通文件");
        }
    }

    private static void requireKnown(String name) {
        if (name == null || !DRAFTS.containsKey(name)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "没有这份工作稿");
        }
    }

    private Path requireInitializedRoot(String projectId) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        if (project.rootPath() == null || project.rootPath().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录");
        }
        Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();
        if (!Files.isRegularFile(root.resolve("prompt.original.md"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "workflow_not_initialized",
                    "项目还没有 prompt.original.md：请先写下原始创作需求。");
        }
        return root;
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /**
     * 一份工作稿。
     *
     * @param name      对外名称
     * @param file      项目内文件名
     * @param exists    文件是否存在
     * @param content   正文；列表接口为 null
     * @param sha256    正文 sha256；不存在时为 null，写入时原样回传
     * @param template  是否仍是模板原样；模板目录不可用时为 null
     * @param size      字节数
     * @param updatedAt 文件修改时间
     */
    public record Draft(String name, String file, boolean exists, String content, String sha256,
                        Boolean template, long size, String updatedAt) {
    }
}

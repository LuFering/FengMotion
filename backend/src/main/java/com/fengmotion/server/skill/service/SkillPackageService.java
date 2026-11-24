package com.fengmotion.server.skill.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Stream;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.skill.client.GithubArchiveClient;
import com.fengmotion.server.skill.domain.SkillInventory;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.store.SkillPackageRepository;

import lombok.extern.slf4j.Slf4j;

/**
 * skill 包的导入、查询与删除。
 *
 * <p><strong>导入流程</strong>：校验输入 → 把 ref 固定成 commit → 同一 owner/repo/commit/子目录已导入则直接复用 →
 * 下载 zip 解压到临时目录 → 静态清点 → 文件设为只读 → 原子移动到正式目录 → 登记。
 * 任何一步失败都删掉临时目录，不留半成品。</p>
 *
 * <p><strong>不执行</strong>：本模块不启动任何外部进程，也不把任何文件设成可执行。</p>
 *
 * <p>导入是同步的，并且全局串行：桌面端本机单用户，导入很少发生，串行能避免两次导入同一个包时互相覆盖。</p>
 */
@Slf4j
@Service
public class SkillPackageService {

    private static final String OWNER = "[A-Za-z0-9-]{1,39}";
    private static final String REPO = "[A-Za-z0-9_.-]{1,100}";
    private static final String REF = "[A-Za-z0-9._/-]{1,200}";

    private final SkillPackageRepository repository;
    private final GithubArchiveClient github;
    private final Path root;
    private final SkillArchiveExtractor extractor;
    private final SkillInventoryScanner scanner = new SkillInventoryScanner();

    public SkillPackageService(SkillPackageRepository repository, GithubArchiveClient github,
                               @Value("${fengmotion.skill-packages.root:${fengmotion.data-dir}/skill-packages}") String root,
                               @Value("${fengmotion.skill-packages.max-total-bytes:52428800}") long maxTotalBytes,
                               @Value("${fengmotion.skill-packages.max-file-bytes:10485760}") long maxFileBytes,
                               @Value("${fengmotion.skill-packages.max-files:5000}") int maxFiles) {
        this.repository = repository;
        this.github = github;
        this.root = Path.of(root).toAbsolutePath().normalize();
        this.extractor = new SkillArchiveExtractor(maxTotalBytes, maxFileBytes, maxFiles);
    }

    /**
     * 导入结果。
     *
     * @param skillPackage 包
     * @param reused       同一 commit 已导入过，直接返回了已有记录
     */
    public record ImportOutcome(SkillPackage skillPackage, boolean reused) {
    }

    /**
     * 导入一个 skill 包。
     *
     * @param repository {@code owner/repo} 或 GitHub 地址（可带 {@code /tree/<ref>/<path>}）
     * @param ref        分支 / 标签 / commit；为空取默认分支（地址里带的 ref 仅在此为空时生效）
     * @param path       只导入的子目录；为空导入整个仓库（地址里带的路径仅在此为空时生效）
     */
    public synchronized ImportOutcome importPackage(String repository, String ref, String path) {
        Source source = parseSource(repository, ref, path);
        String commit = github.resolveCommit(source.owner(), source.repo(), source.ref());

        var existing = this.repository.findByIdentity(source.owner(), source.repo(), commit, source.path());
        if (existing.isPresent()) {
            if (Files.isDirectory(Path.of(existing.get().rootDir()))) return new ImportOutcome(existing.get(), true);
            // 登记还在、文件被删了：去掉失效登记后重新导入
            log.warn("skill 包 {} 的落盘目录已不存在，重新导入", existing.get().id());
            this.repository.delete(existing.get().id());
        }

        Path staging = root.resolve(".staging-" + UUID.randomUUID());
        Path target = root.resolve(source.owner() + "__" + source.repo()).resolve(commit).resolve(pathKey(source.path()));
        try {
            SkillArchiveExtractor.Result extracted;
            try (InputStream zip = github.openZip(source.owner(), source.repo(), commit)) {
                extracted = extractor.extract(zip, source.path(), staging);
            }
            if (extracted.fileCount() == 0) {
                throw new ApiException(HttpStatus.NOT_FOUND, "not_found", source.path().isEmpty()
                        ? "仓库在这个 commit 下没有文件"
                        : "仓库里没有子目录 " + source.path());
            }
            SkillInventory report = scanner.scan(staging);
            makeReadOnly(staging);

            Files.createDirectories(target.getParent());
            // 只有「上次移动后、登记前崩溃」才会留下同名目录；它是我们自己管理的目录，可以替换
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) deleteTree(target);
            try {
                Files.move(staging, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(staging, target);
            }

            SkillPackage pkg = new SkillPackage(UUID.randomUUID().toString(), source.owner(), source.repo(),
                    source.ref(), commit, source.path(), target.toString(), extracted.fileCount(),
                    extracted.totalBytes(), report, Instant.now());
            try {
                this.repository.save(pkg);
            } catch (RuntimeException failed) {
                deleteTree(target);
                throw failed;
            }
            log.info("已导入 skill 包 {}/{}@{} path='{}'：{} 个文件，{} 个 skill", source.owner(), source.repo(),
                    commit, source.path(), extracted.fileCount(), report.summary().skills());
            return new ImportOutcome(pkg, false);
        } catch (IOException failed) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "skill_import_failed", "skill 包未能落盘：" + failed.getMessage());
        } finally {
            deleteTreeQuietly(staging);
        }
    }

    public List<SkillPackage> list() {
        return repository.findAll();
    }

    /**
     * 导入前预检结果（契约 workflow-editor-ui.md §3）。
     *
     * @param owner             统一小写
     * @param repo              统一小写
     * @param ref               解析出的分支 / 标签 / commit；null 表示默认分支
     * @param commitSha         将要固定的 40 位 commit
     * @param subPath           只导入的子目录；空串表示整个仓库
     * @param existingPackageId 同一 owner/repo/commit/子目录已导入且文件还在时为包 ID
     */
    public record Resolution(String owner, String repo, String ref, String commitSha, String subPath,
                             String existingPackageId) {
    }

    /**
     * 导入前预检：只请求 GitHub 把 ref 解析成 commit，不下载压缩包、不落盘、不登记。
     *
     * <p>不加导入的全局锁：只读登记表，不会和导入互相覆盖；加锁会让预检被一次正在进行的导入卡住最长 60 秒。
     * 登记还在但落盘目录已被删除的包按「未导入」处理，与 {@link #importPackage} 遇到它时会重新导入一致。</p>
     *
     * @param repository 与 {@link #importPackage} 相同
     * @param ref        与 {@link #importPackage} 相同
     * @param path       与 {@link #importPackage} 相同
     */
    public Resolution resolve(String repository, String ref, String path) {
        Source source = parseSource(repository, ref, path);
        String commit = github.resolveCommit(source.owner(), source.repo(), source.ref());
        String existing = this.repository.findByIdentity(source.owner(), source.repo(), commit, source.path())
                .filter(pkg -> Files.isDirectory(Path.of(pkg.rootDir())))
                .map(SkillPackage::id)
                .orElse(null);
        return new Resolution(source.owner(), source.repo(), source.ref(), commit, source.path(), existing);
    }

    public SkillPackage get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "skill 包不存在"));
    }

    /** 删除登记与落盘文件；之后可以重新导入。 */
    public synchronized void delete(String id) {
        SkillPackage pkg = get(id);
        Path dir = Path.of(pkg.rootDir()).toAbsolutePath().normalize();
        try {
            if (Files.exists(dir, LinkOption.NOFOLLOW_LINKS)) deleteTree(dir);
        } catch (IOException failed) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "skill_delete_failed", "skill 包文件未能删除：" + failed.getMessage());
        }
        repository.delete(id);
    }

    /* ── 输入校验 ─────────────────────────────────────────────────── */

    record Source(String owner, String repo, String ref, String path) {
    }

    static Source parseSource(String repository, String ref, String path) {
        if (repository == null || repository.isBlank()) throw invalid("缺少仓库：请填写 owner/repo 或 GitHub 地址");
        String text = repository.strip();
        String owner;
        String repo;
        String urlRef = null;
        String urlPath = null;
        if (text.contains("://")) {
            URI uri;
            try {
                uri = URI.create(text);
            } catch (IllegalArgumentException bad) {
                throw invalid("无法识别这个地址");
            }
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !(host.equals("github.com") || host.equals("www.github.com"))) {
                throw invalid("只支持 https://github.com 上的仓库");
            }
            String[] parts = uri.getPath() == null ? new String[0] : uri.getPath().replaceAll("^/+|/+$", "").split("/");
            if (parts.length < 2) throw invalid("地址里缺少 owner/repo");
            owner = parts[0];
            repo = parts[1];
            /* /tree/<ref>/<path...>：ref 只取一段。带斜杠的分支名请用 ref 字段单独传。 */
            if (parts.length >= 4 && (parts[2].equals("tree") || parts[2].equals("blob"))) {
                urlRef = parts[3];
                if (parts.length > 4) urlPath = String.join("/", List.of(parts).subList(4, parts.length));
            }
        } else {
            String[] parts = text.split("/");
            if (parts.length != 2) throw invalid("仓库格式应为 owner/repo");
            owner = parts[0];
            repo = parts[1];
        }
        if (repo.endsWith(".git")) repo = repo.substring(0, repo.length() - 4);
        if (!owner.matches(OWNER) || !repo.matches(REPO) || repo.equals(".") || repo.equals("..")) {
            throw invalid("owner 或仓库名包含不支持的字符");
        }

        String effectiveRef = ref == null || ref.isBlank() ? urlRef : ref.strip();
        if (effectiveRef != null && (!effectiveRef.matches(REF) || effectiveRef.contains("..")
                || effectiveRef.startsWith("/") || effectiveRef.endsWith("/"))) {
            throw invalid("ref 包含不支持的字符");
        }

        String effectivePath = path == null || path.isBlank() ? urlPath : path;
        String normalizedPath = effectivePath == null ? "" : effectivePath.strip().replaceAll("^/+|/+$", "");
        if (normalizedPath.length() > 500 || normalizedPath.contains("\\") || normalizedPath.indexOf('\0') >= 0) {
            throw invalid("子目录路径无效");
        }
        if (!normalizedPath.isEmpty()) {
            for (String segment : normalizedPath.split("/")) {
                if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) throw invalid("子目录路径无效");
            }
        }
        return new Source(owner.toLowerCase(Locale.ROOT), repo.toLowerCase(Locale.ROOT), effectiveRef, normalizedPath);
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", message);
    }

    /* ── 文件 ─────────────────────────────────────────────────────── */

    /** 同一 commit 的不同子目录落在不同目录里；目录名用路径哈希，避免把用户输入直接当目录名。 */
    private static String pathKey(String path) {
        if (path.isEmpty()) return "_all";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(path.getBytes(StandardCharsets.UTF_8));
            return "path-" + HexFormat.of().formatHex(digest).substring(0, 16);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** 文件设为 r--r--r--；目录保持可写，删除包时才不需要先改权限。 */
    private static void makeReadOnly(Path dir) throws IOException {
        try (Stream<Path> walk = Files.walk(dir)) {
            for (Path p : walk.filter(f -> Files.isRegularFile(f, LinkOption.NOFOLLOW_LINKS)).toList()) {
                PosixFileAttributeView posix = Files.getFileAttributeView(p, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
                if (posix != null) posix.setPermissions(PosixFilePermissions.fromString("r--r--r--"));
                else p.toFile().setReadOnly();
            }
        }
    }

    /** 只删本模块管理的目录：路径必须在 skill 包根目录之下。 */
    private void deleteTree(Path dir) throws IOException {
        Path normalized = dir.toAbsolutePath().normalize();
        if (!normalized.startsWith(root) || normalized.equals(root)) {
            throw new IllegalStateException("拒绝删除 skill 包目录之外的路径：" + normalized);
        }
        try (Stream<Path> walk = Files.walk(normalized)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) Files.delete(p);
        } catch (UncheckedIOException failed) {
            throw failed.getCause();
        }
    }

    private void deleteTreeQuietly(Path dir) {
        if (!Files.exists(dir, LinkOption.NOFOLLOW_LINKS)) return;
        try {
            deleteTree(dir);
        } catch (IOException | RuntimeException failed) {
            log.warn("临时目录未能清理：{}（{}）", dir, failed.getMessage());
        }
    }
}

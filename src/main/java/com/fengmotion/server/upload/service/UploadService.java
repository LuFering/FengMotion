package com.fengmotion.server.upload.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.upload.domain.UploadedFile;

/**
 * 附件上传：把用户带上来的文件落盘并给出可引用的 {@code fileId}。
 *
 * <p><strong>为什么只返回 id 不返回路径</strong>：契约要求「任务创建时只携带 fileId，
 * 不携带路径」（见 {@code upload/package-info.java}）。路径一旦外泄，前端或模型就能
 * 拼出落盘目录，等于把文件系统的形状交给了调用方。</p>
 *
 * <p><strong>落盘名的选择</strong>：用随机 UUID 作文件名，扩展名从 MIME 推导而非
 * 沿用原始文件名。原始名只存元信息、只用于展示 —— 用户上传的文件名可能包含
 * {@code ../} 或绝对路径片段，拿它拼路径就是目录穿越漏洞。</p>
 */
@Service
public class UploadService {

    /** 单文件大小上限：64 MiB。与前端「最多 6 个附件」的约定配合，够放下常见素材截图与短视频。 */
    private static final long MAX_BYTES = 64L * 1024 * 1024;

    /**
     * 允许的 MIME 前缀白名单。
     *
     * <p>不按扩展名判断：扩展名由用户完全控制，改一下就能绕过。
     * 这里按浏览器/客户端声明的 MIME 收敛到创作场景真正会用到的几类。</p>
     */
    private static final Set<String> ALLOWED_PREFIXES = Set.of("image/", "video/", "audio/", "text/", "application/pdf");

    /** 落盘根目录；默认 {@code ~/.fengmotion/uploads}，与工作区目录分开。 */
    private final Path root;

    public UploadService(@Value("${fengmotion.upload-root:${user.home}/.fengmotion/uploads}") String rootPath) {
        this.root = Path.of(rootPath).toAbsolutePath().normalize();
    }

    /**
     * 保存一个上传的附件。
     *
     * @param file 上传的文件
     * @return 已落盘的附件描述
     * @throws ApiException 文件为空、超限或类型不允许时抛出
     */
    public UploadedFile store(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "上传的文件为空");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large",
                    "文件超过 " + (MAX_BYTES / 1024 / 1024) + "MB 上限");
        }
        String mimeType = normalizeMime(file.getContentType());
        if (!isAllowed(mimeType)) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type",
                    "不支持的文件类型：" + mimeType);
        }

        String id = UUID.randomUUID().toString();
        String storedName = id + extensionFor(mimeType);
        Path target = root.resolve(storedName);

        // 目标路径必须仍在 root 之下：storedName 由本方法生成（UUID + 白名单扩展名），
        // 理论上不会越界；这里再校验一次，是防止将来有人改成沿用原始文件名时静默破防。
        if (!target.normalize().startsWith(root)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "非法的存储路径");
        }

        String sha256;
        try {
            Files.createDirectories(root);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = file.getInputStream();
                 DigestInputStream digesting = new DigestInputStream(in, digest)) {
                // 边读边算摘要，避免为了校验再读第二遍（大文件读两遍很贵）
                Files.copy(digesting, target, StandardCopyOption.REPLACE_EXISTING);
            }
            sha256 = HexFormat.of().formatHex(digest.digest());
        } catch (IOException failure) {
            throw new UncheckedIOException("附件落盘失败", failure);
        } catch (NoSuchAlgorithmException impossible) {
            // SHA-256 是 JDK 必须支持的算法，走到这里说明运行环境异常
            throw new IllegalStateException("运行环境缺少 SHA-256", impossible);
        }

        return new UploadedFile(
                id,
                displayName(file.getOriginalFilename(), id),
                file.getSize(),
                mimeType,
                kindOf(mimeType),
                sha256,
                Instant.now());
    }

    /**
     * 读取已上传附件的绝对路径。
     *
     * <p>供后续「让模型读附件」的功能使用；本类目前不对外暴露路径。</p>
     *
     * @param id 附件标识
     * @return 落盘路径
     */
    public Path resolve(String id) {
        // id 来自外部，必须先挡住穿越再拼路径
        if (id == null || !id.matches("[0-9a-fA-F-]{36}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "附件标识格式不正确");
        }
        /* 落盘名带 MIME 推导的扩展名（id.png），所以不能直接 root.resolve(id)。
           这里按目录扫描匹配前缀：扩展名不可知时也能找回文件，且仍受 root 约束。
           一个目录里通常只有几十个附件，扫描成本可接受；真要变大再建索引表。 */
        Path direct = root.resolve(id);
        if (Files.isRegularFile(direct)) {
            return direct;
        }
        try (var entries = Files.list(root)) {
            return entries
                    .filter(Files::isRegularFile)
                    .filter(p -> {
                        String name = p.getFileName().toString();
                        int dot = name.indexOf('.');
                        return (dot > 0 ? name.substring(0, dot) : name).equalsIgnoreCase(id);
                    })
                    .findFirst()
                    .orElse(direct);
        } catch (IOException unreadable) {
            return direct;
        }
    }

    /**
     * 读取已上传的图片，转成可以随消息发给模型的内联图片。
     *
     * <p>只有 DSH 协议接受的四种栅格格式能进这条路径（png/jpeg/webp/gif）；
     * 其他类型返回 {@code null}，由调用方跳过 —— 直接塞进去会被准入阶段拒绝，
     * 而且整条消息都会失败，连文本也发不出去。</p>
     *
     * <p>文件不存在（附件被清理或 id 来自别处）同样返回 {@code null}：
     * 一个附件丢了不该让整条消息发不出去。</p>
     *
     * @param id       附件标识
     * @param mimeType 附件声明的 MIME
     * @return 可发送的图片；不支持或读不到时为 null
     */
    public com.fengmotion.server.harness.client.DshSdkSession.InlineImage asInlineImage(
            String id, String mimeType) {
        if (!com.fengmotion.server.harness.client.DshSdkSession.InlineImage.isSupported(mimeType)) {
            return null;
        }
        Path path = resolve(id);
        if (!Files.isRegularFile(path)) {
            return null;
        }
        try {
            byte[] bytes = Files.readAllBytes(path);
            return new com.fengmotion.server.harness.client.DshSdkSession.InlineImage(
                    java.util.Base64.getEncoder().encodeToString(bytes), mimeType);
        } catch (IOException unreadable) {
            return null;
        }
    }

    /**
     * 规范化 MIME：去掉参数、转小写。
     *
     * @param raw 客户端声明的 Content-Type
     * @return 规范化后的 MIME；缺失时退回 {@code application/octet-stream}
     */
    private static String normalizeMime(String raw) {
        if (raw == null || raw.isBlank()) {
            return "application/octet-stream";
        }
        int semicolon = raw.indexOf(';');
        String base = semicolon >= 0 ? raw.substring(0, semicolon) : raw;
        return base.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * 判断 MIME 是否在白名单内。
     *
     * @param mimeType 规范化后的 MIME
     * @return 是否允许
     */
    private static boolean isAllowed(String mimeType) {
        return ALLOWED_PREFIXES.stream().anyMatch(mimeType::startsWith);
    }

    /**
     * 由 MIME 推导归类。
     *
     * @param mimeType 规范化后的 MIME
     * @return image / video / audio / file
     */
    private static String kindOf(String mimeType) {
        if (mimeType.startsWith("image/")) {
            return "image";
        }
        if (mimeType.startsWith("video/")) {
            return "video";
        }
        if (mimeType.startsWith("audio/")) {
            return "audio";
        }
        return "file";
    }

    /**
     * 由 MIME 推导扩展名。
     *
     * <p>不用原始文件名的扩展名：那是用户可控输入。未知 MIME 一律不给扩展名，
     * 让文件在磁盘上无法被误当成可执行内容。</p>
     *
     * @param mimeType 规范化后的 MIME
     * @return 以点开头的扩展名；未知时为空串
     */
    private static String extensionFor(String mimeType) {
        return switch (mimeType) {
            case "image/png" -> ".png";
            case "image/jpeg" -> ".jpg";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            case "video/mp4" -> ".mp4";
            case "video/quicktime" -> ".mov";
            case "video/webm" -> ".webm";
            case "audio/mpeg" -> ".mp3";
            case "audio/wav", "audio/x-wav" -> ".wav";
            case "application/pdf" -> ".pdf";
            case "text/plain" -> ".txt";
            default -> "";
        };
    }

    /**
     * 展示用文件名：去掉任何路径成分，过长则截断为中段加后缀。
     *
     * @param original 原始文件名；可能为 null
     * @param fallback 缺失时使用的名字
     * @return 仅用于展示的安全文件名
     */
    private static String displayName(String original, String fallback) {
        if (original == null || original.isBlank()) {
            return fallback;
        }
        // 只取最后一段：浏览器可能回传带路径的文件名
        String name = original.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        name = name.replace("\u0000", "").trim();
        if (name.isEmpty()) {
            return fallback;
        }
        return name.length() > 200 ? name.substring(0, 200) : name;
    }
}

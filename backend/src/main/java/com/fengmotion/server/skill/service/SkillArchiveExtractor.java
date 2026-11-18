package com.fengmotion.server.skill.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;

import org.springframework.http.HttpStatus;

import com.fengmotion.server.common.ApiException;

/**
 * 把 GitHub zip 安全地解压到一个新目录。
 *
 * <p><strong>防线</strong>：</p>
 * <ul>
 *   <li>条目名带 {@code ..}、绝对路径、反斜杠或 NUL 的一律拒绝（422），防止写到目标目录外；
 *       解析后的路径还要再确认仍在目标目录内。</li>
 *   <li>大小按<strong>实际读出的字节</strong>计，不信 zip 头里声明的大小：
 *       超过总量、单文件或文件数上限即整体失败（413）。</li>
 *   <li>只写普通文件，不设可执行权限。GitHub zip 里的符号链接会变成内容是目标路径的小文件，
 *       这里只当普通文件保存，不会顺着它读写别处。</li>
 * </ul>
 *
 * <p>失败时调用方负责删掉目标目录；本类不做部分回滚。</p>
 */
public class SkillArchiveExtractor {

    private final long maxTotalBytes;
    private final long maxFileBytes;
    private final int maxFiles;

    public SkillArchiveExtractor(long maxTotalBytes, long maxFileBytes, int maxFiles) {
        this.maxTotalBytes = maxTotalBytes;
        this.maxFileBytes = maxFileBytes;
        this.maxFiles = maxFiles;
    }

    /**
     * 解压结果。
     *
     * @param fileCount  文件数
     * @param totalBytes 总字节数
     */
    public record Result(int fileCount, long totalBytes) {
    }

    /**
     * 解压。
     *
     * @param zip     zip 流（调用方关闭）
     * @param subPath 只解压的子目录（相对仓库根，不带首尾斜杠）；空串表示全部
     * @param target  目标目录，必须尚不存在
     */
    public Result extract(InputStream zip, String subPath, Path target) throws IOException {
        Path root = target.toAbsolutePath().normalize();
        Files.createDirectories(root.getParent());
        Files.createDirectory(root);
        String prefix = subPath.isEmpty() ? "" : subPath + "/";

        int files = 0;
        long total = 0;
        byte[] buffer = new byte[64 * 1024];
        try (ZipInputStream in = new ZipInputStream(zip)) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                String name = entry.getName();
                rejectUnsafe(name);
                // GitHub zip 的第一层是 <repo>-<sha>/，去掉它才是仓库内路径
                int slash = name.indexOf('/');
                if (slash < 0) continue;
                String relative = name.substring(slash + 1);
                if (relative.isEmpty()) continue;
                if (!prefix.isEmpty()) {
                    if (!relative.startsWith(prefix)) continue;
                    relative = relative.substring(prefix.length());
                    if (relative.isEmpty()) continue;
                }
                if (entry.isDirectory() || relative.endsWith("/")) continue;

                Path destination = root.resolve(relative).normalize();
                if (!destination.startsWith(root) || destination.equals(root)) {
                    throw unsafe(name);
                }
                if (++files > maxFiles) {
                    throw tooLarge("文件数超过 " + maxFiles + " 个");
                }
                Files.createDirectories(destination.getParent());
                long written = 0;
                try (OutputStream out = Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW)) {
                    int read;
                    while ((read = in.read(buffer)) > 0) {
                        written += read;
                        total += read;
                        if (written > maxFileBytes) throw tooLarge("单个文件超过 " + mb(maxFileBytes) + "：" + relative);
                        if (total > maxTotalBytes) throw tooLarge("解压后总量超过 " + mb(maxTotalBytes));
                        out.write(buffer, 0, read);
                    }
                }
            }
        } catch (ZipException corrupt) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "下载的压缩包已损坏，请重试");
        }
        return new Result(files, total);
    }

    private static void rejectUnsafe(String name) {
        if (name.isEmpty() || name.startsWith("/") || name.contains("\\") || name.indexOf('\0') >= 0
                || name.matches("^[A-Za-z]:.*")) {
            throw unsafe(name);
        }
        for (String segment : name.split("/")) {
            if (segment.equals("..") || segment.equals(".")) throw unsafe(name);
        }
    }

    private static ApiException unsafe(String name) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "package_unsafe",
                "压缩包里有不安全的路径，已拒绝导入：" + name);
    }

    private static ApiException tooLarge(String reason) {
        return new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "package_too_large", "skill 包太大，已拒绝导入：" + reason);
    }

    private static String mb(long bytes) {
        return (bytes / (1024 * 1024)) + "MB";
    }
}

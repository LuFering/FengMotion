package com.fengmotion.server.asset.service;

import java.nio.file.Path;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 素材文件存储：应用管理目录 + 内容哈希分桶。
 *
 * <p>为什么复制入库而不是引用原路径（对账决定 C）：引用原文件时，「用户移动/删除了原文件」
 * 会让素材静默失效，而删除、备份、迁移的行为也跟着不可控。复制入库把生命周期收进应用内，
 * 代价是占额外磁盘 —— 对素材库这个取舍是对的。</p>
 *
 * <p>目录布局（{@code libraryRoot} 默认由 {@code fengmotion.data-dir} 派生）：
 * <pre>
 *   library/assets/ab/abcdef.../            ← 按哈希前两位分桶，避免单目录堆几万个文件
 *       original.&lt;ext&gt;                      ← 文件本体
 *       thumb.webp                          ← 缩略图（有则存在）
 * </pre>
 * 数据库只存相对路径，整目录搬迁后仍然可用。</p>
 */
@Service
public class AssetStorage {

    private static final Logger log = LoggerFactory.getLogger(AssetStorage.class);

    private final Path root;

    public AssetStorage(@Value("${fengmotion.asset.library-root:${fengmotion.data-dir}/library}") String libraryRoot) {
        this.root = Path.of(libraryRoot).toAbsolutePath().normalize();
        log.info("素材库存储根目录：{}", this.root);
    }

    /** 存储根目录（绝对、已规范化）。 */
    public Path root() {
        return root;
    }

    /** 某一内容哈希对应的素材目录，相对存储根的路径。 */
    public String relativeDirFor(String contentHash) {
        if (contentHash == null || contentHash.length() < 3) {
            throw new IllegalArgumentException("contentHash 过短，无法分桶：" + contentHash);
        }
        return Path.of("assets", contentHash.substring(0, 2), contentHash).toString();
    }

    /**
     * 把相对路径解析为绝对路径，并确认结果仍在存储根内。
     *
     * <p>防御性检查：库里的相对路径若被写坏（或被人手工改成 {@code ../../etc/passwd}），
     * 直接拼接会导致任意文件读写。这里在每次解析时都校验一次。</p>
     *
     * @param relative 库中保存的相对路径
     * @return 绝对路径
     * @throws IllegalArgumentException 路径越出存储根
     */
    public Path resolve(String relative) {
        Path resolved = root.resolve(relative).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("素材路径越出存储根：" + relative);
        }
        return resolved;
    }

    /** 该相对路径是否越出存储根（供参数校验直接判定，不抛异常）。 */
    public boolean isInsideRoot(String relative) {
        if (relative == null || relative.isBlank()) {
            return false;
        }
        return root.resolve(relative).normalize().startsWith(root);
    }
}

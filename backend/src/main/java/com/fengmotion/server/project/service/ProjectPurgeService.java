package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectPurgeRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 物理删除项目：删掉项目目录与它在数据库里的从属数据。
 *
 * <p><strong>和归档的区别</strong>：归档只是把项目移出列表，文件与数据都留着；
 * 物理删除是真的删文件，不可撤销。所以这一层要格外小心两件事 ——
 * 删错了路径（把用户整个 home 删掉）和删到一半（数据库清了、目录没删）。</p>
 *
 * <p><strong>先清数据库、再删目录</strong>：文件系统的删除不受事务保护，回滚不了。
 * 反过来的话，数据库一旦失败回滚，就会留下「项目还在列表里、文件却没了」的状态 ——
 * 用户看着自己的项目，点进去却是空的，像是系统弄丢了他的东西。
 * 现在的顺序下，最坏情况只是「数据已删、目录残留」，用户数据不会凭空消失。</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProjectPurgeService {

    private final ProjectPurgeRepository repository;
    private final ProjectDirectoryService directoryService;

    /** 项目目录的根；项目目录必须在这个根下面。 */
    @Value("${fengmotion.workspace-root:${user.home}/FengMotion/projects}")
    private String workspaceRoot;

    /**
     * 物理删除项目。
     *
     * @param id 项目 ID
     * @throws ApiException 项目不存在（404）、仍有任务在跑（409）、路径不安全或文件操作失败（500）
     */
    public void purge(String id) {
        String rootPath = repository.findRootPath(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));

        /* 有任务在跑时不能删：那些任务正在往项目目录里写渲染产物，
           边写边删会得到半截文件，而且任务本身也会失败。 */
        int running = repository.countRunningTasks(id);
        if (running > 0) {
            List<String> labels = repository.findRunningTaskLabels(id);
            throw new ApiException(HttpStatus.CONFLICT, "conflict",
                    "该项目还有 " + running + " 个任务在执行，请等它们结束再删除"
                            + (labels.isEmpty() ? "" : "（" + String.join("、", labels) + "）"));
        }

        Path target = resolveProjectDir(rootPath, id);

        /* 先清数据库并提交，再删目录。
           顺序反过来（先删目录）的话，数据库一旦失败回滚，就会留下
           「项目还在列表里、文件却没了」的状态 —— 用户看着自己的项目，
           点进去却是空的，像是系统弄丢了他的东西。文件系统的删除不受事务
           保护，回滚不了。

           现在的顺序下，最坏情况是「数据已删、目录残留」：项目从列表消失，
           文件还在磁盘上占地方。用户数据不会凭空消失，残留还能手工清。 */
        int deleted = repository.deleteProjectGraph(id);
        if (deleted == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在");
        }

        /* 目录删除失败不推翻已完成的删除：数据确实没了，如实告诉用户
           目录在哪、让他自己清，比让整个操作看起来没发生要好。 */
        try {
            deleteTree(target);
        } catch (ApiException cleanupFailed) {
            log.warn("项目数据已删除，但目录清理失败（{}）：{}", id, target, cleanupFailed);
        }
    }

    /**
     * 解析并校验项目目录。
     *
     * <p><strong>删整个目录的前提是「这个目录确实是这个项目」</strong>。
     * {@code root_path} 是数据库里的一列，历史上可能被手工改过，也可能来自旧版本迁移。
     * 少了这道校验，一条被改成 {@code /home} 或 {@code /} 的记录就能让删除接口
     * 把整个家目录清空 —— 这类操作不设防，等于把「删项目」变成「删任意目录」。</p>
     *
     * <p>两条放行依据，任一成立即可：</p>
     * <ol>
     *   <li>目录里有 {@code project.json} 且其中 ID 与请求一致 —— 目录自证身份，
     *       与它在不在工作区无关（用户可以把项目建在任意位置）。</li>
     *   <li>目录落在工作区根下面 —— 工作区里的目录都是我们自己建的，
     *       没有标记的老项目也照样能删。</li>
     * </ol>
     *
     * @param rootPath 数据库里的目录路径
     * @param id       项目 ID
     * @return 校验通过的绝对路径
     */
    private Path resolveProjectDir(String rootPath, String id) {
        Path target;
        try {
            target = Path.of(rootPath).toAbsolutePath().normalize();
        } catch (RuntimeException invalid) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable",
                    "项目目录路径无效，未删除：" + invalid.getMessage());
        }

        /* 目录已经不在了（用户手工删过）：数据库那边照删，
           否则项目会永远卡在「删不掉」的状态。 */
        if (!Files.exists(target)) {
            return target;
        }

        /* 解析符号链接后再判断：目录若是指向别处的软链，
           真实位置才是要删的东西。按软链路径判断会漏掉这一层。 */
        Path real;
        try {
            real = target.toRealPath();
        } catch (IOException unreadable) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable",
                    "无法读取项目目录，未删除：" + unreadable.getMessage());
        }

        String markerId = directoryService.readIdentity(real).orElse(null);
        if (id.equals(markerId)) {
            return real;
        }

        Path root;
        try {
            root = Path.of(workspaceRoot).toAbsolutePath().normalize();
        } catch (RuntimeException invalidRoot) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable",
                    "工作区路径无效，未删除");
        }
        if (real.startsWith(root) && !real.equals(root)) {
            return real;
        }

        throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                "项目目录与该项目的身份标记不匹配，已拒绝删除");
    }

    /**
     * 递归删除目录。
     *
     * <p>不跟随符号链接：目录里可能有指向外部的大目录，删项目不该顺着它把
     * 别处的文件带走。</p>
     *
     * @param dir 目录
     */
    private void deleteTree(Path dir) {
        if (!Files.exists(dir)) return;
        try {
            Files.walkFileTree(dir, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.deleteIfExists(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path d, IOException exc) throws IOException {
                    if (exc != null) throw exc;
                    Files.deleteIfExists(d);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException failed) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable",
                    "删除项目目录失败：" + failed.getMessage() + "（数据未删除，可重试）");
        }
    }

    /**
     * 删除数据库里的项目及从属数据。
     *
     * <p>事务边界在存储层实现里：那里是 {@code public} 方法，Spring 代理才拦得住
     * （同类内部调用不经过代理，{@code @Transactional} 会静默失效）。</p>
     *
     * @param id 项目 ID
     * @return 删除的项目行数
     */
}

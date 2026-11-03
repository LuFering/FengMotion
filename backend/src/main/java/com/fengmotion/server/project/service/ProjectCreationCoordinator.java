package com.fengmotion.server.project.service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.api.dto.CreateProjectRequest;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectIdempotencyRepository;
import com.fengmotion.server.project.store.ProjectIdempotencyRepository.IdempotencyRecord;

import lombok.RequiredArgsConstructor;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 协调项目创建、数据库事务和幂等记录。
 *
 * <p>幂等用于处理同一次创建请求的重试：24 小时内，相同键和相同请求会找到已有项目，
 * 相同键但请求内容不同时返回冲突。文件目录不属于数据库事务，失败时需单独尝试清理。</p>
 */
@Service
@RequiredArgsConstructor 
public class ProjectCreationCoordinator {
    private final ProjectService service; // 校验请求、创建目录并保存项目
    private final ProjectRepository repository; // 幂等重试时读取已创建的项目
    private final ProjectDirectoryService directories; // 事务失败后清理空目录
    private final ProjectIdempotencyRepository idempotencyRepository; // 读写幂等记录
    private final TransactionTemplate transactions; // 显式执行数据库事务
    private final ObjectMapper mapper; // 将请求转换为 JSON，以计算请求摘要

    /**
     * 创建项目；有效幂等键对应的相同请求会返回之前创建的项目。
     *
     * @param request 项目创建参数
     * @param key 可选的幂等键；同一次操作的重试需要复用该键
     * @return 新创建的项目，或幂等记录关联的现有项目
     * @throws ApiException 幂等键无效、请求冲突或项目创建失败时抛出
     */
    // synchronized 使同一协调器实例内的创建请求串行执行。Java对象锁
    public synchronized Project create(CreateProjectRequest request, String key) {

        if (key != null && (key.isBlank() || key.length() > 255)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "幂等键无效");
        }
        // 没有幂等键时不需要计算摘要；摘要用于比较两次请求的内容。
        String hash = key == null ? null : fingerprint(request);
        // Lambda 内要记录新项目，供事务执行或提交失败时在外层清理目录。
        Project[] created = new Project[1];
        try {//事务要保证的是：项目记录和幂等记录这两部分数据库操作，应当一起成功或一起回滚。
            return transactions.execute(status -> {
                // 在读取幂等记录前取得写入资格，协调并发创建。
                idempotencyRepository.acquireWriteLock();
                if (key != null) {
                    var existing = idempotencyRepository.findByKey(key);
                    if (existing.isPresent()) {
                        IdempotencyRecord stored = existing.get();
                        // 未过 24 小时的记录用于判断重试；过期后允许重新使用该键。
                        if (stored.createdAt().plusSeconds(86400).isAfter(Instant.now())) {
                            if (!stored.requestHash().equals(hash)) {
                                throw new ApiException(HttpStatus.CONFLICT, "idempotency_conflict", "幂等键已用于不同请求");
                            }
                            // 返回数据库中当前的项目数据，不会再次创建目录。
                            return repository.findById(stored.projectId()).orElseThrow(() ->
                                    new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "幂等记录关联的项目不存在"));
                        }
                        idempotencyRepository.delete(key);
                    }
                }
                // 项目记录与幂等记录在同一个数据库事务中提交。
                Project project = service.create(request);
                created[0] = project;
                if (key != null) { // 保存幂等键与项目 ID 的关联
                    idempotencyRepository.save(key, hash, project.id(), Instant.now());
                }
                return project;
            });
        } catch (RuntimeException ex) {
            // 数据库事务回滚不会撤销文件操作；仅清理本次创建的空目录。
            if (created[0] != null) {
                try {
                    directories.deleteEmpty(Path.of(created[0].rootPath()));
                } catch (IOException cleanup) {
                    // 保留原始异常，同时附带清理失败的原因供排查。
                    ex.addSuppressed(cleanup);
                }
            }
            throw ex;
        }
    }

    /** 将请求序列化后计算 SHA-256 摘要，用于判断重试的请求内容是否一致。 */
    private String fingerprint(CreateProjectRequest request) {
        try {
            byte[] json = mapper.writeValueAsString(request).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json));
        } catch (IOException | NoSuchAlgorithmException ex) {
            throw new IllegalStateException("无法计算请求摘要", ex);
        }
    }

}

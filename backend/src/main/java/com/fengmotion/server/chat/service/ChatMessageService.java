package com.fengmotion.server.chat.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.api.dto.CreateChatMessageRequest;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageIdempotencyRepository;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.Pagination;

import lombok.RequiredArgsConstructor;

/**
 * 会话消息的读取与发送。
 *
 * <p>消息只追加、不原地修改（参考 dsh 会话日志的 append-only 约定）：
 * 一次发送要么落一条完整消息，要么什么都不留下；失败时不会留下半截内容。
 * 序号由存储层在写锁下分配，翻页按序号做键集分页，新消息不断追加也不会让
 * 已发出的游标漂移。</p>
 *
 * <p>发送支持 {@code Idempotency-Key}：24 小时内同键同内容返回首次写入的那条消息，
 * 同键不同内容返回 409。键与请求摘要、消息 ID 一起提交，重试不会写出第二条消息。</p>
 */
@Service
@RequiredArgsConstructor
public class ChatMessageService {
    /** 幂等记录有效期：与项目创建保持一致。 */
    private static final long IDEMPOTENCY_TTL_SECONDS = 86400;
    /** 单条消息正文上限；远超正常需求，用于拦住误粘贴的整份文件。 */
    private static final int MAX_TEXT_LENGTH = 20_000;
    /** 合同允许的引用角色（agent.md §3）。 */
    private static final Set<String> REFERENCE_ROLES = Set.of("target", "context");

    private final ChatSessionRepository sessions;
    private final ChatMessageRepository messages;
    private final ChatMessageIdempotencyRepository idempotency;
    private final ObjectMapper json;

    /**
     * 按时间正序分页读取会话历史。
     *
     * @param sessionId 会话 ID
     * @param cursor    上一页返回的游标；首次查询可不传
     * @param limit     每页数量，范围为 1 至 200
     * @return 当前页消息及下一页游标
     * @throws ApiException 会话不存在时 404；分页参数无效时 400
     */
    public Page list(String sessionId, String cursor, int limit) {
        requireActiveSession(sessionId);
        Pagination.requireValidLimit(limit, "消息查询参数无效");
        long afterSeq = Pagination.decodeCursor(cursor, "消息查询参数无效");

        // 多取一条判断是否还有下一页，避免额外的 count 查询。
        List<ChatMessage> rows = messages.findAfterSeq(sessionId, afterSeq, limit + 1);
        boolean more = rows.size() > limit;
        // 游标是本页最后一条消息的序号：下一页从它的下一条开始。
        String next = more ? Pagination.encodeCursor(rows.get(limit - 1).seq()) : null;
        return new Page(more ? rows.subList(0, limit) : rows, next);
    }

    /**
     * 发送一条用户消息。
     *
     * <p>任务域尚未接入，因此响应中不会出现 {@code taskId}；这一层只保证消息本身
     * 真实落库或明确失败，不假装已经发出、也不在这里生成助手回复。</p>
     *
     * @param sessionId      会话 ID
     * @param request        消息正文、引用、附件与约束
     * @param idempotencyKey 可选的幂等键；同一次发送的重试必须复用该键
     * @return 已保存的消息
     * @throws ApiException 会话不存在 404；参数无效 400；幂等键内容冲突 409
     */
    @Transactional
    public Sent send(String sessionId, CreateChatMessageRequest request, String idempotencyKey) {
        // 先做不访问数据库的校验，避免无效请求也去抢写锁。
        validateKey(idempotencyKey);
        ValidatedMessage validated = validate(request);

        String hash = idempotencyKey == null ? null : fingerprint(sessionId, request);

        // 「读最大序号 + 插入」是读-改-写，先请求写锁再读任何表。
        // 顺序不能反：若事务的第一条 SQL 是 SELECT，SQLite 会先进入读事务，
        // 之后升级为写事务时更容易在并发下直接失败，而不是按 busy timeout 等待。
        messages.acquireWriteLock();
        requireActiveSession(sessionId);

        if (idempotencyKey != null) {
            var existing = idempotency.findByKey(idempotencyKey);
            if (existing.isPresent()) {
                var stored = existing.get();
                if (stored.createdAt().plusSeconds(IDEMPOTENCY_TTL_SECONDS).isAfter(Instant.now())) {
                    if (!stored.requestHash().equals(hash)) {
                        throw new ApiException(HttpStatus.CONFLICT, "idempotency_conflict",
                                "幂等键已用于不同请求");
                    }
                    // 消息不可变，直接返回首次写入的那条，不再分配新序号。
                    ChatMessage saved = messages.findById(stored.messageId())
                            .orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,
                                    "internal_error", "幂等记录关联的消息不存在"));
                    return new Sent(saved, null);
                }
                // 过期键允许重新使用。
                idempotency.delete(idempotencyKey);
            }
        }

        Instant now = Instant.now();
        ChatMessage saved = messages.append(new ChatMessage(
                UUID.randomUUID().toString(),
                sessionId,
                0, // 序号由存储层分配
                ChatMessage.ROLE_USER,
                validated.text(),
                null,
                validated.references(),
                validated.attachments(),
                null, // 用户消息不产生工具调用
                now));

        if (idempotencyKey != null) {
            idempotency.save(idempotencyKey, hash, sessionId, saved.id(), now);
        }
        // 会话按最近活动排序：有消息写入就刷新更新时间。
        sessions.touch(sessionId, now);
        return new Sent(saved, null);
    }

    /**
     * 校验请求内容：空文本必须有附件，引用至多一个 target。
     */
    private ValidatedMessage validate(CreateChatMessageRequest request) {
        String text = request.text() == null ? "" : request.text();
        JsonNode references = request.references();
        JsonNode attachments = request.attachments();

        validateArray(references, "references");
        validateArray(attachments, "attachments");

        boolean hasAttachments = attachments != null && !attachments.isEmpty();
        if (text.isBlank() && !hasAttachments) {
            throw invalid("消息内容为空：请写一句要求，或带上附件");
        }
        if (text.length() > MAX_TEXT_LENGTH) {
            throw invalid("消息内容过长");
        }

        int targets = 0;
        if (references != null) {
            for (JsonNode reference : references) {
                if (!reference.isObject()) {
                    throw invalid("结构化引用格式无效");
                }
                JsonNode role = reference.get("role");
                if (role == null || !role.isTextual() || !REFERENCE_ROLES.contains(role.asText())) {
                    throw invalid("结构化引用的 role 无效");
                }
                if ("target".equals(role.asText())) {
                    targets++;
                }
            }
        }
        // agent.md §3：一条消息至多一个 target 引用，多个目标无法确定改哪里。
        if (targets > 1) {
            throw invalid("一条消息最多只能指定一个 target 引用");
        }
        return new ValidatedMessage(text, references, attachments);
    }

    /** 可选字段出现时必须是数组；类型错误属于客户端问题，按 400 处理而不是静默忽略。 */
    private void validateArray(JsonNode node, String field) {
        if (node != null && !node.isNull() && !node.isArray()) {
            throw invalid(field + " 必须是数组");
        }
    }

    /** 幂等键规则与项目创建一致：非空且不超过 255 个字符。 */
    private void validateKey(String key) {
        if (key != null && (key.isBlank() || key.length() > 255)) {
            throw invalid("幂等键无效");
        }
    }

    /** 请求摘要绑定会话 ID：同一把键换到别的会话重放同样视为冲突。 */
    private String fingerprint(String sessionId, CreateChatMessageRequest request) {
        Map<String, Object> canonical = new java.util.LinkedHashMap<>();
        canonical.put("sessionId", sessionId);
        canonical.put("text", request.text());
        canonical.put("references", request.references());
        canonical.put("attachments", request.attachments());
        canonical.put("constraints", request.constraints());
        try {
            byte[] bytes = json.writeValueAsString(canonical).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException ex) {
            throw new IllegalStateException("无法计算消息请求摘要", ex);
        }
    }

    /** 会话必须存在且未删除；消息接口不挂在项目路径下，因此按会话直接判断。 */
    private ChatSession requireActiveSession(String sessionId) {
        return sessions.findById(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "会话不存在"));
    }

    private ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", message);
    }

    /**
     * 发送成功的结果。
     *
     * @param message 已保存的消息
     * @param taskId  该消息触发的任务；任务域接入前恒为 null
     */
    public record Sent(ChatMessage message, String taskId) {
    }

    /**
     * 一页消息查询结果。
     *
     * @param items      当前页消息，按时间正序
     * @param nextCursor 下一页游标；没有更多结果时为 null
     */
    public record Page(List<ChatMessage> items, String nextCursor) {
    }

    /** 校验通过后的消息内容。 */
    private record ValidatedMessage(String text, JsonNode references, JsonNode attachments) {
    }
}

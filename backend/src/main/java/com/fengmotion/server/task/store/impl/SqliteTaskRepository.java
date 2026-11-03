package com.fengmotion.server.task.store.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;
import com.fengmotion.server.task.store.TaskRepository;
import com.fengmotion.server.task.store.mapper.TaskEventRow;
import com.fengmotion.server.task.store.mapper.TaskMapper;
import com.fengmotion.server.task.store.mapper.TaskRow;

import lombok.RequiredArgsConstructor;

/**
 * 任务持久化的 MyBatis 实现。
 *
 * <p>事件序号用「读 MAX(seq) + 1」分配，并在同一事务内先取写锁 ——
 * 与消息表同样的做法，理由见 {@code SqliteChatMessageRepository}。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteTaskRepository implements TaskRepository {

    private final TaskMapper mapper;
    private final ObjectMapper json;

    @Override
    public void save(Task task) {
        TaskRow row = new TaskRow();
        row.setId(task.id());
        row.setProjectId(task.projectId());
        row.setKind(task.kind());
        row.setStatus(task.status());
        row.setPrompt(task.prompt());
        row.setRequestJson(toJson(task.request()));
        row.setProgress(task.progress());
        row.setMessage(task.message());
        row.setArtifactPath(task.artifactPath());
        row.setErrorCode(task.errorCode());
        row.setCreatedAt(task.createdAt().toString());
        row.setUpdatedAt(task.updatedAt().toString());
        row.setFinishedAt(task.finishedAt() == null ? null : task.finishedAt().toString());
        row.setBaseVersion(task.baseVersion());
        row.setResultVersion(task.resultVersion());
        mapper.insert(row);
    }

    @Override
    public Optional<Task> findById(String id) {
        return Optional.ofNullable(mapper.findById(id)).map(this::toDomain);
    }

    @Override
    public List<Task> listByProject(String projectId, int limit) {
        return mapper.listByProject(projectId, limit).stream().map(this::toDomain).toList();
    }

    @Override
    public boolean updateProgress(String id, String status, int progress, String message,
                                  String artifactPath, String errorCode, boolean finished) {
        Instant now = Instant.now();
        int changed = mapper.updateProgress(id, status, progress, message, artifactPath, errorCode,
                now.toString(), finished ? now.toString() : null);
        return changed > 0;
    }

    @Override
    public boolean cancel(String id, String message) {
        return mapper.markCancelled(id, Instant.now().toString(), message) > 0;
    }

    @Override
    public void updateVersions(String taskId, Long baseVersion, Long resultVersion) {
        mapper.updateVersions(taskId, baseVersion, resultVersion);
    }

    @Override
    public TaskEvent appendEvent(TaskEvent event) {
        // 先碰一次 tasks 行，在事务内请求写锁；再读最大序号，两个并发追加才不会撞号
        mapper.acquireWriteLock(event.taskId());
        Long max = mapper.findMaxEventSeq(event.taskId());
        long seq = (max == null ? 0 : max) + 1;

        TaskEventRow row = new TaskEventRow();
        row.setId(event.id() == null ? UUID.randomUUID().toString() : event.id());
        row.setTaskId(event.taskId());
        row.setSeq(seq);
        row.setKind(event.kind());
        row.setStatus(event.status());
        row.setMessage(event.message());
        row.setDataJson(toJson(event.data()));
        row.setAt(event.at().toString());
        mapper.insertEvent(row);

        return new TaskEvent(row.getId(), event.taskId(), seq, event.kind(), event.status(),
                event.message(), event.data(), event.at());
    }

    @Override
    public List<TaskEvent> findEventsAfter(String taskId, long afterSeq) {
        return mapper.findEventsAfter(taskId, afterSeq).stream().map(this::toEventDomain).toList();
    }

    /**
     * JSON 树转文本；空树存 NULL 而不是字符串 "null"。
     *
     * @param node JSON 树
     * @return 文本；无内容时为 null
     */
    private String toJson(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        try {
            return json.writeValueAsString(node);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("无法序列化任务附加字段", failure);
        }
    }

    /**
     * 文本还原为 JSON 树。
     *
     * @param text JSON 文本
     * @return JSON 树；入参为 null 时返回 null
     */
    private JsonNode fromJson(String text) {
        if (text == null) {
            return null;
        }
        try {
            return json.readTree(text);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("无法解析任务附加字段", failure);
        }
    }

    private Task toDomain(TaskRow row) {
        return new Task(
                row.getId(),
                row.getProjectId(),
                row.getKind(),
                row.getStatus(),
                row.getPrompt(),
                fromJson(row.getRequestJson()),
                row.getProgress() == null ? 0 : row.getProgress(),
                row.getMessage() == null ? "" : row.getMessage(),
                row.getArtifactPath(),
                row.getErrorCode(),
                Instant.parse(row.getCreatedAt()),
                Instant.parse(row.getUpdatedAt()),
                row.getFinishedAt() == null ? null : Instant.parse(row.getFinishedAt()),
                row.getBaseVersion(),
                row.getResultVersion());
    }

    private TaskEvent toEventDomain(TaskEventRow row) {
        return new TaskEvent(
                row.getId(),
                row.getTaskId(),
                row.getSeq() == null ? 0 : row.getSeq(),
                row.getKind(),
                row.getStatus(),
                row.getMessage() == null ? "" : row.getMessage(),
                fromJson(row.getDataJson()),
                Instant.parse(row.getAt()));
    }
}

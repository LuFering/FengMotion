package com.fengmotion.server.task.service;

import java.time.Instant;
import java.util.UUID;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;
import com.fengmotion.server.task.store.TaskRepository;
import com.fengmotion.server.task.store.mapper.TaskMapper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/** 将能确认执行进程已退出的遗留任务收尾，不判断身份未知的任务。 */
@Component
@RequiredArgsConstructor
@Slf4j
public class TaskRecovery {
    private static final String MESSAGE = "执行进程已退出，任务未能正常结束；请检查场景版本和产物。";
    private final TaskMapper mapper;
    private final TaskRepository tasks;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    @EventListener(ApplicationReadyEvent.class)
    public void recover() {
        ExecutionOwner.current().ifPresent(local -> {
            for (var row : mapper.findOwnedUnfinished()) {
                var owner = ExecutionOwner.decode(row.getExecutionOwner());
                if (owner.isEmpty() || !owner.get().definitelyStoppedComparedTo(local)) continue;
                transactions.executeWithoutResult(status -> {
                    Instant now = Instant.now();
                    if (mapper.markInterrupted(row.getId(), row.getExecutionOwner(), MESSAGE, now.toString()) == 0) return;
                    Task recovered = tasks.findById(row.getId()).orElseThrow();
                    ObjectNode data = json.createObjectNode().put("errorCode", "service_interrupted");
                    if (recovered.artifactPath() != null) data.put("artifactPath", recovered.artifactPath());
                    if (recovered.resultVersion() != null) {
                        data.put("resultVersion", recovered.resultVersion());
                        data.put("artifactApplied", true);
                    }
                    tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), row.getId(), 0,
                            TaskEvent.KIND_ERROR, Task.STATUS_FAILED, MESSAGE, data, now));
                    log.info("已收尾执行进程退出的任务 {}", row.getId());
                });
            }
        });
    }
}

package com.fengmotion.server.project.service;

import java.util.Set;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

/** 同进程内串行化同一项目的源码创作、渲染与恢复。 */
@Component
public class ProjectOperationLock implements com.fengmotion.server.common.ProjectActivityGate {
    private final Set<String> busy = ConcurrentHashMap.newKeySet();
    private final Set<String> deleting = ConcurrentHashMap.newKeySet();
    private final Map<String, Integer> activities = new HashMap<>();

    public synchronized void acquire(String projectId) {
        requireAvailable(projectId);
        if (!busy.add(projectId)) throw new ApiException(HttpStatus.CONFLICT, "project_busy",
                "这个项目正在创作、渲染或恢复，请等本轮结束后再提交");
    }

    public void release(String projectId) { busy.remove(projectId); }
    public boolean isBusy(String projectId) { return busy.contains(projectId); }

    public synchronized Lease participate(String projectId) {
        if (projectId == null || projectId.isBlank()) return new Lease(null, false);
        requireAvailable(projectId);
        activities.merge(projectId, 1, Integer::sum);
        return new Lease(projectId, false);
    }

    public synchronized Lease beginDeletion(String projectId) {
        requireAvailable(projectId);
        if (busy.contains(projectId) || activities.containsKey(projectId)) {
            throw new ApiException(HttpStatus.CONFLICT, "project_busy",
                    "项目仍有创作、聊天、出片或预览占用，请等任务退出并关闭实时预览后再删除");
        }
        deleting.add(projectId);
        return new Lease(projectId, true);
    }

    private void requireAvailable(String projectId) {
        if (deleting.contains(projectId)) throw new ApiException(HttpStatus.CONFLICT, "project_deleting", "项目正在删除，请稍后重新读取项目列表");
    }

    public final class Lease implements com.fengmotion.server.common.ProjectActivityGate.Scope {
        private final String projectId;
        private final boolean deletion;
        private boolean closed;

        private Lease(String projectId, boolean deletion) {
            this.projectId = projectId;
            this.deletion = deletion;
        }

        @Override public void close() {
            synchronized (ProjectOperationLock.this) {
                if (closed || projectId == null) return;
                closed = true;
                if (deletion) deleting.remove(projectId);
                else activities.computeIfPresent(projectId, (key, count) -> count == 1 ? null : count - 1);
            }
        }
    }
}

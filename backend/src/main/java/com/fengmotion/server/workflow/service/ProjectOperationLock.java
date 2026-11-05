package com.fengmotion.server.workflow.service;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

/** 同进程内串行化同一项目的源码创作、渲染与恢复。 */
@Component
public class ProjectOperationLock {
    private final Set<String> busy = ConcurrentHashMap.newKeySet();

    public void acquire(String projectId) {
        if (!busy.add(projectId)) throw new ApiException(HttpStatus.CONFLICT, "project_busy",
                "这个项目正在创作、渲染或恢复，请等本轮结束后再提交");
    }

    public void release(String projectId) { busy.remove(projectId); }
    public boolean isBusy(String projectId) { return busy.contains(projectId); }
}

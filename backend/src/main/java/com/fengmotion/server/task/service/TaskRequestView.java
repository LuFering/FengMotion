package com.fengmotion.server.task.service;

import java.util.List;

import com.fengmotion.server.task.domain.TaskRequest;
import com.fengmotion.server.task.domain.TaskScope;

/**
 * 修改执行流程看到的请求视图。
 *
 * <p>为什么不直接把 {@link TaskRequest} 传给执行器：执行器只该看到
 * 「已经通过支持矩阵校验、语义明确」的那部分。用一个窄视图，
 * 可以在编译期就挡住「执行器去读 {@code attachments}」这类越界访问，
 * 也方便将来加字段时区分「记录档」与「解释档」。</p>
 *
 * @param prompt      用户原话
 * @param scope       范围
 * @param references  目标与参考
 * @param constraints 约束
 */
public record TaskRequestView(
        String prompt,
        TaskScope scope,
        List<TaskRequest.Reference> references,
        TaskRequest.Constraints constraints) {

    /**
     * 由已校验的请求构造。
     *
     * @param request 原始请求
     * @return 视图
     */
    public static TaskRequestView of(TaskRequest request) {
        return new TaskRequestView(request.prompt(), request.scope(),
                request.references() == null ? List.of() : List.copyOf(request.references()),
                request.constraints() == null ? new TaskRequest.Constraints(null, null, null, null, null)
                        : request.constraints());
    }

    /**
     * 是否为「只改选区」。
     *
     * @return limitToSelection 为 true 时返回 true
     */
    public boolean limitedToSelection() {
        return Boolean.TRUE.equals(constraints.limitToSelection());
    }

    /**
     * 是否必须保持选区外不变。
     *
     * @return preserveOutsideSelection 为 true 时返回 true
     */
    public boolean preserveOutsideSelection() {
        return Boolean.TRUE.equals(constraints.preserveOutsideSelection());
    }
}

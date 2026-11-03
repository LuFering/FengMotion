package com.fengmotion.server.task.service;

import java.util.List;

/**
 * 修改流程的四个阶段。
 *
 * <p>每个阶段职责固定，不允许互相兼任 —— 尤其不允许「生成即落盘」。
 * 分开是为了让「AI 给了什么」「校验通过了什么」「最终写了什么」三件事
 * 各有唯一归属，出问题时能定位到具体阶段。</p>
 *
 * <p>实现类必须：每阶段检查取消；每阶段发进度事件；
 * <strong>校验通过之前不写回项目场景</strong>（失败时原片必须保持可用）。</p>
 */
public interface ModifyExecutor {

    /**
     * ① 解析修改范围。
     *
     * <p>把 {@code scope} + {@code references} + {@code constraints} 解析成
     * 「哪些场景可以改」。解析不出明确范围就失败，不猜用户意图。</p>
     *
     * @param request 用户修改意图
     * @param film    当前场景基线
     * @return 可修改的场景 ID 集合
     * @throws com.fengmotion.server.common.ApiException 范围不合法
     */
    ResolvedScope resolve(TaskRequestView request, com.fasterxml.jackson.databind.JsonNode film);

    /**
     * ② 读取当前场景。
     *
     * <p>第一版基线由请求携带（见文档 §5），实现类只做读取与结构校验。
     * 将来场景有权威存储时，这里换成从项目目录读，调用方不用改。</p>
     *
     * @param request 用户修改意图
     * @return 当前场景基线
     * @throws com.fengmotion.server.common.ApiException 读不到
     */
    com.fasterxml.jackson.databind.JsonNode load(TaskRequestView request);

    /**
     * ③ 生成修改方案。
     *
     * <p>把「当前场景 + 用户原话 + 修改范围」交给模型，要求产出结构化方案，
     * 不是整份 scenes。</p>
     *
     * @param request 用户修改意图
     * @param film    当前场景基线
     * @param scope   ① 的结果
     * @param progress 进度通道
     * @return 修改方案
     * @throws Exception 模型调用失败
     */
    ModifyPlan generate(TaskRequestView request, com.fasterxml.jackson.databind.JsonNode film,
                        ResolvedScope scope, TaskService.Progress progress) throws Exception;

    /**
     * ④ 校验并应用。
     *
     * <p>逐条检查：场景在可改集合内、字段在白名单内、{@code from} 与实际值一致、
     * 应用后仍满足 {@code preserveOutsideSelection}。任一不通过则整份方案拒绝，
     * 原片不动。</p>
     *
     * @param plan 修改方案
     * @param film 当前场景基线
     * @param scope ① 的结果
     * @return 应用后的新场景数据
     * @throws com.fengmotion.server.common.ApiException 方案不合法
     */
    com.fasterxml.jackson.databind.JsonNode apply(ModifyPlan plan, com.fasterxml.jackson.databind.JsonNode film,
                                                 ResolvedScope scope);

    /**
     * 解析结果：可改与不可改的边界。
     *
     * @param editableSceneIds   允许修改的场景
     * @param preservedSceneIds  必须原样保留的场景
     */
    record ResolvedScope(List<String> editableSceneIds, List<String> preservedSceneIds) {
    }
}

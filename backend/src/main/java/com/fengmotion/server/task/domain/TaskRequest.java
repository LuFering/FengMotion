package com.fengmotion.server.task.domain;

import java.util.List;

/**
 * 制作任务请求：前端 {@code TaskRequest} 的服务端形态。
 *
 * <p>它表达的是<strong>用户的修改意图</strong>（改哪里、参考什么、保留什么），
 * 不是渲染数据。不要把它直接当成 Remotion 的 props 用 ——
 * 它里面没有被修改对象的任何内容，必须经过修改执行流程
 * （解析 → 读取 → 生成 → 校验）才能得到新的 {@code film.scenes}。
 * 详见 {@code docs/任务请求契约与修改执行流程.md}。</p>
 *
 * <p>{@code attachments}、{@code feedbackId}、{@code creativeBrief} 等属于
 * 「记录档」字段：随任务原样落库留痕，但不参与执行。
 * 分档规则见文档 §3.2。</p>
 *
 * @param kind            任务类型
 * @param prompt          用户原话
 * @param scope           修改范围
 * @param sceneIds        scope=scene 时的目标场景
 * @param references      目标与参考（多态，服务端按 role/kind 解释）
 * @param constraints     修改约束
 * @param attachments     附件元信息（只存不解释）
 * @param feedbackId      来源评审条目（记录）
 * @param workflowId      来源工作流（记录）
 * @param film            当前场景基线；modify 需要，render 不需要
 */
public record TaskRequest(
        TaskKind kind,
        String prompt,
        TaskScope scope,
        List<String> sceneIds,
        List<Reference> references,
        Constraints constraints,
        List<Attachment> attachments,
        String feedbackId,
        String workflowId,
        com.fasterxml.jackson.databind.JsonNode film) {

    /**
     * 一条引用：目标或上下文。
     *
     * <p>多态结构 —— {@code kind} 决定哪些字段有意义，其余为 null。
     * 服务端只按契约解释，不猜测缺失字段。</p>
     *
     * @param id         引用 ID
     * @param role       target（要改的）/ context（仅作参考）
     * @param kind       project / shot / frame / range / region / artifact / scene / preview
     * @param sceneId    kind=scene 或 preview 时定位的场景
     * @param projectId  kind=project 时的项目
     * @param shotId     kind=shot/frame/range/region 时的镜头
     * @param artifactId kind=artifact 时的产物
     * @param version    kind=artifact 时的版本
     * @param frame      kind=frame/region 时的帧号
     * @param startFrame kind=range 的起始帧
     * @param endFrame   kind=range 的结束帧
     * @param timeSeconds kind=preview 的时间位置
     * @param bbox       kind=region/preview 的选框
     * @param label      人可读名字
     */
    public record Reference(
            String id,
            String role,
            String kind,
            String sceneId,
            String projectId,
            String shotId,
            String artifactId,
            String version,
            Integer frame,
            Integer startFrame,
            Integer endFrame,
            Double timeSeconds,
            Bbox bbox,
            String label) {

        /** 目标：本次修改要动它。 */
        public static final String ROLE_TARGET = "target";
        /** 上下文：只作参考，不能被改。 */
        public static final String ROLE_CONTEXT = "context";
    }

    /**
     * 归一化选框。坐标单位为相对画面的比例（0~1），
     * 这样不同分辨率下解释一致。
     *
     * @param x 左
     * @param y 上
     * @param w 宽
     * @param h 高
     */
    public record Bbox(double x, double y, double w, double h) {
    }

    /**
     * 修改约束。
     *
     * <p>分三档（文档 §3.3）：{@code limitToSelection} 与
     * {@code preserveOutsideSelection} 第一版<strong>真正执行</strong>；
     * 其余三项第一版只记录，执行时会在任务事件里显式声明未生效 ——
     * 不能让用户以为勾了就生效了。</p>
     *
     * @param preserveCamera           记录档（未生效）
     * @param preserveCaptions         记录档（未生效）
     * @param limitToSelection         解释档：可改范围限制在 references 内
     * @param preserveOutsideSelection 解释档：结果不得越出选区
     * @param reuseExistingComponents  记录档（未生效）
     */
    public record Constraints(
            Boolean preserveCamera,
            Boolean preserveCaptions,
            Boolean limitToSelection,
            Boolean preserveOutsideSelection,
            Boolean reuseExistingComponents) {

        /**
         * 第一版尚未实现的约束项（用于生成警告事件）。
         *
         * @return 被用户设置为 true 但不会生效的约束名
         */
        public List<String> unenforced() {
            List<String> names = new java.util.ArrayList<>();
            if (Boolean.TRUE.equals(preserveCamera)) {
                names.add("preserveCamera");
            }
            if (Boolean.TRUE.equals(preserveCaptions)) {
                names.add("preserveCaptions");
            }
            if (Boolean.TRUE.equals(reuseExistingComponents)) {
                names.add("reuseExistingComponents");
            }
            return List.copyOf(names);
        }
    }

    /**
     * 附件元信息。第一版只记录，不读取内容。
     *
     * @param name 文件名
     * @param type MIME
     * @param size 字节数
     */
    public record Attachment(String name, String type, long size) {
    }
}

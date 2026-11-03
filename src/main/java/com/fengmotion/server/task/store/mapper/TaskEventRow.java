package com.fengmotion.server.task.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * task_events 表的一行原始数据。
 */
@Data
@NoArgsConstructor
public class TaskEventRow {
    private String id;
    private String taskId;
    private Long seq;
    private String kind;
    private String status;
    private String message;
    /** 附加信息的 JSON 文本；没有时为 null。 */
    private String dataJson;
    private String at;
}

package com.fengmotion.server.preset.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.WorkflowPreset;

/** 视频类型（工作流预设）的数据访问接口。 */
public interface WorkflowPresetRepository {
    void save(WorkflowPreset preset);

    Optional<WorkflowPreset> findById(String id);

    /** status 为 null 时返回全部。 */
    List<WorkflowPreset> find(String status);

    /** 仅当状态仍为 expected 时替换映射；返回是否更新成功。 */
    boolean updateMapping(String id, String expected, PresetMapping mapping, Instant at);

    /** 仅当状态仍为 expected 时改状态；返回是否更新成功。 */
    boolean updateStatus(String id, String expected, String status, Instant at, Instant activatedAt);
}

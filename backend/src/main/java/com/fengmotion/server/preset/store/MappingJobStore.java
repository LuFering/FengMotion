package com.fengmotion.server.preset.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CancellationException;
import java.util.function.UnaryOperator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.preset.domain.MappingJob;
import lombok.RequiredArgsConstructor;

@Repository
@RequiredArgsConstructor
public class MappingJobStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public void insert(MappingJob job) {
        jdbc.update("INSERT INTO preset_mapping_jobs VALUES (?, ?, ?, ?, ?, ?)", job.id(),
                job.skillPackageId(), job.skillPath(), job.status(), encode(job), Instant.now().toString());
    }

    public Optional<MappingJob> find(String id) {
        return jdbc.query("SELECT job_json FROM preset_mapping_jobs WHERE id = ?",
                (row, index) -> decode(row.getString(1)), id).stream().findFirst();
    }

    public Optional<MappingJob> active(String packageId, String path) {
        return jdbc.query("SELECT job_json FROM preset_mapping_jobs WHERE skill_package_id = ? AND skill_path = ? AND status IN ('queued', 'running')",
                (row, index) -> decode(row.getString(1)), packageId, path).stream().findFirst();
    }

    public List<MappingJob> list(String packageId, boolean activeOnly) {
        return jdbc.query("SELECT job_json FROM preset_mapping_jobs WHERE skill_package_id = ?"
                        + (activeOnly ? " AND status IN ('queued', 'running')" : "") + " ORDER BY created_at DESC, id",
                (row, index) -> decode(row.getString(1)), packageId);
    }

    public List<MappingJob> unfinished() {
        return jdbc.query("SELECT job_json FROM preset_mapping_jobs WHERE status IN ('queued', 'running')",
                (row, index) -> decode(row.getString(1)));
    }

    /** 删掉创建时间早于 {@code cutoff} 的已结束作业；未结束的作业不动。返回删除条数。 */
    public int purgeFinishedBefore(Instant cutoff) {
        return jdbc.update("DELETE FROM preset_mapping_jobs WHERE status NOT IN ('queued', 'running') AND created_at < ?",
                cutoff.toString());
    }

    public MappingJob update(String id, UnaryOperator<MappingJob> change) {
        MappingJob current = find(id).orElseThrow();
        if (current.terminal()) return current;
        MappingJob next = change.apply(current);
        int written = jdbc.update("UPDATE preset_mapping_jobs SET status = ?, job_json = ? WHERE id = ? AND status = ?",
                next.status(), encode(next), id, current.status());
        return written == 1 ? next : find(id).orElseThrow();
    }

    @Transactional
    public void complete(String id, String presetId, Runnable persistPreset) {
        MappingJob current = find(id).orElseThrow();
        if (current.terminal()) throw new CancellationException("作业已结束");
        MappingJob next = current.finish("succeeded", presetId, null, Instant.now());
        if (jdbc.update("UPDATE preset_mapping_jobs SET status = ?, job_json = ? WHERE id = ? AND status IN ('queued', 'running')",
                next.status(), encode(next), id) != 1) throw new CancellationException("作业已结束");
        persistPreset.run();
    }

    private String encode(MappingJob job) {
        try { return json.writeValueAsString(job); }
        catch (JsonProcessingException failure) { throw new IllegalStateException("无法保存生成作业", failure); }
    }

    private MappingJob decode(String value) {
        try { return json.readValue(value, MappingJob.class); }
        catch (JsonProcessingException failure) { throw new IllegalStateException("生成作业记录损坏", failure); }
    }
}

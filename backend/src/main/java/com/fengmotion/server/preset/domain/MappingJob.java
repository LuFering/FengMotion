package com.fengmotion.server.preset.domain;

import java.time.Instant;
import java.util.List;
import com.fengmotion.server.preset.service.PresetMappingValidator;

public record MappingJob(String id, String skillPackageId, String skillPath, String status,
                         String stage, Instant stageStartedAt, Instant startedAt, Instant finishedAt,
                         Context context, String presetId, Error error) {
    public boolean terminal() { return List.of("succeeded", "failed", "cancelled").contains(status); }

    public MappingJob stage(String next, Instant now) {
        return new MappingJob(id, skillPackageId, skillPath, "running", next, now,
                startedAt == null ? now : startedAt, null, context, null, null);
    }

    public MappingJob withContext(Context value) {
        return new MappingJob(id, skillPackageId, skillPath, status, stage, stageStartedAt,
                startedAt, finishedAt, value, presetId, error);
    }

    public MappingJob finish(String nextStatus, String preset, Error failure, Instant now) {
        return new MappingJob(id, skillPackageId, skillPath, nextStatus, null, null,
                startedAt, now, context, preset, failure);
    }

    public record Context(int files, int chars, List<String> truncatedSources) { }
    public record Error(String code, String message, List<PresetMappingValidator.Problem> problems) { }
}

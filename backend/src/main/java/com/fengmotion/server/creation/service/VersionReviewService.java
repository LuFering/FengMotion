package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.LocalStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.VideoTimeline;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class VersionReviewService {
    private static final String NAMESPACE = "version-review";
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final LocalStateStore documents;
    private final ObjectMapper json;

    public synchronized Decision record(String projectId, long version, Request request) {
        validate(request);
        try (var activity = operations.participate(projectId)) {
            Project project = project(projectId);
            var saved = version(projectId, version);
            String key = projectId + ":" + version;
            var document = documents.find(NAMESPACE, key).orElse(null);
            ObjectNode envelope = document == null ? json.createObjectNode() : envelope(document);
            ArrayNode records = envelope.withArray("records");
            for (var entry : records) {
                if (request.requestId().equals(entry.path("request").path("requestId").asText())) {
                    if (!request.equals(json.convertValue(entry.path("request"), Request.class))) throw conflict("review_idempotency_conflict", "该审阅请求ID已用于其他决定");
                    return json.convertValue(entry.path("decision"), Decision.class);
                }
            }
            long revision = document == null ? 0 : document.revision();
            if (revision != request.expectedRevision()) throw conflict("review_conflict", "审阅记录已变化，请重新读取");
            if (records.size() >= 500) throw conflict("review_limit", "该版本审阅历史已达500条，请保留历史并使用新版本继续");
            operations.acquire(projectId);
            try {
            if (scenes.find(projectId).filter(current -> current.present()).map(current -> current.version()).orElse(0L) != version) throw conflict("scene_version_conflict", "只能对当前有效的已提交版本新增审阅决定，历史只读");
            String actualHash = hash(project, saved);
            if (!actualHash.equals(request.videoHash())) throw conflict("review_video_changed", "审阅的视频内容已变化，请重新观看");
            if (request.decision().equals("approved")) {
                var verification = documents.find("workbench-job", request.verificationRequestId())
                        .filter(documented -> projectId.equals(documented.projectId()) && !documented.deleted())
                        .orElseThrow(() -> conflict("review_verification_required", "技术核验结果不存在"));
                var result = verification.data().path("result");
                if (!"version_verify".equals(verification.data().path("request").path("kind").asText())
                        || !"completed".equals(verification.data().path("state").asText()) || !result.isObject()
                        || result.path("version").asLong() != version || !actualHash.equals(result.path("videoHash").asText())
                        || !"technical-integrity-v1".equals(result.path("scope").asText()) || !"passed".equals(result.path("conclusion").asText())) {
                    throw conflict("review_verification_required", "通过审阅前需要此版本、此视频摘要的已通过技术核验");
                }
            }
            if (scenes.find(projectId).map(current -> current.version()).orElse(0L) != version) throw conflict("scene_version_conflict", "记录审阅期间版本已变化");
            if (!actualHash.equals(hash(project, saved))) throw conflict("review_video_changed", "记录审阅期间视频已变化");
            Decision decision = new Decision(UUID.randomUUID().toString(), projectId, version, request.requestId(), request.decision(),
                    request.note(), actualHash, saved.film() == null ? null : saved.film().path("sourceHash").textValue(),
                    request.verificationRequestId(), "local-review-api", Instant.now().toString());
            records.addObject().set("request", json.valueToTree(request));
            ((ObjectNode) records.get(records.size() - 1)).set("decision", json.valueToTree(decision));
            documents.put(NAMESPACE, key, projectId, revision, envelope, false);
            return decision;
            } finally { operations.release(projectId); }
        }
    }

    public synchronized Status read(String projectId, long version) {
        try (var activity = operations.participate(projectId)) {
            var project = project(projectId);
            var saved = version(projectId, version);
            var document = documents.find(NAMESPACE, projectId + ":" + version).orElse(null);
            List<Decision> history = new ArrayList<>();
            if (document != null) for (var entry : envelope(document).path("records")) history.add(json.convertValue(entry.path("decision"), Decision.class));
            String currentHash = null;
            String availability = null;
            try { currentHash = hash(project, saved); }
            catch (ApiException failure) { availability = failure.getCode(); }
            Decision latest = history.isEmpty() ? null : history.getLast();
            String state = latest == null ? "unreviewed" : currentHash == null || !latest.videoHash().equals(currentHash) ? "stale" : latest.decision();
            return new Status(projectId, version, document == null ? 0 : document.revision(), state, currentHash, availability,
                    latest, List.copyOf(history));
        }
    }

    private ObjectNode envelope(LocalStateStore.Document document) {
        if (document.data() == null || !document.data().isObject() || !document.data().path("records").isArray()
                || document.data().path("records").size() > 500) throw conflict("review_record_invalid", "审阅历史结构损坏，未覆盖记录");
        var ids = new java.util.HashSet<String>();
        for (var entry : document.data().path("records")) {
            try {
                Request request = json.convertValue(entry.path("request"), Request.class);
                validate(request);
                Decision decision = json.convertValue(entry.path("decision"), Decision.class);
                if (decision == null || decision.reviewId() == null || decision.decidedAt() == null
                        || !ids.add(request.requestId()) || !request.requestId().equals(decision.requestId())
                        || !java.util.Objects.equals(document.projectId(), decision.projectId())
                        || !document.id().equals(decision.projectId() + ":" + decision.version())
                        || !request.decision().equals(decision.decision()) || !request.videoHash().equals(decision.videoHash())) {
                    throw conflict("review_record_invalid", "审阅历史身份不一致，未覆盖记录");
                }
            } catch (IllegalArgumentException | ApiException invalid) {
                throw conflict("review_record_invalid", "审阅历史内容损坏，未覆盖记录");
            }
        }
        return (ObjectNode) document.data().deepCopy();
    }

    private String hash(Project project, ProjectSceneVersion version) {
        try {
            Path video = VideoTimeline.projectVideo(project.rootPath(), version.artifactPath());
            return VideoTimeline.videoHash(video);
        } catch (IOException failure) { throw conflict("review_video_unreadable", "无法核对审阅视频"); }
    }

    private Project project(String id) { return projects.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在")); }
    private ProjectSceneVersion version(String id, long version) {
        return scenes.findVersion(id, version).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "版本不存在"));
    }

    private static void validate(Request request) {
        if (request == null || request.requestId() == null || !request.requestId().matches("[a-zA-Z0-9_-]{1,128}")
                || request.expectedRevision() == null || request.expectedRevision() < 0 || request.decision() == null
                || !List.of("approved", "rejected").contains(request.decision()) || request.videoHash() == null
                || !request.videoHash().matches("[0-9a-f]{64}") || request.note() != null && request.note().length() > 4000
                || "rejected".equals(request.decision()) && (request.note() == null || request.note().isBlank())
                || "approved".equals(request.decision()) && (request.verificationRequestId() == null || !request.verificationRequestId().matches("[a-zA-Z0-9_-]{1,128}"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "审阅需要请求ID、修订号、决定及视频摘要；拒绝需原因，通过需技术核验请求ID");
        }
    }

    private static ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }
    public record Request(String requestId, Long expectedRevision, String decision, String note, String videoHash, String verificationRequestId) { }
    public record Decision(String reviewId, String projectId, long version, String requestId, String decision, String note,
                           String videoHash, String sourceHash, String verificationRequestId, String recordedVia, String decidedAt) { }
    public record Status(String projectId, long version, long revision, String state, String videoHash, String unavailableCode,
                         Decision latest, List<Decision> history) { }
}

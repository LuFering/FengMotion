package com.fengmotion.server.project.service;

import java.nio.file.Path;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ProjectWorktreeService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;

    public State read(String projectId) {
        try (var activity = operations.participate(projectId)) { return readActive(projectId); }
    }

    private State readActive(String projectId) {
        Project project = projects.findById(projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        Path root = root(project);
        var current = scenes.find(projectId).orElse(null);
        if (current != null && !current.present()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                "scene_corrupt", "当前场景记录损坏，请核对历史版本");
        long version = current == null ? 0 : current.version();
        String workingHash = fingerprint(root);
        String renderedHash = current == null ? null : current.film().path("sourceHash").textValue();
        String artifact = version == 0 ? null : scenes.findVersion(projectId, version)
                .map(saved -> saved.artifactPath()).orElse(null);
        boolean hasBaseline = renderedHash != null && !renderedHash.isBlank();
        Boolean dirty = null;
        if (version == 0) dirty = !ProjectSourceFingerprint.EMPTY.equals(workingHash);
        else if (hasBaseline) dirty = !Objects.equals(workingHash, renderedHash);
        String status = version == 0 ? "unrendered" : dirty == null ? "unknown" : dirty ? "dirty" : "clean";
        long latest = scenes.find(projectId).filter(ProjectScene::present).map(ProjectScene::version).orElse(0L);
        if (latest != version) throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "读取工作稿期间成片版本已变化，请重新读取");
        return new State(projectId, version, workingHash, renderedHash, dirty, status,
                operations.isBusy(projectId), artifact);
    }

    public static Path root(Project project) {
        if (project.rootPath() == null || project.rootPath().isBlank()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_unavailable", "项目没有源码目录");
        }
        Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();
        if (!java.nio.file.Files.isDirectory(root)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_unavailable", "项目源码目录不可读取");
        }
        return root;
    }

    public static String fingerprint(Path root) {
        String hash = ProjectSourceFingerprint.compute(root);
        if (hash.startsWith("error:")) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_unreadable", "无法校验工作稿源码");
        }
        return hash;
    }

    public record State(String projectId, long version, String sourceHash, String renderedSourceHash,
                        Boolean dirty, String status, boolean operationBusy, String artifactPath) { }
}

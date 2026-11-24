package com.fengmotion.server.render.api;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.fengmotion.server.asset.service.ThumbnailService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.VideoTimeline;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/poster")
@RequiredArgsConstructor
public class ProjectPosterController {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ThumbnailService thumbnails;
    private final ProjectOperationLock operations;

    @GetMapping
    public ResponseEntity<Resource> get(@PathVariable String projectId, @RequestParam long version) throws IOException {
        try (var activity = operations.participate(projectId)) {
            var project = projects.findById(projectId).orElseThrow(() -> missing("项目不存在"));
            var snapshot = scenes.findVersion(projectId, version).orElseThrow(() -> missing("该版本没有画面"));
            Path video = VideoTimeline.projectVideo(project.rootPath(), snapshot.artifactPath());
            Path root = Path.of(project.rootPath()).toRealPath();
            Path control = root.resolve(".fengmotion");
            Path cache = control.resolve("posters");
            if (Files.isSymbolicLink(control) || Files.isSymbolicLink(cache)) throw invalid();
            Files.createDirectories(cache);
            String videoHash = VideoTimeline.videoHash(video);
            Path target = cache.resolve("v" + version + "-" + videoHash + ".webp");
            if (Files.isSymbolicLink(target)) throw invalid();
            if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS) || Files.size(target) == 0) {
                Path temporary = Files.createTempFile(cache, ".poster-", ".webp");
                try {
                    if (!thumbnails.extractVideoThumbnail(video, temporary)
                            || !Files.isRegularFile(temporary, LinkOption.NOFOLLOW_LINKS) || Files.size(temporary) == 0) {
                        throw missing("封面暂不可用");
                    }
                    if (!videoHash.equals(VideoTimeline.videoHash(video))) throw new ApiException(HttpStatus.CONFLICT,
                            "poster_video_changed", "抽帧期间视频发生变化，请重新读取封面");
                    if (Files.isSymbolicLink(control) || Files.isSymbolicLink(cache) || Files.isSymbolicLink(target)) throw invalid();
                    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } finally { Files.deleteIfExists(temporary); }
            }
            return ResponseEntity.ok().contentType(MediaType.parseMediaType("image/webp"))
                    .cacheControl(CacheControl.noCache()).eTag(videoHash).body(new FileSystemResource(target));
        }
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "poster_path_invalid", "封面缓存不能使用符号链接");
    }

    private static ApiException missing(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", message);
    }
}

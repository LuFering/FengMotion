package com.fengmotion.server.project.api;
import java.nio.file.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.core.io.*;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.asset.service.ThumbnailService;
import lombok.RequiredArgsConstructor;
/** A cached frame of the exact project version, not a decorative cover. */
@RestController
@RequestMapping("/api/projects/{projectId}/poster")
@RequiredArgsConstructor
public class ProjectPosterController {
 private final ProjectRepository projects;
 private final ProjectSceneRepository scenes;
 private final ThumbnailService thumbnails;
 @GetMapping public ResponseEntity<Resource> get(@PathVariable String projectId,@RequestParam long version)throws Exception{
  var project=projects.findById(projectId).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"not_found","项目不存在"));
  var snapshot=scenes.findVersion(projectId,version).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"not_found","该版本没有画面"));
  if(snapshot.artifactPath()==null)throw new ApiException(HttpStatus.NOT_FOUND,"not_found","该版本没有视频");
  var root=Path.of(project.rootPath()).toRealPath();var video=root.resolve(snapshot.artifactPath()).normalize();
  if(!Files.isRegularFile(video)||!video.toRealPath().startsWith(root))throw new ApiException(HttpStatus.NOT_FOUND,"not_found","视频不可读取");
  var target=root.resolve(".fengmotion/posters/v"+version+".webp");
  if((!Files.isRegularFile(target)||Files.size(target)==0)&&!thumbnails.extractVideoThumbnail(video,target))throw new ApiException(HttpStatus.NOT_FOUND,"not_found","封面暂不可用");
  return ResponseEntity.ok().contentType(MediaType.parseMediaType("image/webp")).cacheControl(CacheControl.maxAge(java.time.Duration.ofDays(1))).body(new FileSystemResource(target));
 }
}

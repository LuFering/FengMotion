package com.fengmotion.server.asset.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.ProjectActivityGate;

@Service
public class AssetPathImportService {
    private final AssetService assets;
    private final ProjectActivityGate activities;
    private final List<Path> allowedRoots;

    public AssetPathImportService(AssetService assets,ProjectActivityGate activities,
            @Value("${fengmotion.asset.import-roots:${fengmotion.workspace-root:${user.home}/FengMotion/projects}}") String roots) {
        this.assets=assets;
        this.activities=activities;
        this.allowedRoots=java.util.Arrays.stream(roots.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator)))
                .filter(value->!value.isBlank()).map(value->Path.of(value).toAbsolutePath().normalize()).toList();
    }

    public AssetService.ImportResult copy(Request request) {
        if(request==null || request.filePath()==null || request.filePath().isBlank()) throw invalid();
        Path source;
        try { source=Path.of(request.filePath()); }
        catch(java.nio.file.InvalidPathException failure) { throw invalid(); }
        if(!source.isAbsolute() || !source.normalize().equals(source)) throw denied();
        try(var activity=activities.participate(request.projectId())) {
            assets.requireProject(request.projectId());
            if(!Files.isRegularFile(source,LinkOption.NOFOLLOW_LINKS)) {
                if(Files.isSymbolicLink(source)) throw denied();
                throw new ApiException(HttpStatus.NOT_FOUND,"not_found","导入文件不存在或不是普通文件");
            }
            Path real=source.toRealPath();
            boolean allowed=false;
            for(Path configured:allowedRoots) {
                if(!Files.isDirectory(configured)) continue;
                Path root=configured.toRealPath();
                if(real.startsWith(root) && !real.equals(root) && source.startsWith(configured)) {
                    Path current=configured;
                    boolean link=false;
                    for(Path part:configured.relativize(source)) { current=current.resolve(part);link|=Files.isSymbolicLink(current); }
                    if(!link) { allowed=true;break; }
                }
            }
            if(!allowed) throw denied();
            try(var input=Files.newInputStream(real,LinkOption.NOFOLLOW_LINKS)) {
                return assets.importFile(source.getFileName().toString(),Files.probeContentType(real),request.folderId(),null,input,false,request.projectId());
            }
        } catch(IOException failure) { throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"source_unreadable","无法读取导入文件"); }
    }

    private static ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST,"validation_error","需要有效的绝对文件路径"); }
    private static ApiException denied() { return new ApiException(HttpStatus.FORBIDDEN,"path_not_allowed","文件不在允许导入的目录内，或路径包含符号链接",Map.of("reason","path_not_allowed")); }
    public record Request(String filePath,String folderId,String projectId) { }
}

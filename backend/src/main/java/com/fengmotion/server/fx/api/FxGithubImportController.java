package com.fengmotion.server.fx.api;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.fengmotion.server.fx.service.FxCapabilityImporter;
import com.fengmotion.server.fx.service.capability.CapabilitySource;

/** 只保存用户选中的源码，不执行第三方仓库。 */
@RestController
@RequestMapping("/api/fx-techniques/github")
public class FxGithubImportController {
    private final FxCapabilityImporter importer;
    private final Path root;
    public FxGithubImportController(FxCapabilityImporter importer, @Value("${fengmotion.data-dir}") String dataDir) {
        this.importer = importer;
        this.root = Path.of(dataDir).resolve("fx-github-sources");
    }
    public record SourceFile(String path, String code) {}
    public record ImportRequest(String owner, String repo, String commit, List<SourceFile> files) {}
    public record ImportResponse(int imported) {}

    @PostMapping("/import")
    public ImportResponse importSources(@RequestBody ImportRequest request) throws Exception {
        if (request == null || request.owner() == null || request.repo() == null || request.commit() == null
                || !request.owner().matches("[A-Za-z0-9-]{1,39}")
                || !request.repo().matches("[A-Za-z0-9_.-]{1,100}")
                || !request.commit().matches("[0-9a-f]{40}")
                || request.files() == null || request.files().isEmpty() || request.files().size() > 60) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "仓库信息或条目数量无效");
        }
        var parsed = new ArrayList<CapabilitySource.ParsedItem>();
        for (var file : request.files()) {
            if (file == null || file.path() == null || file.code() == null || file.code().isBlank()
                    || file.path().length() > 500 || !file.path().toLowerCase().endsWith(".tsx")
                    || file.path().startsWith("/") || file.path().contains("..") || file.path().contains("\\")
                    || file.code().getBytes(StandardCharsets.UTF_8).length > 300_000) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "源码路径或内容无效");
            }
            String repo = request.owner().toLowerCase() + "/" + request.repo().toLowerCase();
            String identity = sha(repo + "\n" + file.path());
            String contentHash = sha(file.code());
            Path target = root.resolve(contentHash + ".tsx");
            Files.createDirectories(root);
            if (!Files.exists(target)) Files.writeString(target, file.code(), StandardCharsets.UTF_8);
            String name = file.path().substring(file.path().lastIndexOf('/') + 1).replaceFirst("(?i)\\.tsx$", "");
            parsed.add(new CapabilitySource.ParsedItem("github:" + identity, name, "", "", "", List.of(), List.of(), List.of(), "",
                    repo, "https://github.com/" + request.owner() + "/" + request.repo() + "/blob/" + request.commit() + "/" + file.path(), request.commit(), "", "", "", target.toString()));
        }
        return new ImportResponse(importer.importItems(parsed));
    }
    private static String sha(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}

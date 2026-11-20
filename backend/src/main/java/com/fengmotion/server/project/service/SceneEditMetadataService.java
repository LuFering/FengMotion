package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.domain.SceneEditMetadata;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SceneEditMetadataService {
    public static final Path MANIFEST = Path.of("src", "editable-elements.json");
    public static final int MAX_TEXT_LENGTH = 2000;
    private static final int MAX_MANIFEST_BYTES = 65_536;
    private static final int MAX_ELEMENTS = 64;
    private static final Pattern ELEMENT_ID = Pattern.compile("[a-z][a-z0-9_-]{0,63}");

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectSourceSnapshots snapshots;
    private final ProjectFilmConfig configs;
    private final ObjectMapper json;

    public SceneEditMetadata read(String projectId, long versionNumber) {
        var project = projects.findById(projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        var version = scenes.findVersion(projectId, versionNumber).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "版本 " + versionNumber + " 不存在"));
        return read(project, version);
    }

    public SceneEditMetadata read(Project project, ProjectSceneVersion version) {
        JsonNode film = version.film();
        if (film == null || !"project-render".equals(film.path("kind").asText())) {
            return SceneEditMetadata.previewOnly(version, "unsupported_source", "该版本没有受支持的源码工程");
        }
        String snapshot = film.path("sourceSnapshot").asText("");
        String sourceHash = film.path("sourceHash").asText("");
        if (project.rootPath() == null || project.rootPath().isBlank() || snapshot.isBlank() || sourceHash.isBlank()) {
            return SceneEditMetadata.previewOnly(version, "snapshot_missing", "该版本未保存可校验的源码快照");
        }

        Path manifest;
        try {
            Path source = snapshots.resolve(Path.of(project.rootPath()), snapshot, sourceHash);
            var config = configs.read(source);
            if (!config.entry().equals(film.path("entry").asText())
                    || !config.compositionId().equals(film.path("compositionId").asText())) {
                return SceneEditMetadata.previewOnly(version, "snapshot_invalid", "源码快照与该版本的工程入口不一致");
            }
            manifest = source.resolve(MANIFEST);
        } catch (ApiException | InvalidPathException failure) {
            return SceneEditMetadata.previewOnly(version, "snapshot_invalid", "该版本的源码快照缺失或校验失败");
        }

        if (Files.notExists(manifest, LinkOption.NOFOLLOW_LINKS)) {
            return SceneEditMetadata.previewOnly(version, "manifest_missing", "该版本未声明可编辑元素");
        }
        try {
            return SceneEditMetadata.declared(version, sourceHash,
                    readElements(manifest, film.path("output").path("durationInFrames")));
        } catch (IOException failure) {
            return SceneEditMetadata.previewOnly(version, "manifest_invalid", "该版本的元素声明无效或不可读取");
        }
    }

    public void updateText(Path manifest, String elementId, String text, int durationInFrames) {
        if (text == null || text.length() > MAX_TEXT_LENGTH) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "文字长度不能超过 2000 个字符");
        }
        ObjectNode document;
        try {
            document = readDocument(manifest);
            readElements(document, json.getNodeFactory().numberNode(durationInFrames));
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "manifest_invalid",
                    "元素声明无效或不可读取");
        }
        for (JsonNode element : document.path("elements")) {
            if (!elementId.equals(element.path("id").asText())) continue;
            ((ObjectNode) element.path("properties")).put("text", text);
            try {
                byte[] content = json.writeValueAsBytes(document);
                if (content.length > MAX_MANIFEST_BYTES) {
                    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "manifest_invalid", "修改后元素声明超过 64 KiB");
                }
                Files.write(manifest, content, LinkOption.NOFOLLOW_LINKS, StandardOpenOption.TRUNCATE_EXISTING);
                return;
            } catch (IOException failure) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "manifest_write_failed", "无法保存元素文字修改");
            }
        }
        throw new ApiException(HttpStatus.NOT_FOUND, "element_not_found",
                "源码快照中不存在该元素");
    }

    public void validateManifest(Path manifest, int durationInFrames) {
        try {
            readElements(manifest, json.getNodeFactory().numberNode(durationInFrames));
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "manifest_invalid",
                    "渲染后的元素声明与成片时长不匹配");
        }
    }

    private List<SceneEditMetadata.Element> readElements(Path manifest, JsonNode durationInFrames) throws IOException {
        return readElements(readDocument(manifest), durationInFrames);
    }

    private ObjectNode readDocument(Path manifest) throws IOException {
        if (!Files.isRegularFile(manifest, LinkOption.NOFOLLOW_LINKS)) throw invalid();
        byte[] content;
        try (var input = Files.newInputStream(manifest, LinkOption.NOFOLLOW_LINKS)) {
            content = input.readNBytes(MAX_MANIFEST_BYTES + 1);
        }
        if (content.length > MAX_MANIFEST_BYTES) throw invalid();

        JsonNode document = json.reader().with(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(content);
        if (document == null || !document.isObject() || document.size() != 2
                || !document.path("schemaVersion").isInt() || document.path("schemaVersion").intValue() != 1) {
            throw invalid();
        }
        return (ObjectNode) document;
    }

    private List<SceneEditMetadata.Element> readElements(ObjectNode document, JsonNode durationInFrames) throws IOException {
        JsonNode elements = document.path("elements");
        if (!elements.isArray() || elements.isEmpty() || elements.size() > MAX_ELEMENTS) throw invalid();
        var ids = new HashSet<String>();
        var result = new ArrayList<SceneEditMetadata.Element>();
        for (JsonNode element : elements) {
            String id = element.path("id").textValue();
            String label = element.path("label").textValue();
            JsonNode properties = element.path("properties");
            String text = properties.path("text").textValue();
            boolean hasPlacement = element.has("placement");
            if (!element.isObject() || element.size() != (hasPlacement ? 5 : 4)
                    || id == null || !ELEMENT_ID.matcher(id).matches()
                    || !ids.add(id) || !"text".equals(element.path("kind").textValue())
                    || label == null || label.isBlank() || label.length() > 80
                    || !properties.isObject() || properties.size() != 1 || text == null || text.length() > MAX_TEXT_LENGTH) {
                throw invalid();
            }
            var placement = hasPlacement ? readPlacement(element.path("placement"), durationInFrames) : null;
            result.add(new SceneEditMetadata.Element(id, "text", label, new SceneEditMetadata.TextProperties(text), placement));
        }
        return result;
    }

    private static SceneEditMetadata.Placement readPlacement(JsonNode placement, JsonNode durationInFrames)
            throws IOException {
        JsonNode startNode = placement.path("startFrame");
        JsonNode endNode = placement.path("endFrame");
        JsonNode bounds = placement.path("bounds");
        if (!placement.isObject() || placement.size() != 3 || !startNode.isInt() || !endNode.isInt()
                || !durationInFrames.isInt() || !bounds.isObject() || bounds.size() != 4) throw invalid();

        int start = startNode.intValue();
        int end = endNode.intValue();
        if (start < 0 || end <= start || end > durationInFrames.intValue()) throw invalid();

        double x = unit(bounds.path("x"));
        double y = unit(bounds.path("y"));
        double width = unit(bounds.path("w"));
        double height = unit(bounds.path("h"));
        if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw invalid();
        return new SceneEditMetadata.Placement(start, end, new SceneEditMetadata.Bounds(x, y, width, height));
    }

    private static double unit(JsonNode value) throws IOException {
        double number = value.doubleValue();
        if (!value.isNumber() || !Double.isFinite(number) || number < 0 || number > 1) throw invalid();
        return number;
    }

    private static IOException invalid() {
        return new IOException("Invalid editable elements manifest");
    }
}

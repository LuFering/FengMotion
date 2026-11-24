package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectWorktreeService;
import com.fengmotion.server.project.store.ProjectRepository;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class StoryboardService {
    private final ProjectRepository projects;
    private final ProjectOperationLock operations;
    private final ObjectMapper json;
    private static final int MAX_BYTES = 1_048_576;
    private static final int MAX_ENTRIES = 500;

    public Result read(String projectId) {
        try (var activity = operations.participate(projectId)) {
            var project = projects.findById(projectId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
            Path root = ProjectWorktreeService.root(project);
            String source = Files.exists(root.resolve("storyboard.json"), LinkOption.NOFOLLOW_LINKS) ? "storyboard.json" : "shot-plan.json";
            Path file = root.resolve(source);
            if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return new Result(List.of(), "none", "absent");
            try {
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_BYTES) throw invalid();
                byte[] bytes;
                try (var input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) { bytes = input.readNBytes(MAX_BYTES + 1); }
                if (bytes.length > MAX_BYTES) throw invalid();
                JsonNode document = json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                        com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(bytes);
                if (document == null || !document.isObject()) throw invalid();
                List<Entry> entries = source.equals("storyboard.json") ? entries(projectId, document) : shots(projectId, document);
                String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                return new Result(entries, source, hash);
            } catch (IOException failure) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "storyboard_invalid", "分镜文件不可读取或不是合法JSON，未用成片或模板替代");
            } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        }
    }

    private List<Entry> entries(String projectId, JsonNode document) {
        if (!"1.0".equals(document.path("schemaVersion").asText()) || !"storyboard".equals(document.path("type").asText())) throw invalid();
        var items = document.path("entries");
        requireArray(items);
        var ids = new HashSet<String>();
        var result = new ArrayList<Entry>();
        for (JsonNode item : items) {
            String id = identity(item, ids);
            result.add(new Entry(id, projectId, text(item, "segment"), text(item, "timecode"), text(item, "duration"),
                    text(item, "narration"), text(item, "visual"), text(item, "motion"), text(item, "transition"), text(item, "act")));
        }
        return List.copyOf(result);
    }

    private List<Entry> shots(String projectId, JsonNode document) {
        if (!"1.0".equals(document.path("schemaVersion").asText()) || !"shot-plan".equals(document.path("type").asText())) throw invalid();
        int fps = integer(document.path("fps"), 1, 240);
        int duration = integer(document.path("durationInFrames"), 1, 36000 * fps);
        var shots = document.path("shots");
        requireArray(shots);
        Map<String, String> captions = dictionary(document.path("captions"), "text");
        Map<String, String> events = dictionary(document.path("events"), "description");
        var ids = new HashSet<String>();
        var result = new ArrayList<Entry>();
        for (JsonNode shot : shots) {
            String id = identity(shot, ids);
            int start = integer(shot.path("from"), 0, duration);
            int frames = integer(shot.path("durationInFrames"), 1, duration);
            if ((long) start + frames > duration) throw invalid();
            result.add(new Entry(id, projectId, id, start + "–" + (start + frames) + " frames @ " + fps + " fps",
                    frames + " frames @ " + fps + " fps", references(shot.path("captionIds"), captions),
                    references(shot.path("eventIds"), events), "", text(shot, "transitionIntent"), ""));
        }
        return List.copyOf(result);
    }

    private Map<String, String> dictionary(JsonNode items, String field) {
        requireArray(items);
        var ids = new HashSet<String>();
        var values = new HashMap<String, String>();
        for (JsonNode item : items) values.put(identity(item, ids), text(item, field));
        return values;
    }

    private String references(JsonNode ids, Map<String, String> values) {
        requireArray(ids);
        var selected = new ArrayList<String>();
        for (JsonNode id : ids) {
            if (!id.isTextual() || !values.containsKey(id.textValue())) throw invalid();
            selected.add(values.get(id.textValue()));
        }
        String result = String.join("\n", selected);
        if (result.length() > 16384) throw invalid();
        return result;
    }

    private static String identity(JsonNode item, java.util.Set<String> ids) {
        String id = text(item, "id");
        if (!id.matches("[a-zA-Z0-9_-]{1,128}") || !ids.add(id)) throw invalid();
        return id;
    }

    private static String text(JsonNode item, String field) {
        if (!item.isObject()) throw invalid();
        JsonNode value = item.path(field);
        if (value.isMissingNode() || value.isNull()) return "";
        if (!value.isTextual() || value.textValue().length() > 16384) throw invalid();
        return value.textValue();
    }

    private static int integer(JsonNode value, int minimum, int maximum) {
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < minimum || value.intValue() > maximum) throw invalid();
        return value.intValue();
    }

    private static void requireArray(JsonNode value) { if (!value.isArray() || value.size() > MAX_ENTRIES) throw invalid(); }
    private static ApiException invalid() { return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "storyboard_invalid", "分镜格式、ID、引用或时间无效；未猜测内容"); }
    public record Entry(String id, String projectId, String segment, String timecode, String duration, String narration,
                        String visual, String motion, String transition, String act) { }
    public record Result(List<Entry> items, String source, String sourceHash) { }
}

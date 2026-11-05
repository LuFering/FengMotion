package com.fengmotion.server.fx.service.capability;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.Yaml;

/**
 * 读取 {@code fx/sources.yml} 里的来源配置。
 *
 * <p>配置缺失或格式错误时<strong>不抛异常、返回空列表</strong>：
 * 导入是启动期的增值功能，配置写坏了不该让整个应用起不来。
 * 但必须记 warn 并说清「本轮没有导入任何来源」，否则页面空了也查不出原因。</p>
 */
@Component
public class SourceProfileLoader {

    private static final Logger log = LoggerFactory.getLogger(SourceProfileLoader.class);

    private static final String RESOURCE = "fx/sources.yml";

    /**
     * 加载全部来源配置。
     *
     * @return 来源配置；文件缺失或错误时为空列表
     */
    public List<SourceProfile> load() {
        ClassPathResource resource = new ClassPathResource(RESOURCE);
        if (!resource.exists()) {
            log.warn("缺少来源配置 {}，本轮不导入任何能力库", RESOURCE);
            return List.of();
        }
        try (InputStream in = resource.getInputStream()) {
            Object parsed = new Yaml().load(in);
            if (!(parsed instanceof Map<?, ?> root)) {
                log.warn("来源配置格式不正确（应为映射），本轮不导入");
                return List.of();
            }
            Object sources = root.get("sources");
            if (!(sources instanceof List<?> list)) {
                log.warn("来源配置缺少 sources 列表，本轮不导入");
                return List.of();
            }
            List<SourceProfile> profiles = new ArrayList<>();
            for (Object item : list) {
                SourceProfile profile = toProfile(item);
                if (profile != null) {
                    profiles.add(profile);
                }
            }
            log.info("来源配置已加载：{} 个来源", profiles.size());
            return List.copyOf(profiles);
        } catch (Exception failed) {
            log.warn("读取来源配置失败，本轮不导入：{}", failed.getMessage());
            return List.of();
        }
    }

    private SourceProfile toProfile(Object item) {
        if (!(item instanceof Map<?, ?> map)) {
            return null;
        }
        String name = text(map.get("name"));
        if (name.isBlank()) {
            /* 没有名字的来源无法写进 source_project，也没法在预览里区分，
               直接跳过而不是给一个自动名字。 */
            log.warn("来源配置缺少 name，已跳过一条");
            return null;
        }
        return new SourceProfile(
                name,
                text(map.get("root")).isBlank() ? name : text(map.get("root")),
                stringList(map.get("include")),
                stringList(map.get("exclude")),
                text(map.get("categoryFrom")).isBlank() ? "parent" : text(map.get("categoryFrom")),
                stringList(map.get("parsers")),
                Boolean.TRUE.equals(map.get("needsModel")));
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).strip();
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (Object item : list) {
            String s = text(item);
            if (!s.isEmpty()) {
                out.add(s);
            }
        }
        return List.copyOf(out);
    }

    /** 供测试：按名字建索引。 */
    public Map<String, SourceProfile> loadByName() {
        Map<String, SourceProfile> byName = new LinkedHashMap<>();
        for (SourceProfile profile : load()) {
            byName.put(profile.name(), profile);
        }
        return byName;
    }
}

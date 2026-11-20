package com.fengmotion.server.architecture;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ModuleLayoutTest {
    private static final Path ROOT = Path.of("src/main/java/com/fengmotion/server");
    private static final Pattern PACKAGE = Pattern.compile("(?m)^package ([\\w.]+);");
    private static final Pattern REFERENCE = Pattern.compile("\\bcom\\.fengmotion\\.server\\.(\\w+)\\.");

    @Test void packageNamesMatchTheirSourceDirectoriesAndNoStoreImplementationLayerRemains() throws IOException {
        try (var files = Files.walk(ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                var matcher = PACKAGE.matcher(Files.readString(file));
                assertTrue(matcher.find(), () -> "Missing package: " + file);
                String expected = "com.fengmotion.server";
                Path parent = ROOT.relativize(file).getParent();
                if (parent != null) expected += "." + parent.toString().replace('\\', '.').replace('/', '.');
                assertEquals(expected, matcher.group(1), file.toString());
                assertFalse(matcher.group(1).contains(".store.impl"), file.toString());
            }
        }
        assertFalse(Files.exists(ROOT.resolve("workspace/package-info.java")));
        assertFalse(Files.exists(ROOT.resolve("catalog/package-info.java")));
    }

    @Test void businessModulesHaveNoCircularSourceDependencies() throws IOException {
        Map<String, Set<String>> graph = new HashMap<>();
        try (var directories = Files.list(ROOT)) {
            directories.filter(Files::isDirectory).forEach(path -> graph.put(path.getFileName().toString(), new TreeSet<>()));
        }
        try (var files = Files.walk(ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                Path relative = ROOT.relativize(file);
                if (relative.getNameCount() < 2) continue;
                String module = relative.getName(0).toString();
                String code = Files.readString(file).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//[^\\n]*", "");
                var matcher = REFERENCE.matcher(code);
                while (matcher.find()) {
                    String dependency = matcher.group(1);
                    if (!module.equals(dependency) && graph.containsKey(dependency)) graph.get(module).add(dependency);
                }
                if (module.equals("creation") && relative.getName(1).toString().equals("service")) {
                    assertFalse(code.contains("com.fengmotion.server.creation.api."), file.toString());
                }
            }
        }
        Set<String> visited = new HashSet<>();
        for (String module : new TreeSet<>(graph.keySet())) visit(module, graph, visited, new ArrayList<>());
    }

    private void visit(String module, Map<String, Set<String>> graph, Set<String> visited, List<String> active) {
        assertFalse(active.contains(module), () -> "Module cycle: " + String.join(" -> ", active) + " -> " + module);
        if (visited.contains(module)) return;
        active.add(module);
        for (String dependency : graph.get(module)) visit(dependency, graph, visited, active);
        active.removeLast();
        visited.add(module);
    }
}

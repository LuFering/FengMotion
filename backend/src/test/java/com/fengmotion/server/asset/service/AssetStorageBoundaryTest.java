package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AssetStorageBoundaryTest {
    @TempDir Path temporary;
    @Test void rejectsLinksAbsolutePathsTraversalAndStorageRoot() throws Exception {
        Path root=Files.createDirectories(temporary.resolve("library"));
        Path outside=Files.createDirectories(temporary.resolve("outside"));
        Files.createSymbolicLink(root.resolve("linked"),outside);
        var storage=new AssetStorage(root.toString());
        for(String path:java.util.List.of("linked/file.mp4","../outside/file.mp4",outside.toString(),".")) {
            assertThrows(IllegalArgumentException.class,()->storage.resolve(path));
            assertFalse(storage.isInsideRoot(path));
        }
        assertEquals(root.resolve("assets/a/file.mp4"),storage.resolve("assets/a/file.mp4"));
    }

    @Test void hashBucketsCannotBeUsedToSelectAnAncestorOrOtherDirectory() {
        var storage = new AssetStorage(temporary.toString());
        for (String hash : java.util.List.of("abc", "../..", "../../other", "/tmp/data", "a".repeat(63), "g".repeat(64))) {
            assertThrows(IllegalArgumentException.class, () -> storage.relativeDirFor(hash));
        }
        assertEquals(Path.of("assets", "ab", "ab".repeat(32)).toString(), storage.relativeDirFor("ab".repeat(32)));
    }

    @Test void replacedStorageRootIsRejected() throws Exception {
        Path outside = Files.createDirectory(temporary.resolve("outside"));
        Path link = Files.createSymbolicLink(temporary.resolve("library"), outside);
        assertThrows(IllegalArgumentException.class, () -> new AssetStorage(link.toString()).resolve("assets/ab/original.txt"));
    }
}

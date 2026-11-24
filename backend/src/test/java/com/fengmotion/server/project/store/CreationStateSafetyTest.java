package com.fengmotion.server.project.store;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

class CreationStateSafetyTest {
    @TempDir Path root;
    @Test void replacesStateAtomicallyAndDoesNotFollowLinks() throws Exception {
        var store=new CreationStateStore(new ObjectMapper());
        var state=store.state("edited","intent","reply",null,null,null,null);
        store.write(root,state);
        assertEquals(new ObjectMapper().valueToTree(state),new ObjectMapper().valueToTree(store.read(root)));
        Path external=Files.writeString(root.resolve("external"),"keep");
        Files.delete(root.resolve("creation-state.json"));
        Files.createSymbolicLink(root.resolve("creation-state.json"),external);
        assertThrows(ApiException.class,()->store.read(root));
        assertThrows(ApiException.class,()->store.write(root,state));
        assertEquals("keep",Files.readString(external));
        try(var files=Files.list(root)) { assertTrue(files.noneMatch(file->file.getFileName().toString().startsWith(".creation-state-"))); }
    }

    @Test void invalidStateCannotMasqueradeAsMissingAndOversizeWriteKeepsThePreviousRecord() throws Exception {
        var store = new CreationStateStore(new ObjectMapper());
        Path file = root.resolve("creation-state.json");
        for (String value : java.util.List.of("null", "[]", "{\"state\":\"edited\",\"state\":\"failed\"}", "{} {}")) {
            Files.writeString(file, value);
            assertEquals("creation_state_unreadable", assertThrows(ApiException.class, () -> store.read(root)).getCode());
        }
        var original = store.state("edited", "intent", "reply", null, null, null, null);
        store.write(root, original);
        byte[] before = Files.readAllBytes(file);
        assertEquals("creation_state_write_failed", assertThrows(ApiException.class, () -> store.write(root,
                store.state("edited", "intent", "x".repeat(16_000_001), null, null, null, null))).getCode());
        assertArrayEquals(before, Files.readAllBytes(file));
    }
}

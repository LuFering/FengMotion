package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fengmotion.server.common.ApiException;

class AssetPathImportTest {
    @TempDir Path root;
    @Test void copiesOnlyPlainFilesInsideConfiguredRoots() throws Exception {
        Path allowed=Files.createDirectories(root.resolve("allowed"));
        Path file=Files.writeString(allowed.resolve("source.txt"),"content");
        Path outside=Files.writeString(root.resolve("private.txt"),"private");
        var assets=mock(AssetService.class);
        var result=new AssetService.ImportResult(null,false);
        when(assets.importFile(any(),any(),any(),any(),any(),anyBoolean(),any())).thenAnswer(call->{
            assertEquals("content",new String(((java.io.InputStream)call.getArgument(4)).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
            return result;
        });
        var service=new AssetPathImportService(assets,project->()->{},allowed.toString());
        assertSame(result,service.copy(new AssetPathImportService.Request(file.toString(),null,null)));
        assertEquals("path_not_allowed",assertThrows(ApiException.class,()->service.copy(new AssetPathImportService.Request(outside.toString(),null,null))).getCode());
        Files.createSymbolicLink(allowed.resolve("link.txt"),outside);
        assertThrows(ApiException.class,()->service.copy(new AssetPathImportService.Request(allowed.resolve("link.txt").toString(),null,null)));
        verify(assets,times(1)).importFile(any(),any(),any(),any(),any(),anyBoolean(),any());
    }
}

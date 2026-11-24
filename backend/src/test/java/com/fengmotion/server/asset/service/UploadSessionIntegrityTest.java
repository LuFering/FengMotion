package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.asset.domain.Asset;

class UploadSessionIntegrityTest {
    @TempDir Path root;
    @Test void validatesChunkIdentityAndSupportsExactRetry() throws Exception {
        var uploads=new UploadSessionService(root.toString());
        var session=uploads.create("file.bin","application/octet-stream",3,null);
        byte[] data={1,2,3};
        assertThrows(ApiException.class,()->uploads.writeChunk(session.uploadId(),1,"bytes 0-2/3",data));
        assertThrows(ApiException.class,()->uploads.writeChunk(session.uploadId(),0,"bytes 0-2/9",data));
        assertEquals(3,uploads.writeChunk(session.uploadId(),0,"bytes 0-2/3",data).receivedBytes());
        assertEquals(3,uploads.writeChunk(session.uploadId(),0,"bytes 0-2/3",data).receivedBytes());
        assertEquals("upload_chunk_conflict",assertThrows(ApiException.class,()->uploads.writeChunk(session.uploadId(),0,"bytes 0-2/3",new byte[]{3,2,1})).getCode());
        Path target=root.resolve("assembled");
        uploads.assemble(session.uploadId(),target);
        assertArrayEquals(data,Files.readAllBytes(target));
        uploads.cancel(session.uploadId());
    }

    @Test void failedImportKeepsChunksAndCompletedRetryDoesNotImportAgain() throws Exception {
        var uploads=new UploadSessionService(root.toString());
        var session=uploads.create("file.txt","text/plain",3,null);
        uploads.writeChunk(session.uploadId(),0,"bytes 0-2/3",new byte[]{1,2,3});
        var assets=mock(AssetService.class);
        var asset=mock(Asset.class);
        when(asset.id()).thenReturn("asset-one");
        var result=new AssetService.ImportResult(asset,false);
        when(assets.importFile(any(),any(),any(),any(),any(),anyBoolean(),any())).thenThrow(new IllegalStateException("import failed")).thenReturn(result);
        assertThrows(IllegalStateException.class,()->uploads.complete(session.uploadId(),assets));
        assertEquals("uploading",uploads.get(session.uploadId()).status());
        assertTrue(Files.exists(root.resolve(".uploads/"+session.uploadId()+"/part-000000")));
        assertSame(result,uploads.complete(session.uploadId(),assets));
        assertSame(result,uploads.complete(session.uploadId(),assets));
        verify(assets,times(2)).importFile(any(),any(),any(),any(),any(),anyBoolean(),any());
        assertFalse(Files.exists(root.resolve(".uploads/"+session.uploadId()+"/part-000000")));
        when(assets.require("asset-one")).thenReturn(asset);
        var restarted=new UploadSessionService(root.toString());
        assertEquals("completed",restarted.get(session.uploadId()).status());
        assertEquals("asset-one",restarted.complete(session.uploadId(),assets).asset().id());
        verify(assets,times(2)).importFile(any(),any(),any(),any(),any(),anyBoolean(),any());
    }

    @Test void confirmedChunksRemainResumableAfterServiceRestart() throws Exception {
        var uploads=new UploadSessionService(root.toString());
        var session=uploads.create("file.bin","application/octet-stream",3,null);
        uploads.writeChunk(session.uploadId(),0,"bytes 0-2/3",new byte[]{1,2,3});
        var restarted=new UploadSessionService(root.toString());
        assertEquals(3,restarted.get(session.uploadId()).receivedBytes());
        Path result=root.resolve("result");
        restarted.assemble(session.uploadId(),result);
        assertArrayEquals(new byte[]{1,2,3},Files.readAllBytes(result));
    }

    @Test void committedReceiptSurvivesSessionFinalizationFailureWithoutReimporting() throws Exception {
        var uploads = new UploadSessionService(root.toString());
        var session = uploads.create("file.txt", "text/plain", 3, null);
        uploads.writeChunk(session.uploadId(), 0, "bytes 0-2/3", new byte[]{1, 2, 3});
        var assets = mock(AssetService.class);
        var asset = mock(Asset.class);
        when(asset.id()).thenReturn("asset-one");
        when(assets.require("asset-one")).thenReturn(asset);
        var result = new AssetService.ImportResult(asset, false);
        Path metadata = root.resolve(".uploads/" + session.uploadId() + "/session.json");
        String previous = Files.readString(metadata);
        when(assets.importFile(any(), any(), any(), any(), any(), anyBoolean(), any())).thenAnswer(invocation -> {
            Files.delete(metadata);
            Files.createDirectory(metadata);
            return result;
        });
        assertSame(result, uploads.complete(session.uploadId(), assets));
        assertEquals("completed", uploads.get(session.uploadId()).status());
        assertTrue(Files.exists(metadata.resolveSibling("completed.json")));
        assertTrue(Files.exists(metadata.resolveSibling("part-000000")));
        Files.delete(metadata);
        Files.writeString(metadata, previous);
        var restarted = new UploadSessionService(root.toString());
        assertEquals("asset-one", restarted.complete(session.uploadId(), assets).asset().id());
        assertEquals("completed", restarted.get(session.uploadId()).status());
        assertFalse(Files.exists(metadata.resolveSibling("part-000000")));
        verify(assets, times(1)).importFile(any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test void cachedSessionCannotFollowAReplacedUploadDirectory() throws Exception {
        var uploads = new UploadSessionService(root.toString());
        var session = uploads.create("file.bin", "application/octet-stream", 3, null);
        Path directory = root.resolve(".uploads/" + session.uploadId());
        Path moved = root.resolve("original-upload");
        Files.move(directory, moved);
        Files.createSymbolicLink(directory, moved);
        assertEquals("upload_session_invalid", assertThrows(ApiException.class,
                () -> uploads.writeChunk(session.uploadId(), 0, "bytes 0-2/3", new byte[]{1, 2, 3})).getCode());
        assertFalse(Files.exists(moved.resolve("part-000000")));
    }
}

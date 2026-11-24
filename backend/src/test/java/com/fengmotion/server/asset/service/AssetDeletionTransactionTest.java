package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@ActiveProfiles("test")
class AssetDeletionTransactionTest {
    @Autowired AssetService assets;
    @Autowired AssetStorage storage;
    @Autowired TransactionTemplate transactions;
    @Autowired AssetFileCleanup cleanup;

    @Test void rollbackPreservesOriginalAssetFileAndCommittedDeletionCleansIt() throws Exception {
        var asset = assets.importFile("rollback.txt", "text/plain", null, null,
                new ByteArrayInputStream(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8))).asset();
        var file = storage.resolve(asset.fileUrl());
        try {
            transactions.executeWithoutResult(status -> {
                assets.delete(asset.id());
                assertTrue(Files.isRegularFile(file));
                status.setRollbackOnly();
            });
            assertEquals(asset.id(), assets.require(asset.id()).id());
            assertTrue(Files.isRegularFile(file));
        } finally { assets.delete(asset.id()); }
        assertFalse(Files.exists(file));
    }

    @Test void cleanupRechecksForAReimportedContentOwner() throws Exception {
        var asset = assets.importFile("owner.txt", "text/plain", null, null,
                new ByteArrayInputStream(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8))).asset();
        var file = storage.resolve(asset.fileUrl());
        try {
            cleanup.removeUnreferenced(asset.contentHash());
            assertTrue(Files.isRegularFile(file));
            assertEquals(asset.id(), assets.require(asset.id()).id());
        } finally { assets.delete(asset.id()); }
    }
}

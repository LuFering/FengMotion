package com.fengmotion.server.asset.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AssetFileCleanup {
    private final JdbcTemplate jdbc;
    private final AssetStorage storage;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void removeUnreferenced(String hash) throws IOException {
        Path directory = storage.resolve(storage.relativeDirFor(hash));
        jdbc.update("UPDATE assets SET id=id WHERE 0");
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM assets WHERE content_hash=?", Integer.class, hash);
        if (count == null || count > 0 || !Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return;
        try (var paths = Files.walk(directory)) {
            for (Path file : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(file);
        }
    }
}

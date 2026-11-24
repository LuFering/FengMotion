package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

final class SourceEntryFingerprint {
    private SourceEntryFingerprint() { }
    static String compute(Path entry) throws IOException {
        if (!Files.exists(entry,LinkOption.NOFOLLOW_LINKS)) return "missing";
        try {
            var hash = MessageDigest.getInstance("SHA-256");
            try (var files = Files.walk(entry)) {
                for (Path file : files.sorted().toList()) {
                    if (Files.isSymbolicLink(file)) throw new IOException("symbolic link in source");
                    if (!Files.isDirectory(file,LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)) {
                        throw new IOException("special file in source");
                    }
                    hash.update(entry.relativize(file).toString().replace('\\','/').getBytes(StandardCharsets.UTF_8));
                    hash.update((byte)0);
                    hash.update((byte)(Files.isDirectory(file,LinkOption.NOFOLLOW_LINKS) ? 1 : 2));
                    if (Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)) {
                        hash.update(java.nio.ByteBuffer.allocate(Long.BYTES).putLong(Files.size(file)).array());
                        try (var input = Files.newInputStream(file,LinkOption.NOFOLLOW_LINKS)) {
                            byte[] buffer = new byte[65536];
                            int count;
                            while ((count = input.read(buffer)) >= 0) hash.update(buffer,0,count);
                        }
                    }
                }
            }
            return HexFormat.of().formatHex(hash.digest());
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}

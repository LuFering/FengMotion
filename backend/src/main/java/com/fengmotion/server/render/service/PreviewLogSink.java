package com.fengmotion.server.render.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.concurrent.atomic.AtomicBoolean;

final class PreviewLogSink implements AutoCloseable {
    private final InputStream input;
    private final OutputStream output;
    private final long limit;
    private final Thread worker;
    private final AtomicBoolean closed = new AtomicBoolean();

    private PreviewLogSink(InputStream input, OutputStream output, long limit) {
        this.input = input;
        this.output = output;
        this.limit = limit;
        worker = new Thread(this::drain, "preview-log-drain");
        worker.setDaemon(true);
    }

    static PreviewLogSink start(InputStream input, Path file, long limit) throws IOException {
        if (limit < 16384) throw new IllegalArgumentException("log limit too small");
        OutputStream output = Files.newOutputStream(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
        var sink = new PreviewLogSink(input, output, limit);
        sink.worker.start();
        return sink;
    }

    private void drain() {
        long written = 0;
        boolean writable = true;
        byte[] buffer = new byte[8192];
        try {
            int count;
            while (!closed.get() && (count = input.read(buffer)) != -1) {
                if (!writable || written == limit) continue;
                int retained = (int) Math.min(count, limit - written);
                try { output.write(buffer, 0, retained); output.flush(); written += retained; }
                catch (IOException failure) { writable = false; }
            }
        } catch (IOException ignored) {
        } finally {
            try { output.close(); } catch (IOException ignored) { }
            try { input.close(); } catch (IOException ignored) { }
        }
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        try { input.close(); } catch (IOException ignored) { }
        try { output.close(); } catch (IOException ignored) { }
        boolean interrupted = Thread.interrupted();
        try { worker.join(1000); } catch (InterruptedException failure) { interrupted = true; }
        if (interrupted) Thread.currentThread().interrupt();
    }
}

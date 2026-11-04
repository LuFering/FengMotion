package com.fengmotion.server.task.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

/** Linux 进程身份；无法确定身份时宁可不恢复，也不猜测其他实例是否仍在执行。 */
record ExecutionOwner(String machine, String boot, String namespace, String uid, long pid, Instant startedAt) {
    static Optional<ExecutionOwner> current() {
        try {
            String machine = Files.readString(Path.of("/etc/machine-id")).trim();
            String boot = Files.readString(Path.of("/proc/sys/kernel/random/boot_id")).trim();
            String namespace = Files.readSymbolicLink(Path.of("/proc/self/ns/pid")).toString();
            String uid = Files.readAllLines(Path.of("/proc/self/status")).stream()
                    .filter(line -> line.startsWith("Uid:"))
                    .map(line -> line.substring(4).trim().split("\\s+")[1])
                    .findFirst().orElse("");
            ProcessHandle process = ProcessHandle.current();
            Optional<Instant> start = process.info().startInstant();
            if (machine.isEmpty() || boot.isEmpty() || namespace.isEmpty() || uid.isEmpty() || start.isEmpty()) return Optional.empty();
            return Optional.of(new ExecutionOwner(machine, boot, namespace, uid, process.pid(), start.get()));
        } catch (IOException | RuntimeException unavailable) {
            return Optional.empty();
        }
    }

    String encode() {
        return String.join("|", "v1", machine, boot, namespace, uid, Long.toString(pid), startedAt.toString());
    }

    static Optional<ExecutionOwner> decode(String value) {
        if (value == null) return Optional.empty();
        String[] parts = value.split("\\|", -1);
        if (parts.length != 7 || !"v1".equals(parts[0]) || parts[1].isEmpty()
                || parts[2].isEmpty() || parts[3].isEmpty() || parts[4].isEmpty()) return Optional.empty();
        try {
            long pid = Long.parseLong(parts[5]);
            if (pid <= 0) return Optional.empty();
            return Optional.of(new ExecutionOwner(parts[1], parts[2], parts[3], parts[4], pid, Instant.parse(parts[6])));
        } catch (RuntimeException invalid) {
            return Optional.empty();
        }
    }

    /** 只判断相同主机、启动周期和 PID 命名空间；身份不完整或不可读取时保持未知。 */
    boolean definitelyStoppedComparedTo(ExecutionOwner local) {
        if (!machine.equals(local.machine) || !boot.equals(local.boot) || !namespace.equals(local.namespace) || !uid.equals(local.uid)) return false;
        try {
            Optional<ProcessHandle> candidate = ProcessHandle.of(pid);
            if (candidate.isEmpty() || !candidate.get().isAlive()) return true;
            // PID 可能已复用；即使启动时间不同也不冒险收尾，留待人工核实。
            return false;
        } catch (SecurityException unavailable) {
            return false;
        }
    }
}

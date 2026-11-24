package com.fengmotion.server.config;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

public final class BackendDataLease implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override public void initialize(ConfigurableApplicationContext context) {
        try {
            Files.createDirectories(Path.of(context.getEnvironment().getProperty("fengmotion.data-dir",System.getProperty("user.home")+"/.config/FengMotion/data")));
            Files.createDirectories(Path.of(context.getEnvironment().getProperty("fengmotion.workspace-root",System.getProperty("user.home")+"/FengMotion/projects")));
        } catch(IOException failure) { throw new IllegalStateException("无法准备后端运行目录",failure); }
        String url=context.getEnvironment().getProperty("spring.datasource.url","");
        if (!url.startsWith("jdbc:sqlite:") || url.equals("jdbc:sqlite::memory:")) return;
        String database=url.substring("jdbc:sqlite:".length());
        if (database.startsWith("file:")) throw new IllegalStateException("SQLite URI requires an explicit local database path");
        Lease lease=acquire(Path.of(database));
        context.getBeanFactory().registerSingleton("backendDataLease",lease);
        ((org.springframework.beans.factory.support.DefaultSingletonBeanRegistry)context.getBeanFactory())
                .registerDisposableBean("backendDataLease",lease::close);
        context.addBeanFactoryPostProcessor(factory -> {
            for(String name:factory.getBeanDefinitionNames()) {
                var definition=factory.getBeanDefinition(name);
                var existing=definition.getDependsOn();
                var dependencies=new java.util.ArrayList<String>();
                if(existing!=null) dependencies.addAll(java.util.List.of(existing));
                dependencies.add("backendDataLease");
                definition.setDependsOn(dependencies.toArray(String[]::new));
            }
        });
    }

    public static Lease acquire(Path database) {
        FileChannel channel=null;
        try {
            Path absolute=database.toAbsolutePath().normalize();
            Files.createDirectories(absolute.getParent());
            if(Files.isSymbolicLink(absolute)) throw new IOException("database path cannot be a symlink");
            Path realParent=absolute.getParent().toRealPath();
            Path file=realParent.resolve(absolute.getFileName()+".backend.lock");
            if(Files.isSymbolicLink(file)) throw new IOException("invalid backend lock path");
            channel=FileChannel.open(file,StandardOpenOption.CREATE,StandardOpenOption.WRITE,java.nio.file.LinkOption.NOFOLLOW_LINKS);
            FileLock lock=channel.tryLock();
            if(lock==null) throw new IOException("backend already running");
            return new Lease(channel,lock);
        } catch(IOException | OverlappingFileLockException failure) {
            try { if(channel!=null) channel.close(); } catch(IOException ignored) { }
            throw new IllegalStateException("同一数据库已有后端占用，或无法取得数据锁；请关闭已有实例后重试",failure);
        }
    }

    public static final class Lease implements AutoCloseable {
        private final FileChannel channel;
        private final FileLock lock;
        private Lease(FileChannel channel,FileLock lock) { this.channel=channel;this.lock=lock; }
        @Override public void close() {
            try { if(lock.isValid()) lock.release(); } catch(IOException ignored) { }
            try { channel.close(); } catch(IOException ignored) { }
        }
    }
}

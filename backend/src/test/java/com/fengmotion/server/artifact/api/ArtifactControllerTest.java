package com.fengmotion.server.artifact.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 产物列表。
 *
 * <p>重点在「如实反映磁盘」：真实的文件要列出来，隐藏文件与依赖目录要跳过，
 * 目录不存在时不能报 500 —— 那会让「还没产出」看起来像「坏了」。</p>
 */
@DisplayName("产物列表")
class ArtifactControllerTest {

    @TempDir
    Path projectDir;

    @Test void refusesFileAndDirectorySymlinksForReadAndUpload() throws Exception {
        Path outside=Files.createTempDirectory("fm-artifact-outside-");
        try {
            Path secret=Files.writeString(outside.resolve("secret.txt"),"private");
            Files.createSymbolicLink(projectDir.resolve("secret.txt"),secret);
            Files.createSymbolicLink(projectDir.resolve("exports"),outside);
            var controller=new ArtifactController(repoOf("p1",projectDir.toString()));
            assertThrows(ApiException.class,()->controller.content("p1","secret.txt"));
            assertTrue(controller.list("p1").items().isEmpty());
            var file=new org.springframework.mock.web.MockMultipartFile("file","safe.txt","text/plain","upload".getBytes());
            assertThrows(ApiException.class,()->controller.upload("p1",file,"exports"));
            assertEquals("private",Files.readString(secret));
            try(var files=Files.list(outside)) { assertEquals(1,files.count()); }
        } finally {
            Files.deleteIfExists(outside.resolve("secret.txt"));
            Files.deleteIfExists(outside);
        }
    }

    /** 只实现 findById 的假仓储，避免引入完整持久化依赖。 */
    private ProjectRepository repoOf(String projectId, String rootPath) {
        return new ProjectRepository() {
            @Override public void save(Project project) { }
            @Override public Optional<Project> findById(String id) {
                return projectId.equals(id)
                        ? Optional.of(new Project(projectId, "测试项目", "explainer",
                                null, rootPath, Instant.now()))
                        : Optional.empty();
            }
        };
    }

    @Test
    @DisplayName("列出真实文件，按修改时间倒序")
    void listsRealFiles() throws Exception {
        Files.writeString(projectDir.resolve("成片.mp4"), "fake video");
        Files.writeString(projectDir.resolve("脚本.md"), "fake script");
        Files.createDirectories(projectDir.resolve("素材"));
        Files.writeString(projectDir.resolve("素材/logo.png"), "fake image");

        var response = new ArtifactController(repoOf("p1", projectDir.toString())).list("p1");

        assertEquals(3, response.items().size(), "三个文件都应列出");
        assertEquals(projectDir.toString(), response.rootPath());
        // 分类正确
        assertTrue(response.items().stream().anyMatch(a -> a.kind().equals("video")));
        assertTrue(response.items().stream().anyMatch(a -> a.kind().equals("image")));
        assertTrue(response.items().stream().anyMatch(a -> a.name().equals("logo.png")));
        // 相对路径带目录，便于界面显示层级
        assertTrue(response.items().stream().anyMatch(a -> a.path().equals("素材/logo.png")));
    }

    @Test void latestArtifactIsNotLostWhenTheDirectoryContainsMoreThanTheOldScanLimit() throws Exception {
        for (int index = 0; index < 1000; index++) {
            Path file = Files.writeString(projectDir.resolve("artifact-" + index + ".txt"), "fixture");
            Files.setLastModifiedTime(file, java.nio.file.attribute.FileTime.fromMillis(1000L + index));
        }
        Path latest = Files.writeString(projectDir.resolve("latest.mp4"), "latest");
        Files.setLastModifiedTime(latest, java.nio.file.attribute.FileTime.fromMillis(5000));
        Path hidden = Files.createDirectories(projectDir.resolve("node_modules/nested"));
        Files.writeString(hidden.resolve("not-an-artifact.txt"), "dependency");
        var response = new ArtifactController(repoOf("p1", projectDir.toString())).list("p1");
        assertEquals(200, response.items().size());
        assertEquals("latest.mp4", response.items().getFirst().path());
        assertFalse(response.items().stream().anyMatch(item -> item.path().startsWith("node_modules")));
        assertEquals("artifact-801.txt", response.items().getLast().path());
    }

    @Test
    @DisplayName("隐藏文件与 node_modules 被跳过")
    void skipsHiddenAndDependencies() throws Exception {
        Files.writeString(projectDir.resolve("keep.txt"), "x");
        Files.writeString(projectDir.resolve(".env"), "secret");
        Files.createDirectories(projectDir.resolve("node_modules/pkg"));
        Files.writeString(projectDir.resolve("node_modules/pkg/index.js"), "x");

        var response = new ArtifactController(repoOf("p1", projectDir.toString())).list("p1");

        assertEquals(1, response.items().size(), "只应列出 keep.txt");
        assertEquals("keep.txt", response.items().get(0).name());
    }

    @Test
    @DisplayName("目录不存在时返回空列表而不是报错")
    void missingDirectoryYieldsEmptyList() {
        var response = new ArtifactController(repoOf("p1", projectDir.resolve("不存在").toString())).list("p1");

        assertTrue(response.items().isEmpty());
    }

    @Test
    @DisplayName("项目没有根目录时返回空列表")
    void projectWithoutRootYieldsEmptyList() {
        var response = new ArtifactController(repoOf("p1", null)).list("p1");

        assertTrue(response.items().isEmpty());
        assertEquals(null, response.rootPath());
    }

    @Test
    @DisplayName("能读取产物文件本体")
    void servesFileContent() throws Exception {
        Files.writeString(projectDir.resolve("片子.mp4"), "fake-video-bytes");

        var response = new ArtifactController(repoOf("p1", projectDir.toString()))
                .content("p1", "片子.mp4");

        assertEquals(200, response.getStatusCode().value());
        assertEquals("video/mp4", response.getHeaders().getContentType().toString());
        assertTrue(response.getBody().exists());
    }

    @Test
    @DisplayName("上传产物写入 renders/，同名不覆盖")
    void uploadWritesIntoRenders() throws Exception {
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));

        var first = controller.upload("p1",
                new org.springframework.mock.web.MockMultipartFile("file", "out.mp4", "video/mp4", new byte[] {1}),
                "renders");
        assertEquals("renders/out.mp4", first.path());

        // 同名再传：加时间戳前缀，保留两份（编辑器可能重复导出同一场景）
        var second = controller.upload("p1",
                new org.springframework.mock.web.MockMultipartFile("file", "out.mp4", "video/mp4", new byte[] {2}),
                "renders");
        assertTrue(second.path().startsWith("renders/"), "仍应在 renders 下");
        assertTrue(second.name().endsWith("out.mp4"));
        assertTrue(!second.name().equals("out.mp4"), "同名应加前缀而不是覆盖");
    }

    @Test void uploadingArtifactIsNotVisibleBeforeItsStreamCompletes() throws Exception {
        var controller=new ArtifactController(repoOf("p1",projectDir.toString()));
        var file=org.mockito.Mockito.mock(org.springframework.web.multipart.MultipartFile.class);
        org.mockito.Mockito.when(file.isEmpty()).thenReturn(false);
        org.mockito.Mockito.when(file.getOriginalFilename()).thenReturn("unfinished.mp4");
        org.mockito.Mockito.when(file.getInputStream()).thenReturn(new java.io.InputStream() {
            boolean first=true;
            @Override public int read() throws java.io.IOException {
                assertTrue(controller.list("p1").items().isEmpty());
                if(first) {first=false;return 1;}
                throw new java.io.IOException("upload interrupted");
            }
        });
        assertThrows(ApiException.class,()->controller.upload("p1",file,"renders"));
        assertTrue(controller.list("p1").items().isEmpty());
        try(var files=Files.list(projectDir.resolve("renders"))) {assertEquals(0,files.count());}
    }

    @Test void internalTemporaryFilesCannotBeReadAsArtifacts() throws Exception {
        Path hidden = Files.createDirectories(projectDir.resolve("renders"));
        Files.writeString(hidden.resolve(".artifact-upload-private.tmp"), "partial");
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));
        assertEquals("not_found", assertThrows(ApiException.class,
                () -> controller.content("p1", "renders/.artifact-upload-private.tmp")).getCode());
        Path control = Files.createDirectory(projectDir.resolve(".fengmotion"));
        Files.writeString(control.resolve("internal.json"), "private");
        assertEquals("not_found", assertThrows(ApiException.class,
                () -> controller.content("p1", ".fengmotion/internal.json")).getCode());
    }

    @Test
    @DisplayName("上传只允许 renders 与 exports 两个目录")
    void uploadRejectsOtherSubdirs() {
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));
        var file = new org.springframework.mock.web.MockMultipartFile("file", "a.mp4", "video/mp4", new byte[] {1});

        assertThrows(ApiException.class, () -> controller.upload("p1", file, "../evil"));
        assertThrows(ApiException.class, () -> controller.upload("p1", file, "src"));
    }

    @Test
    @DisplayName("上传的带路径文件名被剥离")
    void uploadStripsPathFromFilename() throws Exception {
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));
        var file = new org.springframework.mock.web.MockMultipartFile(
                "file", "../../etc/passwd.mp4", "video/mp4", new byte[] {1});

        var saved = controller.upload("p1", file, "renders");

        assertEquals("renders/passwd.mp4", saved.path(), "只保留文件名，不能穿出 renders/");
    }

    @Test
    @DisplayName("路径穿越被拒绝：不能读到项目目录之外")
    void rejectsPathTraversal() throws Exception {
        // 在项目目录的**外面**放一个文件，若校验失效就会被读到
        Path outside = projectDir.getParent().resolve("secret.txt");
        Files.writeString(outside, "top-secret");

        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));

        // 经典穿越、多重斜杠、绝对路径三种写法都要挡住
        assertThrows(ApiException.class, () -> controller.content("p1", "../secret.txt"));
        assertThrows(ApiException.class, () -> controller.content("p1", "....//secret.txt"));
        assertThrows(ApiException.class, () -> controller.content("p1", outside.toString()));
    }

    @Test
    @DisplayName("产物不存在时 404 而不是 500")
    void missingArtifactIs404() {
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));

        assertThrows(ApiException.class, () -> controller.content("p1", "不存在.mp4"));
    }

    @Test
    @DisplayName("项目不存在时 404")
    void unknownProjectIs404() {
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));

        assertThrows(ApiException.class, () -> controller.list("不存在的项目"));
    }
}

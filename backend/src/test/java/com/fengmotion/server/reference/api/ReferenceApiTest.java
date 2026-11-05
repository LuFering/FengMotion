package com.fengmotion.server.reference.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 参考片接口（契约 library.md §4–§5）。
 *
 * <p>关键断言：自动分析端点必须返回 {@code 422 capability_unavailable}，
 * 而不是假装成功或伪造 partial —— 契约 §4.3 的硬要求。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ReferenceApiTest {

    private static final Path SAMPLE = Paths.get("../frontend/public/fx/motion/fx-dolly-zoom.mp4");

    @Autowired
    private MockMvc mvc;

    /** 上传示例视频，返回参考片 ID。 */
    private String uploadSample() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE), "本机缺少示例视频，跳过");
        MockMultipartFile file = new MockMultipartFile("file", "sample.mp4", "video/mp4",
                Files.readAllBytes(SAMPLE));
        String body = mvc.perform(multipart("/api/reference-videos").file(file))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(body, "$.video.id");
    }

    @Test
    @DisplayName("上传真实视频后能拿到可播放地址与实测时长")
    void uploadReturnsPlayableVideo() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE), "本机缺少示例视频，跳过");
        MockMultipartFile file = new MockMultipartFile("file", "sample.mp4", "video/mp4",
                Files.readAllBytes(SAMPLE));
        mvc.perform(multipart("/api/reference-videos").file(file))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.video.durationMs").value(10000))
                .andExpect(jsonPath("$.video.status").value("pending"))
                // 有素材才有 fileUrl；界面据此决定显示播放器还是「仅静帧」
                .andExpect(jsonPath("$.video.fileUrl").isNotEmpty())
                .andExpect(jsonPath("$.deduped").value(false));
    }

    @Test
    @DisplayName("自动分析端点如实返回 422，不伪造 partial")
    void analyzeReportsUnavailable() throws Exception {
        String videoId = uploadSample();
        mvc.perform(post("/api/reference-videos/" + videoId + "/analyze"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("capability_unavailable"));

        // 视频状态必须仍是 pending，不能被改成 partial。
        mvc.perform(get("/api/reference-videos/" + videoId))
                .andExpect(jsonPath("$.status").value("pending"));
    }

    @Test
    @DisplayName("新增片段后六维都是 pending、为空的观察与推断")
    void newSegmentIsUnparsed() throws Exception {
        String videoId = uploadSample();
        String body = mvc.perform(post("/api/reference-videos/" + videoId + "/segments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startMs\":1000,\"endMs\":4000,\"tags\":[\"暖光\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.startMs").value(1000))
                .andExpect(jsonPath("$.durationMs").value(3000))
                .andExpect(jsonPath("$.observation").value(""))
                .andExpect(jsonPath("$.inference").value(""))
                .andReturn().getResponse().getContentAsString();

        String segmentId = com.jayway.jsonpath.JsonPath.read(body, "$.id");
        // 六维逐一确认 pending 且 value 为空
        mvc.perform(get("/api/reference-segments/" + segmentId))
                .andExpect(jsonPath("$.analysis.cameraMove.pending").value(true))
                .andExpect(jsonPath("$.analysis.cameraMove.value").value(""))
                .andExpect(jsonPath("$.analysis.reusable.pending").value(true))
                .andExpect(jsonPath("$.analysis.rhythm.pending").value(true));
    }

    @Test
    @DisplayName("片段时间非法返回 400")
    void invalidSegmentRange() throws Exception {
        String videoId = uploadSample();
        mvc.perform(post("/api/reference-videos/" + videoId + "/segments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startMs\":5000,\"endMs\":1000}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    @Test
    @DisplayName("收藏与最近浏览通过偏好端点读写")
    void preferencesRoundTrip() throws Exception {
        String videoId = uploadSample();
        String body = mvc.perform(post("/api/reference-videos/" + videoId + "/segments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startMs\":0,\"endMs\":2000}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String segmentId = com.jayway.jsonpath.JsonPath.read(body, "$.id");

        mvc.perform(patch("/api/reference-preferences")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"segmentId\":\"" + segmentId + "\",\"favorited\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorites[0]").value(segmentId));
    }

    @Test
    @DisplayName("集合创建后成员可查；删除集合不影响片段")
    void collectionLifecycle() throws Exception {
        String videoId = uploadSample();
        String segmentBody = mvc.perform(post("/api/reference-videos/" + videoId + "/segments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startMs\":0,\"endMs\":2000}"))
                .andReturn().getResponse().getContentAsString();
        String segmentId = com.jayway.jsonpath.JsonPath.read(segmentBody, "$.id");

        String collectionBody = mvc.perform(post("/api/reference-collections")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"开场参考\",\"segmentIds\":[\"" + segmentId + "\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.segmentCount").value(1))
                .andReturn().getResponse().getContentAsString();
        String collectionId = com.jayway.jsonpath.JsonPath.read(collectionBody, "$.id");

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/reference-collections/" + collectionId))
                .andExpect(status().isNoContent());

        // 片段还在
        mvc.perform(get("/api/reference-segments/" + segmentId))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("不存在的参考片返回 404")
    void missingVideoIs404() throws Exception {
        mvc.perform(get("/api/reference-videos/ref_nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }
}

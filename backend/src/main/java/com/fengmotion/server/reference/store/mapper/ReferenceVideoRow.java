package com.fengmotion.server.reference.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/** reference_videos 表的持久化行。 */
@Data
@NoArgsConstructor
public class ReferenceVideoRow {
    private String id;
    private String title;
    private Long durationMs;
    private String source;
    private String description;
    private String tagsJson;
    private String assetId;
    private String thumbnailUrl;
    private String status;
    private String createdAt;
    private String updatedAt;
    private Integer demo;
}

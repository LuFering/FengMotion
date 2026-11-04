package com.fengmotion.server.reference.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/** reference_segments 表的持久化行。 */
@Data
@NoArgsConstructor
public class ReferenceSegmentRow {
    private String id;
    private String videoId;
    private Integer idx;
    private Long startMs;
    private Long endMs;
    private String status;
    private String tagsJson;
    private String observation;
    private String inference;
    private String suggestion;
    private String analysisJson;
    private String extraAnalysisJson;
    private String createdAt;
    private String updatedAt;
}

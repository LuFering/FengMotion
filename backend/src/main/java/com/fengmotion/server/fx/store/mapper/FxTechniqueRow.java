package com.fengmotion.server.fx.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * fx_techniques 表的持久化行。
 *
 * <p>数组字段以 JSON 文本存放（{@code *_json}），枚举以 wire 字符串存放，
 * 时间以 ISO-8601 文本存放。转换在仓储层完成，Mapper 只管读写。</p>
 */
@Data
@NoArgsConstructor
public class FxTechniqueRow {
    private String id;
    private String name;
    private String nameEn;
    private String aliasesJson;
    private String keywordsJson;
    private String intent;
    private String category;
    private String categoryLabel;
    private String scenesJson;
    private String antiScenesJson;
    private String execType;
    private String execLabel;
    private String executionStatus;
    private String impl;
    private String implLabel;
    private Integer complexity;
    private String inputKindsJson;
    private String inputLabelsJson;
    private String inputRequirement;
    private String output;
    private String dependenciesJson;
    private String stepsJson;
    private String compatibilityJson;
    private String limitationsJson;
    private String failuresJson;
    private String paramsJson;
    private String previewImageUrl;
    private String previewVideoUrl;
    private String previewCaption;
    private String relatedJson;
    private String alternativesJson;
    private Integer featured;
    private String version;
    private String updatedAt;
    private Integer demo;
    private String sourceKind;
    private String sourceProject;
    private String sourceUrl;
    private String sourceVersion;
    private String licenseCode;
    private String licensePreview;
    private String attribution;
    private String sourcePath;
    private String importedAt;
}

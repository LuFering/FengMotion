package com.fengmotion.server.project.domain;

import com.fasterxml.jackson.databind.JsonNode;

/** 一个场景元素修改请求；基线字段必须来自调用方正在编辑的版本。 */
public record SceneElementEditRequest(Long baseVersion, String sourceHash, String elementId,
                                      JsonNode properties, String prompt) {
}

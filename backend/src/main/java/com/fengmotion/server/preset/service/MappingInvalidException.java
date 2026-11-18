package com.fengmotion.server.preset.service;

import java.util.List;

import org.springframework.http.HttpStatus;

import com.fengmotion.server.common.ApiException;

/** 映射没有通过校验：带上逐项的失败原因，前端据此告诉用户哪里不对。 */
public class MappingInvalidException extends ApiException {
    private final transient List<PresetMappingValidator.Problem> problems;

    public MappingInvalidException(String message, List<PresetMappingValidator.Problem> problems) {
        super(HttpStatus.UNPROCESSABLE_ENTITY, "mapping_invalid", message);
        this.problems = List.copyOf(problems);
    }

    public List<PresetMappingValidator.Problem> getProblems() {
        return problems;
    }
}

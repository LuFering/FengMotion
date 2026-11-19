package com.fengmotion.server.preset.service;

import java.io.IOException;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.client.DshDirectTextModel;
import com.fengmotion.server.harness.config.HarnessProperties;

import lombok.extern.slf4j.Slf4j;

/**
 * 用 {@link DshDirectTextModel} 生成映射：一次独立的模型调用，不创建 agent，没有任何工具。
 * 模型与供应方沿用 harness 配置。
 */
@Slf4j
@Component
public class DshPresetMappingModel implements PresetMappingModel {

    private final DshDirectTextModel model;
    private final HarnessProperties properties;
    private final long timeoutMs;
    private final String provider;
    private final String modelId;

    public DshPresetMappingModel(DshDirectTextModel model, HarnessProperties properties,
                                 @Value("${fengmotion.preset.mapping-timeout-ms:120000}") long timeoutMs,
                                 @Value("${fengmotion.preset.mapping-provider:}") String provider,
                                 @Value("${fengmotion.preset.mapping-model:}") String modelId) {
        this.model = model;
        this.properties = properties;
        this.timeoutMs = timeoutMs;
        this.provider = provider == null || provider.isBlank() ? properties.getProvider() : provider.strip();
        this.modelId = modelId == null || modelId.isBlank() ? properties.getModel() : modelId.strip();
    }

    @Override
    public String generate(String system, String prompt) {
        try {
            return model.generate(new DshDirectTextModel.Request(provider, modelId,
                    system, prompt, 12_000, timeoutMs)).text();
        } catch (IOException failed) {
            log.warn("映射生成失败：{}", failed.getMessage());
            String message = "DSH_DISABLED".equals(failed.getMessage())
                    ? "模型未接入，无法生成映射"
                    : "模型调用失败，请稍后重试";
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "model_unavailable", message);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "model_unavailable", "模型调用被中断");
        }
    }
}

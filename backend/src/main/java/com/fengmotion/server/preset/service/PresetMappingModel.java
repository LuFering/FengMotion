package com.fengmotion.server.preset.service;

/**
 * 生成映射所用的模型调用。抽成接口是为了测试不调用真实模型。
 *
 * <p>实现必须是没有工具权限的纯文本调用：skill 内容作为文本传入，模型不能读写文件或执行命令。</p>
 */
public interface PresetMappingModel {
    default boolean available() { return true; }

    /**
     * @param system 系统提示
     * @param prompt 用户提示（含 skill 内容）
     * @return 模型输出原文
     * @throws com.fengmotion.server.common.ApiException 模型未接入或调用失败（503）
     */
    String generate(String system, String prompt);
}

package com.fengmotion.server.task.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * 选择用哪个修改方案生成器。
 *
 * <p>两套实现同时存在是有意的：</p>
 * <ul>
 *   <li>{@code rule}：确定性规则，不依赖模型，行为可预测，适合自测与离线演示</li>
 *   <li>{@code model}：能理解更自由的说法，但依赖模型可用性与输出质量</li>
 * </ul>
 *
 * <p>默认用 {@code rule}：模型不可用时若默认走模型，用户提交会直接失败，
 * 而规则式至少能覆盖最常见的文字/颜色修改。<b>切换只需改配置项
 * {@code fengmotion.modify.planner}，不用改代码。</b></p>
 */
@Configuration
public class ModifyPlannerConfig {

    /**
     * 当前生效的生成器。
     *
     * @param mode   配置值：rule / model
     * @param rule   规则式实现
     * @param model  模型实现
     * @return 选中的实现
     */
    @Bean
    @Primary
    public ModifyPlanner activeModifyPlanner(
            @Value("${fengmotion.modify.planner:rule}") String mode,
            MockModifyExecutor rule,
            ModelModifyPlanner model) {
        return "model".equalsIgnoreCase(mode == null ? "" : mode.trim()) ? model : rule;
    }
}

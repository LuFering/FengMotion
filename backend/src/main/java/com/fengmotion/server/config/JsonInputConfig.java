package com.fengmotion.server.config;

import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;

@Configuration
public class JsonInputConfig {
    @Bean
    public Jackson2ObjectMapperBuilderCustomizer strictJsonInput() {
        return builder -> builder.featuresToDisable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .featuresToEnable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }
}

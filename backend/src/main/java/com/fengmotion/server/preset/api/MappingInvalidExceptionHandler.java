package com.fengmotion.server.preset.api;

import java.util.Map;
import java.util.UUID;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.fengmotion.server.preset.service.MappingInvalidException;

@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class MappingInvalidExceptionHandler {
    @ExceptionHandler(MappingInvalidException.class)
    public ResponseEntity<Map<String, Object>> handle(MappingInvalidException failure) {
        return ResponseEntity.status(failure.getStatus()).body(Map.of("error", Map.of(
                "code", failure.getCode(),
                "message", failure.getMessage(),
                "requestId", "req_" + UUID.randomUUID(),
                "problems", failure.getProblems())));
    }
}

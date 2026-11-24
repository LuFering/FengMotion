package com.fengmotion.server.common;

import org.springframework.http.HttpStatus;

/**
 * 业务异常：由 service 层抛出，由 {@link ApiExceptionHandler} 统一转成响应体。
 *
 * 三个字段对应协议 7 节的错误约定：HTTP 状态 + 稳定错误码 + 人话消息。
 * 错误码只增不改义，前端按 code 分支，不要按 message 匹配。
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final java.util.Map<String, Object> details;

    public ApiException(HttpStatus status, String code, String message) {
        this(status, code, message, java.util.Map.of());
    }

    public ApiException(HttpStatus status, String code, String message, java.util.Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = java.util.Map.copyOf(details);
    }

    /** HTTP 状态：404 找不到、409 状态冲突、400 参数不合法。 */
    public HttpStatus getStatus() {
        return status;
    }

    /** 稳定错误码（snake_case），供前端分支判断。 */
    public String getCode() {
        return code;
    }

    public java.util.Map<String, Object> getDetails() { return details; }
}

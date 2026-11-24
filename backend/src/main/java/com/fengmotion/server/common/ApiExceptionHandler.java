package com.fengmotion.server.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;
import java.util.UUID;

/**
 * 全局异常映射：把所有异常转换为统一错误信封 {@code { error: { code, message, requestId } }}。
 *
 * <p>错误码只增不改义（契约 README §2.4），前端按 code 分支，不按 message 匹配。
 * 响应中不暴露堆栈、SQL 或内部路径。</p>
 *
 * <p>这里只覆盖“可预期”的失败：业务异常、请求体/参数格式错误、数据库访问错误，
 * 以及未匹配路由与方法不支持（405）。未预期异常记录带请求标识的堆栈，
 * 响应使用固定错误信封而不泄露内部信息。</p>
 */
@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** 业务异常：状态、错误码与用户可读消息都由抛出方决定。 */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handle(ApiException ex) {
        if (ex.getDetails().isEmpty()) return error(ex.getStatus(), ex.getCode(), ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).cacheControl(org.springframework.http.CacheControl.noStore()).body(Map.of("error", Map.of(
                "code", ex.getCode(), "message", ex.getMessage(), "requestId", newRequestId(), "details", ex.getDetails())));
    }

    /** 请求体不是合法 JSON，或字段类型对不上。 */
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> malformedRequest(Exception ex) {
        return error(HttpStatus.BAD_REQUEST, "validation_error", "请求格式无效");
    }

    /** 路径/查询参数无法转换成目标类型（例如 limit=abc）。 */
    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> invalidParameter(Exception ex) {
        return error(HttpStatus.BAD_REQUEST, "validation_error", "请求参数无效");
    }

    /** 数据库访问失败：记录请求标识与异常，响应只给稳定错误码。 */
    @ExceptionHandler(org.springframework.dao.DataAccessException.class)
    public ResponseEntity<Map<String, Object>> dataAccessFailure(Exception ex) {
        String requestId = newRequestId();
        log.error("数据库访问失败：{}", requestId, ex);
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "服务内部错误", requestId);
    }

    /** 路由存在但不支持该方法（例如对只读资源发 PUT）。 */
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> methodNotAllowed(Exception ex) {
        return error(HttpStatus.METHOD_NOT_ALLOWED, "validation_error", "请求方法不受支持");
    }

    @ExceptionHandler(org.springframework.web.bind.MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String,Object>> missingParameter(Exception ex) {
        return error(HttpStatus.BAD_REQUEST,"validation_error","缺少必要请求参数");
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String,Object>> uploadTooLarge(Exception ex) {
        return error(HttpStatus.PAYLOAD_TOO_LARGE,"upload_too_large","上传文件超过大小限制");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String,Object>> unexpected(Exception ex) {
        String id=newRequestId();
        log.error("未预期后端错误 requestId={}",id,ex);
        return error(HttpStatus.INTERNAL_SERVER_ERROR,"internal_error","服务内部错误，请按请求标识核对日志",id);
    }

    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<Map<String,Object>> notFound(Exception ex) {
        return error(HttpStatus.NOT_FOUND,"not_found","接口或资源不存在");
    }

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<Map<String,Object>> responseStatus(org.springframework.web.server.ResponseStatusException ex) {
        HttpStatus status=HttpStatus.resolve(ex.getStatusCode().value());
        return error(status==null?HttpStatus.INTERNAL_SERVER_ERROR:status,
                ex.getStatusCode().value()==404?"not_found":"validation_error",ex.getReason()==null?"请求无法处理":ex.getReason());
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        return error(status, code, message, newRequestId());
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message,
            String requestId) {
        return ResponseEntity.status(status).cacheControl(org.springframework.http.CacheControl.noStore()).body(Map.of("error", Map.of(
                "code", code,
                "message", message,
                "requestId", requestId)));
    }

    private String newRequestId() {
        String traced=org.slf4j.MDC.get("requestId");
        return traced==null?"req_"+UUID.randomUUID():traced;
    }
}

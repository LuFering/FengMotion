/**
 * 公共层：跨域复用的错误与 Web 约定。
 *
 * - {@link com.fengmotion.server.common.ApiException}：业务错误（status + code + message）
 * - {@link com.fengmotion.server.common.ApiExceptionHandler}：把异常映射成 {code,message}
 *
 * 这里不放任何业务概念；业务错误码由各功能包自行定义后抛出。
 */
package com.fengmotion.server.common;

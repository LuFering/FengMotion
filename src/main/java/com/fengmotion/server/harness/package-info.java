/**
 * 执行引擎与模型（待接入）。
 *
 * 计划接口：
 *   GET /api/harnesses              引擎列表与可用性（由本机 CLI / 凭证探测得出）
 *   GET /api/harnesses/{id}/models  该引擎可用模型
 *
 * 落点：外部 CLI 探测放 harness/client，结果缓存放 harness/store，
 *      对外的 record 放 harness/domain。首页的引擎切换器直接消费这两个接口。
 */
package com.fengmotion.server.harness;

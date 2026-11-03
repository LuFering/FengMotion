/**
 * 附件上传（待接入）。
 *
 * 计划接口：
 *   POST /api/uploads   multipart，返回 { fileId, name, size, kind }
 *
 * 约束：限制单文件大小与 MIME；落盘目录由配置指定（默认 ~/.fengmotion/uploads）；
 *      任务创建时只携带 fileId，不携带路径。
 */
package com.fengmotion.server.upload;

package com.fengmotion.server.chat.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 发送消息的请求体（agent.md §3）。
 *
 * <p>这里只接收与保存，不在 DTO 上做业务校验：空文本、多个 target 引用等规则需要
 * 结合附件是否存在、引用结构共同判断，统一放在服务层，错误才能使用同一套错误码。</p>
 *
 * @param text        消息正文；可以为空，但此时必须带附件
 * @param references  结构化引用；可为空
 * @param attachments 附件元信息；可为空
 * @param constraints 直接下达的修改约束；服务端原样保存，暂不参与逻辑
 */
public record CreateChatMessageRequest(
        String text,
        JsonNode references,
        JsonNode attachments,
        JsonNode constraints) {
}

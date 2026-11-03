package com.fengmotion.server.project.api;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.api.dto.CreateProjectRequest;
import com.fengmotion.server.project.api.dto.ProjectDetail;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectCreationCoordinator;
import com.fengmotion.server.project.service.ProjectQueryService;
import com.fengmotion.server.project.service.ProjectUpdateService;

import lombok.RequiredArgsConstructor;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/**
 * 项目 HTTP 接口：接收请求参数，并将业务处理交给相应服务。
 *
 * <p>接口统一以 /api/projects 为路径前缀。参数校验、数据库访问等具体工作由服务层处理。</p>
 */
@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController { 
    
    // Lombok 生成包含这些 final 字段的构造方法，由 Spring 注入对应服务。
    private final ProjectCreationCoordinator creation; // 协调创建、事务和幂等处理
    private final ProjectQueryService query; // 查询项目详情及列表
    private final ProjectUpdateService update; // 更新与归档项目

    
    /**
     * 创建项目；提供有效幂等键时，相同请求的重试可以找到已有项目。
     *
     * @param request 请求体中的 JSON，由 @RequestBody 转换为创建请求对象
     * @param key 可选的 Idempotency-Key 请求头；不提供时为 null
     * @return 创建或重试得到的项目详情，HTTP 状态码为 201
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectDetail create(@RequestBody CreateProjectRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String key) { 

        // 创建项目，或在幂等重试时取得已有项目。
        Project project = creation.create(request, key);
        // 查询并组装面向前端的项目详情。
        return query.get(project.id());
    }

    /**
     * 分页查询项目列表。
     *
     * @param stage 可选的项目阶段
     * @param q 可选的名称或简介搜索词
     * @param sort 可选的排序方式
     * @param cursor 可选的分页游标
     * @param limit 每页数量，未指定时为 50
     * @return 当前页项目及下一页游标
     */
    @GetMapping
    public ProjectQueryService.Page list(@RequestParam(required = false) String stage,
            @RequestParam(required = false) String q, @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor, @RequestParam(defaultValue = "50") int limit) {
        return query.list(stage, q, sort, cursor, limit);
    }

    /**
     * 根据路径中的项目 ID 查询详情。
     *
     * @param id 项目 ID，由 @PathVariable 从路径中读取
     * @return 项目详情
     */
    @GetMapping("/{id}")
    public ProjectDetail get(@PathVariable String id) { return query.get(id); }

    /**
     * 更新请求体中指定的项目字段。
     *
     * @param id 项目 ID
     * @param etag If-Match 请求头中的版本标识；服务层会检查其是否有效
     * @param body 请求体转换成的字段名与字段值
     * @return 更新后的项目详情
     */
    @PatchMapping("/{id}")
    public ProjectDetail update(@PathVariable String id,
            @RequestHeader(value = "If-Match", required = false) String etag,
            @RequestBody Map<String, Object> body) {
        return update.update(id, etag, body);
    }

    /**
     * 删除项目：默认归档，{@code purge=true} 时请求物理删除。
     *
     * <p>归档只把项目移出查询结果，项目目录与数据保留；物理删除尚未接入，
     * 返回 {@code 422 capability_unavailable}，不静默降级成归档。</p>
     *
     * @param id 项目 ID
     * @param purge 是否请求物理删除，默认为 false（请求归档）
     */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@PathVariable String id, @RequestParam(defaultValue = "false") boolean purge) {
        if (purge) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "capability_unavailable", "物理删除尚未接入");
        }
        update.archive(id);
    }
}

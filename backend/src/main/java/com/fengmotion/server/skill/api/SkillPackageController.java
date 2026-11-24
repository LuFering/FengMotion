package com.fengmotion.server.skill.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.service.SkillPackageService;

import lombok.RequiredArgsConstructor;

/**
 * skill 包端点：导入（按固定 commit 只读落盘 + 静态清点）、列表、详情、删除。
 *
 * <p>导入不执行包内任何脚本，见 {@link SkillPackageService}。</p>
 */
@RestController
@RequestMapping("/api/skill-packages")
@RequiredArgsConstructor
public class SkillPackageController {

    private final SkillPackageService service;

    @PostMapping("/import")
    public ImportResponse importPackage(@RequestBody(required = false) ImportRequest request) {
        if (request == null) throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少请求体");
        var outcome = service.importPackage(request.repository(), request.ref(), request.path());
        return new ImportResponse(outcome.reused(), outcome.skillPackage());
    }

    /** 列表不含报告正文（{@code report} 为 null），详情再取。 */
    @GetMapping
    public List<SkillPackage> list() {
        return service.list();
    }

    /**
     * 导入前预检：参数与导入请求体相同，只把 ref 解析成 commit，不下载、不落盘。
     * 每次调用消耗一次 GitHub 额度，前端负责防抖。
     */
    @GetMapping("/resolve")
    public SkillPackageService.Resolution resolve(@RequestParam(required = false) String repository,
                                                  @RequestParam(required = false) String ref,
                                                  @RequestParam(required = false) String path) {
        return service.resolve(repository, ref, path);
    }

    @GetMapping("/{id}")
    public SkillPackage get(@PathVariable String id) {
        return service.get(id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        service.delete(id);
    }

    /**
     * 导入请求。
     *
     * @param repository {@code owner/repo} 或 GitHub 地址
     * @param ref        分支 / 标签 / commit，可省略
     * @param path       只导入的子目录，可省略
     */
    public record ImportRequest(String repository, String ref, String path) {
    }

    /**
     * 导入结果。
     *
     * @param reused       同一 commit 已导入过，返回的是已有记录
     * @param skillPackage 包与完整报告
     */
    public record ImportResponse(boolean reused, SkillPackage skillPackage) {
    }
}

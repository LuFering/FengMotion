package com.fengmotion.server.asset.service;

import java.util.List;

import org.springframework.stereotype.Service;

import com.fengmotion.server.asset.store.mapper.ResourceRefMapper;
import com.fengmotion.server.asset.store.mapper.ResourceRefMapper.RefRow;

/**
 * 资源引用：记录「这个素材被哪个项目 / 工作流 / 任务用了」，并在删除前拦下来。
 *
 * <p>为什么要由后端拦：用户删素材时如果只是删掉索引，而被引用的项目仍在用这个文件，
 * 打开项目就会看到一个打不开的画面 —— 而且已经无法从界面追溯是哪一步删掉的。
 * 返回 409 并列出引用方，让用户自己决定先解绑还是继续删。</p>
 */
@Service
public class ResourceRefService {

    /** 资源种类常量：目前只有素材，后续特效/参考片复用同一张表。 */
    public static final String KIND_ASSET = "asset";

    private final ResourceRefMapper refs;

    public ResourceRefService(ResourceRefMapper refs) {
        this.refs = refs;
    }

    /** 某个资源的全部引用方。 */
    public List<RefRow> find(String resourceKind, String resourceId) {
        return refs.findByResource(resourceKind, resourceId);
    }

    /** 某个资源是否被引用（删除前的判定入口）。 */
    public boolean hasRefs(String resourceKind, String resourceId) {
        return refs.countByResource(resourceKind, resourceId) > 0;
    }

    /** 记录一条引用；重复记录幂等。 */
    public void add(String resourceKind, String resourceId, String refKind, String refId, String refLabel,
            String createdAt) {
        RefRow row = new RefRow();
        row.setResourceKind(resourceKind);
        row.setResourceId(resourceId);
        row.setRefKind(refKind);
        row.setRefId(refId);
        row.setRefLabel(refLabel);
        row.setCreatedAt(createdAt);
        refs.insert(row);
    }

    /** 资源被删除后清理其引用记录。 */
    public void clear(String resourceKind, String resourceId) {
        refs.deleteByResource(resourceKind, resourceId);
    }
}

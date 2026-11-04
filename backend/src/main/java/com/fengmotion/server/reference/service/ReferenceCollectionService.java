package com.fengmotion.server.reference.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.reference.domain.ReferenceCollection;
import com.fengmotion.server.reference.store.ReferenceRepository;

/**
 * 参考集合：用户对片段的整理。
 *
 * <p>删除集合**不删片段**：片段属于视频，不属于集合。删一个用于归类的集合，
 * 不该顺手把用户标好的片段也删了。</p>
 *
 * <p>成员里不存在的片段 ID 会被拒绝而不是静默丢弃 —— 静默丢弃会让用户以为
 * 「加进去了」，实际没加。</p>
 */
@Service
public class ReferenceCollectionService {

    private final ReferenceRepository repository;

    public ReferenceCollectionService(ReferenceRepository repository) {
        this.repository = repository;
    }

    /** 集合列表（含成员）。 */
    public List<ReferenceCollection> list() {
        return repository.listCollections();
    }

    public ReferenceCollection require(String id) {
        return repository.findCollection(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "集合不存在"));
    }

    @Transactional
    public ReferenceCollection create(String name, String note, List<String> segmentIds) {
        String trimmed = requireName(name);
        List<String> members = validateMembers(segmentIds);
        Instant now = Instant.now();
        return repository.saveCollection(new ReferenceCollection(
                "col_" + UUID.randomUUID(), trimmed, note == null ? "" : note, members, now, now));
    }

    /**
     * 更新集合。
     *
     * @param segmentIds 新的成员列表；null 表示不改成员
     */
    @Transactional
    public ReferenceCollection update(String id, String name, String note, List<String> segmentIds) {
        ReferenceCollection current = require(id);
        String nextName = name == null ? current.name() : requireName(name);
        String nextNote = note == null ? current.note() : note;
        List<String> nextMembers = segmentIds == null ? current.segmentIds() : validateMembers(segmentIds);
        return repository.updateCollection(new ReferenceCollection(
                current.id(), nextName, nextNote, nextMembers, current.createdAt(), Instant.now()));
    }

    /** 删除集合；成员关系随之清理，片段本身保留。 */
    @Transactional
    public void delete(String id) {
        require(id);
        repository.deleteCollection(id);
    }

    /**
     * 校验成员存在。
     *
     * <p>逐个查库确认片段真的存在：前端可能拿着已删除片段的 ID 提交，
     * 静默忽略会让集合看起来「加进去了但列表里没有」。</p>
     */
    private List<String> validateMembers(List<String> segmentIds) {
        if (segmentIds == null || segmentIds.isEmpty()) {
            return List.of();
        }
        List<String> valid = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (String segmentId : segmentIds) {
            if (repository.findSegment(segmentId).isPresent()) {
                valid.add(segmentId);
            } else {
                missing.add(segmentId);
            }
        }
        if (!missing.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "以下片段不存在：" + String.join(", ", missing));
        }
        return valid;
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "集合名不能为空");
        }
        return name.trim();
    }
}

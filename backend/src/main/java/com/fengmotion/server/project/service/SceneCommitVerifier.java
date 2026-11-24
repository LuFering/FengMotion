package com.fengmotion.server.project.service;

import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectSceneRepository;

public final class SceneCommitVerifier {
    private SceneCommitVerifier() { }

    public static Optional<Long> commit(ProjectSceneRepository scenes,String projectId,long baseVersion,JsonNode film,
                                         String artifact,Supplier<Optional<Long>> write) {
        try { return write.get(); }
        catch(RuntimeException failure) {
            if (failure instanceof ApiException api && api.getCode().equals("scene_history_conflict")) throw failure;
            try {
                var saved=scenes.findVersion(projectId,baseVersion+1);
                if(saved.isPresent() && Objects.equals(artifact,saved.get().artifactPath()) && sameJson(film,saved.get().film())) {
                    return Optional.of(saved.get().version());
                }
            } catch(RuntimeException unreadable) {
                failure.addSuppressed(unreadable);
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"scene_commit_unknown","版本提交结果暂时无法核实，已保留源码、恢复日志和产物；请恢复连接后查询，不要自动重做");
            }
            throw failure;
        }
    }

    public static boolean uncertain(Throwable failure) {
        return failure instanceof ApiException api && api.getCode().equals("scene_commit_unknown");
    }

    private static boolean sameJson(JsonNode first,JsonNode second) {
        return first!=null && second!=null && first.equals((left,right)->left.isNumber() && right.isNumber()
                ? left.decimalValue().compareTo(right.decimalValue()) : left.equals(right)?0:1,second);
    }
}

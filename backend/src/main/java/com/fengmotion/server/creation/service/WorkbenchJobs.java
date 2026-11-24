package com.fengmotion.server.creation.service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import jakarta.annotation.PreDestroy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ShotCandidateRequest;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.LocalStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class WorkbenchJobs {
    private static final String NAMESPACE="workbench-job";
    private final LocalStateStore documents;
    private final ProjectRepository projects;
    private final ProjectOperationLock operations;
    private final ProjectTimelineService timelines;
    private final ShotCandidateService candidates;
    private final ObjectMapper json;
    private final Map<String,Execution> active=new ConcurrentHashMap<>();
    private final ThreadPoolExecutor executor=new ThreadPoolExecutor(2,2,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(20),new ThreadPoolExecutor.AbortPolicy());
    private boolean closed;
    @org.springframework.beans.factory.annotation.Autowired
    private VersionVerificationService verification;
    @org.springframework.beans.factory.annotation.Autowired
    private VersionExportService exports;

    public record Request(String requestId,String kind,String artifactPath,Long version,String candidateId,ShotCandidateRequest candidate,
                          String reviewId, String videoHash) {
        public Request(String requestId, String kind, String artifactPath, Long version, String candidateId, ShotCandidateRequest candidate) {
            this(requestId, kind, artifactPath, version, candidateId, candidate, null, null);
        }
    }
    public record Job(String projectId,String requestId,String kind,String state,JsonNode result,String errorCode,String error,String createdAt) { }

    public synchronized Job submit(String projectId,Request request) {
        validate(request);
        var saved=documents.find(NAMESPACE,request.requestId());
        if(saved.isPresent()) {
            if(!projectId.equals(saved.get().projectId()) || !request.equals(json.convertValue(saved.get().data().path("request"),Request.class)))
                throw error(HttpStatus.CONFLICT,"task_idempotency_conflict","请求 ID 已用于其他工作台操作");
            return get(projectId,request.requestId());
        }
        if(closed) throw error(HttpStatus.SERVICE_UNAVAILABLE,"workbench_stopping","服务正在关闭");
        var lease=operations.participate(projectId);
        boolean submitted=false;
        try {
            projects.findById(projectId).orElseThrow(()->error(HttpStatus.NOT_FOUND,"not_found","项目不存在"));
            if(active.values().stream().anyMatch(task->projectId.equals(task.projectId))) throw error(HttpStatus.CONFLICT,"project_busy","项目已有工作台操作在执行");
            ObjectNode envelope=json.createObjectNode().put("state","accepted").put("createdAt",Instant.now().toString());
            envelope.set("request",json.valueToTree(request));
            documents.put(NAMESPACE,request.requestId(),projectId,0,envelope,false);
            var execution=new Execution(projectId,request,lease);
            active.put(request.requestId(),execution);
            try { executor.execute(execution);submitted=true; }
            catch(RejectedExecutionException failure) {
                active.remove(request.requestId());
                finish(request.requestId(),"failed",null,"workbench_queue_full","工作台操作队列已满");
            }
            return get(projectId,request.requestId());
        } finally { if(!submitted) lease.close(); }
    }

    public synchronized Job get(String projectId,String id) {
        try(var activity=operations.participate(projectId)) { return getActive(projectId,id); }
    }

    private Job getActive(String projectId,String id) {
        var stored=documents.find(NAMESPACE,id).filter(item->projectId.equals(item.projectId())).orElseThrow(()->error(HttpStatus.NOT_FOUND,"not_found","工作台操作不存在"));
        var data=stored.data();
        String state=data.path("state").asText();
        if(!active.containsKey(id) && List.of("accepted","running").contains(state)) {
            Request request=json.convertValue(data.path("request"),Request.class);
            Object completed=null;
            try {
                completed=switch(request.kind()) {
                    case "timeline_recovery" -> timelines.read(projectId,request.artifactPath());
                    case "shot_preview" -> candidates.existingPreview(projectId,request.candidate()).orElse(null);
                    case "shot_commit" -> candidates.existingCommit(projectId,request.version(),request.candidateId()).orElse(null);
                    case "version_export" -> exports.existing(projectId, request).orElse(null);
                    default -> null;
                };
            } catch(ApiException missing) {
                if(!List.of("not_found","timeline_missing","shot_candidate_not_found").contains(missing.getCode())) {
                    finish(id,"failed",null,missing.getCode(),missing.getMessage());
                    return get(projectId,id);
                }
            }
            if(completed!=null) finish(id,"completed",json.valueToTree(completed),null,null);
            else finish(id,"interrupted",null,"workbench_interrupted","上次执行已中断，请核对产物后使用新请求重试");
            return get(projectId,id);
        }
        return new Job(projectId,id,data.path("request").path("kind").asText(),state,data.get("result"),data.path("errorCode").textValue(),data.path("error").textValue(),data.path("createdAt").asText());
    }

    public List<Job> list(String projectId) {
        try (var activity = operations.participate(projectId)) {
            projects.findById(projectId).orElseThrow(() -> error(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
            return documents.list(NAMESPACE, projectId, 100).stream().map(item -> get(projectId, item.id())).toList();
        }
    }

    public synchronized Job cancel(String projectId,String id) {
        var job=get(projectId,id);
        var execution=active.get(id);
        if(execution!=null && List.of("accepted","running").contains(job.state())) {
            execution.cancelled=true;
            if(execution.worker==null) {
                finish(id,"cancelled",null,"workbench_cancelled","工作台操作已取消");
                executor.remove(execution);active.remove(id);execution.lease.close();
                return get(projectId,id);
            }
            execution.worker.interrupt();
        }
        return job;
    }

    private synchronized void finish(String id,String state,JsonNode result,String code,String message) {
        var stored=documents.find(NAMESPACE,id).orElseThrow();
        ObjectNode data=stored.data().deepCopy();
        data.put("state",state).put("errorCode",code).put("error",message).put("updatedAt",Instant.now().toString());
        data.set("result",result);
        documents.put(NAMESPACE,id,stored.projectId(),stored.revision(),data,false);
    }

    private final class Execution implements Runnable {
        private final String projectId;
        private final Request request;
        private final ProjectOperationLock.Lease lease;
        private volatile boolean cancelled;
        private volatile boolean shutdown;
        private Thread worker;
        private JsonNode completedResult;
        private Execution(String projectId,Request request,ProjectOperationLock.Lease lease) { this.projectId=projectId;this.request=request;this.lease=lease; }
        @Override public void run() {
            synchronized(WorkbenchJobs.this) {
                if(active.get(request.requestId())!=this) return;
                worker=Thread.currentThread();
            }
            try(var cancellation=CreationCancellation.watch(()->cancelled || shutdown)) {
                CreationCancellation.requireRunning();
                finish(request.requestId(),"running",null,null,null);
                Object result=switch(request.kind()) {
                    case "timeline_recovery" -> timelines.recover(projectId,request.artifactPath());
                    case "shot_preview" -> candidates.preview(projectId,request.candidate());
                    case "shot_commit" -> candidates.commit(projectId,request.version(),request.candidateId());
                    case "version_verify" -> verification.verify(projectId, request.version());
                    case "version_export" -> exports.export(projectId, request);
                    default -> throw new IllegalStateException("unsupported workbench operation");
                };
                completedResult=json.valueToTree(result);
                finish(request.requestId(),"completed",completedResult,null,null);
            } catch(Exception failure) {
                Thread.interrupted();
                try {
                    if(completedResult!=null) finish(request.requestId(),"completed",completedResult,null,null);
                    else if(com.fengmotion.server.project.service.SceneCommitVerifier.uncertain(failure)) log.warn("候选提交待核实 request={}",request.requestId());
                    else finish(request.requestId(),cancelled?"cancelled":shutdown?"interrupted":"failed",null,
                        failure instanceof ApiException api?api.getCode():"workbench_failed",failure.getMessage());
                }
                catch(RuntimeException persistence) { log.error("工作台操作收尾失败 request={}",request.requestId(),persistence); }
            } finally {
                synchronized(WorkbenchJobs.this) { worker=null;active.remove(request.requestId(),this);lease.close();Thread.interrupted(); }
            }
        }
    }

    @PreDestroy public void close() {
        synchronized(this) {
            closed=true;
            for(var task:List.copyOf(active.values())) {
                task.shutdown=true;
                if(task.worker==null) {
                    try { finish(task.request.requestId(),"interrupted",null,"workbench_interrupted","服务关闭，操作尚未执行"); }
                    catch(RuntimeException failure) { log.error("工作台排队状态保存失败",failure); }
                    finally { active.remove(task.request.requestId());task.lease.close(); }
                }
            }
            executor.shutdownNow();
        }
        try { executor.awaitTermination(5,TimeUnit.SECONDS); }
        catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private static void validate(Request request) {
        if(request==null || request.requestId()==null || !request.requestId().matches("[a-zA-Z0-9_-]{1,128}") || request.kind()==null) throw error(HttpStatus.BAD_REQUEST,"validation_error","工作台操作缺少身份或类型");
        boolean valid=switch(request.kind()) {
            case "timeline_recovery" -> request.artifactPath()!=null && !request.artifactPath().isBlank() && request.artifactPath().length()<2048;
            case "shot_preview" -> request.candidate()!=null && request.candidate().baseVersion()!=null && request.candidate().baseVersion()>0
                    && request.candidate().componentSource()!=null && request.candidate().componentSource().length()<=262144
                    && request.candidate().requestId()!=null && request.candidate().requestId().matches("[0-9a-fA-F-]{36}");
            case "shot_commit" -> request.version()!=null && request.version()>0 && request.candidateId()!=null && request.candidateId().matches("[0-9a-fA-F-]{36}");
            case "version_verify" -> request.version()!=null && request.version()>0 && request.artifactPath()==null
                    && request.candidateId()==null && request.candidate()==null;
            case "version_export" -> request.version()!=null && request.version()>0 && request.artifactPath()==null
                    && request.candidateId()==null && request.candidate()==null && request.reviewId()!=null
                    && request.reviewId().matches("[0-9a-f-]{36}") && request.videoHash()!=null && request.videoHash().matches("[0-9a-f]{64}");
            default -> false;
        };
        if(!valid) throw error(HttpStatus.BAD_REQUEST,"validation_error","工作台操作参数无效");
    }
    private static ApiException error(HttpStatus status,String code,String message) { return new ApiException(status,code,message); }
}

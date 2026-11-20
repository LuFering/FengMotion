package com.fengmotion.server.creation.service;

import com.fengmotion.server.creation.store.CreationTaskStore;

import java.util.*;
import java.util.concurrent.*;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.LocalStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.domain.ProjectCreationActivity;
import com.fengmotion.server.project.domain.ShotTimeline;
import com.fengmotion.server.creation.domain.CreationSessionAccess;
import com.fengmotion.server.creation.domain.CreateRequest;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;

/** A durable request owns execution, not the browser connection. */
@Service
@RequiredArgsConstructor
public class CreationJobs implements ProjectCreationActivity {
    private final LocalStateStore documents;
    private final CreationTaskStore tasks;
    private final ProjectCreationService render;
    private final ProjectRepository projects;
    private final CreationSessionAccess sessionAccess;
    private final ObjectMapper json;
    private final Map<String, String> active = new ConcurrentHashMap<>();
    private final Map<String, Thread> workers = new ConcurrentHashMap<>();
    private final Set<String> cancellations = ConcurrentHashMap.newKeySet();
    private final Map<String, String> activeProjects = new ConcurrentHashMap<>();
    private final ExecutorService executor = new ThreadPoolExecutor(2,2,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(20),new ThreadPoolExecutor.AbortPolicy());
    public record Job(String projectId,String requestId,String sessionId,String userMessageId,String state,String phase,JsonNode result,String error,String createdAt) {}
    public synchronized Job submit(String projectId,CreateRequest request) {
        if(request==null||request.requestId()==null||request.requestId().isBlank())throw bad("制作请求缺少身份");
        if(request.filmFormat()!=null&&!ShotTimeline.FORMAT.equals(request.filmFormat()))throw bad("不支持的 filmFormat");
        projects.findById(projectId).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"not_found","项目不存在"));
        sessionAccess.validate(projectId,request.sessionId(),request.userMessageId());
        JsonNode payload=json.valueToTree(request);
        var existing=find(request.requestId());
        if(existing!=null){
            if(!projectId.equals(existing.projectId())||!sameRequest(payload,existing.data().get("request")))throw new ApiException(HttpStatus.CONFLICT,"task_idempotency_conflict","请求身份已用于不同内容");
            return get(projectId,request.requestId());
        }
        if(activeProjects.containsKey(projectId))throw new ApiException(HttpStatus.CONFLICT,"project_busy","项目已有制作任务，请等当前任务完成");
        ObjectNode envelope=json.createObjectNode();envelope.set("request",payload);envelope.put("state","accepted");envelope.put("createdAt",java.time.Instant.now().toString());
        documents.put("creation-request",request.requestId(),projectId,0,envelope,false);
        active.put(request.requestId(),projectId);activeProjects.put(projectId,request.requestId());
        try{executor.submit(()->execute(projectId,request));}
        catch(RejectedExecutionException full){active.remove(request.requestId());activeProjects.remove(projectId,request.requestId());finish(request.requestId(),"failed",null,"制作队列已满，请稍后以新请求重试");}
        return get(projectId,request.requestId());
    }

    private static boolean sameRequest(JsonNode incoming, JsonNode stored) {
        return stored != null && incoming.equals((left, right) -> {
            if (left.isIntegralNumber() && right.isIntegralNumber()) {
                return left.bigIntegerValue().compareTo(right.bigIntegerValue());
            }
            return left.equals(right) ? 0 : 1;
        }, stored);
    }
    private void execute(String projectId,CreateRequest request){
        try{
            synchronized(this) { workers.put(request.requestId(), Thread.currentThread()); }
            if(cancellations.contains(request.requestId()))throw new InterruptedException("制作已取消");
            var out=request.filmFormat()==null
                    ? render.createThenRender(projectId,request.intent(),request.references(),request.previewImage(),request.baseVersion(),request.correction(),request.requestId(),request.sessionId(),request.userMessageId(),request.engineSelection())
                    : render.createShotFilm(projectId,request);
            var media=out.render();ObjectNode result=json.createObjectNode();
            result.put("state",out.state());result.put("reply",out.reply());result.put("agentMs",out.agentMs());result.put("artifactPath",out.artifactPath());
            if(out.version()==null)result.putNull("version");else result.put("version",out.version());
            result.put("durationInFrames",media==null?0:media.durationInFrames());result.put("width",media==null?0:media.width());result.put("height",media==null?0:media.height());result.put("fps",media==null?0:media.fps());
            result.set("resources",json.valueToTree(out.resources()));result.put("requestId",request.requestId());result.put("userMessageId",request.userMessageId());
            // Evidence describes resolved inputs, never claims that the Agent actually used them.
            ObjectNode evidence=json.createObjectNode();evidence.put("requestId",request.requestId());evidence.put("projectId",projectId);evidence.put("sessionId",request.sessionId());evidence.put("userMessageId",request.userMessageId());evidence.put("state",out.state());evidence.put("artifactPath",out.artifactPath());
            evidence.set("requested",request.references());evidence.set("resolved",json.valueToTree(out.resources()));evidence.put("usageVerified",false);evidence.set("workflow",request.workflow());
            if(out.artifactPath()!=null)evidence.put("version",out.version());
            documents.put("resource-evidence",request.requestId(),projectId,0,evidence,false);
            finish(request.requestId(),out.state(),result,null);
        }catch(Exception error){finish(request.requestId(),cancellations.contains(request.requestId())?"cancelled":"failed",null,cancellations.contains(request.requestId())?"制作已取消，已写入的工程更改仍保留，请核对后继续。":error.getMessage());}
        finally{workers.remove(request.requestId());cancellations.remove(request.requestId());active.remove(request.requestId());activeProjects.remove(projectId,request.requestId());Thread.interrupted();}
    }
    private void finish(String id,String state,JsonNode result,String error){
        var before=find(id);if(before==null)return;ObjectNode value=before.data().deepCopy();value.put("state",state);value.set("result",result);value.put("error",error);
        documents.put("creation-request",id,before.projectId(),before.revision(),value,false);
    }
    private LocalStateStore.Document find(String id){return documents.find("creation-request",id).orElse(null);}
    public Job get(String projectId,String id){
        var doc=find(id);if(doc==null||!Objects.equals(projectId,doc.projectId()))throw new ApiException(HttpStatus.NOT_FOUND,"not_found","制作请求不存在");
        var req=doc.data().path("request");var task=tasks.findByRequestId(id).orElse(null);String state=doc.data().path("state").asText();
        if(active.containsKey(id)&&!Set.of("rendered","awaiting_info","failed","cancelled").contains(state))state=cancellations.contains(id)?"cancelling":task==null?"accepted":"running";
        else if("accepted".equals(state)||"running".equals(state)){
            if(task!=null&&Set.of("rendered","awaiting_info").contains(task.status())){
                ObjectNode recovered=json.createObjectNode();recovered.put("state",task.status());recovered.put("reply",task.reply());recovered.put("artifactPath",task.artifactPath());if(task.version()!=null)recovered.put("version",task.version());recovered.put("agentMs",0);recovered.put("width",0);recovered.put("height",0);recovered.put("fps",0);recovered.put("durationInFrames",0);recovered.put("requestId",id);recovered.put("userMessageId",task.userMessageId());
                finish(id,task.status(),recovered,null);return get(projectId,id);
            }
            state="interrupted";
        }
        return new Job(projectId,id,req.path("sessionId").asText(null),req.path("userMessageId").asText(null),state,task==null?state:task.phase(),doc.data().get("result"),state.equals("interrupted")?"上次制作已中断，请核对工程后重新提交":doc.data().path("error").asText(null),doc.data().path("createdAt").asText(doc.updatedAt()));
    }
    public JsonNode evidence(String projectId,String id){
        get(projectId,id);
        return documents.find("resource-evidence",id).filter(d->projectId.equals(d.projectId())).map(LocalStateStore.Document::data).orElse(json.createObjectNode().put("usageVerified",false).put("state","pending"));
    }
    /** 项目是否有已受理、尚未结束的制作请求（含排队中、尚未拿到项目锁的）。 */
    public boolean hasActive(String projectId){return activeProjects.containsKey(projectId);}
    public List<Job> list(String projectId){return documents.list().stream().filter(d->d.namespace().equals("creation-request")&&projectId.equals(d.projectId())).map(d->get(projectId,d.id())).toList();}
    public synchronized Job cancel(String projectId,String id) {
        var job=get(projectId,id);
        if(!active.containsKey(id))return job;
        cancellations.add(id);
        var worker=workers.get(id);
        if(worker!=null)worker.interrupt();
        return get(projectId,id);
    }
    private ApiException bad(String message){return new ApiException(HttpStatus.BAD_REQUEST,"validation_error",message);}
    @PreDestroy void close(){executor.shutdownNow();}
}

package com.fengmotion.server.harness.client;

import java.util.Map;

import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

/**
 * 本机后端的真实地址，通过环境变量 {@value #ENV} 交给 agent 进程。
 *
 * <p><strong>为什么不写进指引</strong>：桌面端每次启动换一个空闲端口，指引里写死端口会让 agent
 * 打到别的进程上。实测：指引写的 8080 上跑着一个旧的开发后端，检索请求卡住 60 秒，
 * 回复流因此 45 秒没有数据，被前端当成断线。端口每次启动都可能不同，放环境变量比改文件可靠。</p>
 */
@Component
public class LocalApiUrl implements ApplicationListener<WebServerInitializedEvent> {

    /** agent 进程里的变量名；项目指引里的接口示例都用它拼地址。 */
    public static final String ENV = "FENGMOTION_API_URL";

    private volatile String url;

    @Override
    public void onApplicationEvent(WebServerInitializedEvent event) {
        url = "http://127.0.0.1:" + event.getWebServer().getPort() + "/api";
    }

    /** 形如 {@code http://127.0.0.1:38365/api}；web 服务还没起来（例如 MockMvc 测试）时为 null。 */
    public String url() {
        return url;
    }

    /**
     * 写进子进程环境。
     *
     * <p>没有地址时连继承来的同名变量也删掉：留一个别处的旧值，比没有更容易把 agent 引到错的进程上。</p>
     */
    public void applyTo(Map<String, String> environment) {
        String value = url;
        if (value == null) environment.remove(ENV);
        else environment.put(ENV, value);
    }
}

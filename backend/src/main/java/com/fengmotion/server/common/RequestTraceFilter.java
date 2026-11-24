package com.fengmotion.server.common;

import java.io.IOException;
import java.util.UUID;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import lombok.extern.slf4j.Slf4j;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
@Slf4j
public class RequestTraceFilter extends OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
            throws ServletException,IOException {
        String id="req_"+UUID.randomUUID();
        String previous=MDC.get("requestId");
        MDC.put("requestId",id);
        response.setHeader("X-Request-Id",id);
        long started=System.nanoTime();
        try { chain.doFilter(request,response); }
        finally {
            if(response.getStatus()>=400) log.info("请求结束 requestId={} method={} status={} elapsedMs={}",id,request.getMethod(),response.getStatus(),(System.nanoTime()-started)/1_000_000);
            if(previous==null) MDC.remove("requestId"); else MDC.put("requestId",previous);
        }
    }
}

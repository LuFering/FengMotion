package com.fengmotion.server.harness.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.domain.HarnessDescriptor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class NativeHarnessesTest {
    @TempDir Path dir;
    NativeHarnesses adapter(String id, String script) throws Exception {
        Path exe = dir.resolve(id);
        Files.writeString(exe, "#!/usr/bin/env python3\n" + script);
        assertTrue(exe.toFile().setExecutable(true));
        HarnessProperties p = new HarnessProperties();
        if (id.equals("codex")) p.setCodexBin(exe.toString()); else p.setClaudeBin(exe.toString());
        return new NativeHarnesses(new ObjectMapper(), p, new LocalApiUrl());
    }
    @Test void codexDiscoversPagesAndRoutesModelAndImages() throws Exception {
        var harness = adapter("codex", """
import sys,json
for line in sys.stdin:
 f=json.loads(line);m=f.get('method');p=f.get('params',{})
 if m=='initialize': print(json.dumps({'id':f['id'],'result':{}}),flush=True)
 if m=='model/list':
  a={'id':'a','displayName':'Local A','isDefault':True,'supportedReasoningEfforts':[{'reasoningEffort':'medium'}]}
  b={'id':'b','displayName':'Local B'}
  print(json.dumps({'id':f['id'],'result':{'data':[b if p.get('cursor') else a],'nextCursor':None if p.get('cursor') else 'next'}}),flush=True)
 if m=='thread/start':
  assert p['model']=='b' and p['sandbox']=='workspace-write'
  print(json.dumps({'id':f['id'],'result':{'thread':{'id':'test'}}}),flush=True)
 if m=='turn/start':
  assert len(p['input'])==2 and p['input'][1]['type']=='image'
  print(json.dumps({'method':'item/agentMessage/delta','params':{'delta':'ok'}}),flush=True)
  print(json.dumps({'method':'item/completed','params':{'item':{'type':'agentMessage','id':'m','text':'ok'}}}),flush=True)
  print(json.dumps({'method':'turn/completed','params':{'turn':{'status':'completed'}}}),flush=True)
""");
        var p = harness.probe("codex");
        assertEquals(HarnessDescriptor.Status.AVAILABLE, p.descriptor().status());
        assertEquals(List.of("a", "b"), p.models().stream().map(m -> m.id()).toList());
        assertThrows(IllegalArgumentException.class, () -> harness.validate(new NativeHarnesses.Selection("codex", "missing", null)));
        var progress = new StringBuilder();
        String reply = harness.run(new NativeHarnesses.Selection("codex", "b", null), dir, "hello",
            List.of(new DshSdkSession.InlineImage("abcd", "image/png")), new Listener(progress), Duration.ofSeconds(5), process -> {});
        assertEquals("ok", reply); assertEquals("ok", progress.toString());
    }
    @Test void claudeUsesItsOwnCatalogAndSelectedModel() throws Exception {
        var harness = adapter("claude", """
import sys,json
for line in sys.stdin:
 f=json.loads(line)
 if f.get('type')=='control_request':
  print(json.dumps({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':{'models':[{'value':'sonnet','resolvedModel':'custom-sonnet','supportedEffortLevels':['medium']} ]}}}),flush=True)
 if f.get('type')=='user':
  assert '--model' in sys.argv and sys.argv[sys.argv.index('--model')+1]=='sonnet'
  assert '--effort' in sys.argv and sys.argv[sys.argv.index('--effort')+1]=='medium'
  print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'answer'}]}}),flush=True)
  print(json.dumps({'type':'result','is_error':False,'result':'answer'}),flush=True)
""");
        assertEquals("custom-sonnet", harness.probe("claude").models().getFirst().label());
        assertEquals("answer", harness.run(new NativeHarnesses.Selection("claude", "sonnet", "ultra"), dir,
            "hello", List.of(), new Listener(new StringBuilder()), Duration.ofSeconds(5), p -> {}));
    }
    @Test void disabledDiscoveryDoesNotLaunchInstalledBinaries() {
        HarnessProperties properties = new HarnessProperties();
        properties.setEnabled(false);
        var nativeHarnesses = new NativeHarnesses(new ObjectMapper(), properties, new LocalApiUrl());
        assertEquals(HarnessDescriptor.Status.UNAVAILABLE, nativeHarnesses.probe("codex").descriptor().status());
        assertTrue(nativeHarnesses.probe("claude").models().isEmpty());
    }

    @Test void missingBinaryAndSlowProbeStayUnavailable() throws Exception {
        HarnessProperties p = new HarnessProperties();
        p.setCodexBin(dir.resolve("missing-binary").toString());
        var missing = new NativeHarnesses(new ObjectMapper(), p, new LocalApiUrl()).probe("codex");
        assertEquals(HarnessDescriptor.Status.UNAVAILABLE, missing.descriptor().status());
        assertTrue(missing.models().isEmpty());
        Path exe = dir.resolve("slow");
        Files.writeString(exe, "#!/bin/sh\nsleep 30\n");
        assertTrue(exe.toFile().setExecutable(true));
        p.setCodexBin(exe.toString()); p.setProbeTimeoutMs(500);
        long start = System.nanoTime();
        var slow = new NativeHarnesses(new ObjectMapper(), p, new LocalApiUrl()).probe("codex");
        assertEquals(HarnessDescriptor.Status.UNAVAILABLE, slow.descriptor().status());
        assertTrue(Duration.ofNanos(System.nanoTime() - start).toSeconds() < 6, "Probe must actually time out");
    }

    static class Listener implements DshSdkSession.Listener {
        final StringBuilder text;
        Listener(StringBuilder t) { text=t; }
        public void onTurnStarted(int t) { }
        public void onStepStarted(int t,int s) { }
        public void onToolCall(String id,String n,String a) { }
        public void onToolResult(String id,String t,boolean e) { }
        public void onTextDelta(String t) { text.append(t); }
        public void onThinkingDelta(String t) { }
        public void onAssistantMessage(String t,String r) { }
        public void onTurnEnded(boolean f,String r) { }
        public void onIdle() { }
    }
}

package com.fengmotion.server.chat.service;

import java.util.function.BiConsumer;

final class DshTurnText {
    private final BiConsumer<String, Integer> publish;
    private final StringBuilder body = new StringBuilder();
    private int turn = -1;
    private int step = -1;
    private int stepStart;
    private String attempt;
    private boolean settled;

    DshTurnText(BiConsumer<String, Integer> publish) {
        this.publish = publish;
    }

    void start(int nextTurn, int nextStep) {
        if (turn == nextTurn && step == nextStep) return;
        turn = nextTurn;
        step = nextStep;
        stepStart = body.length();
        attempt = null;
        settled = false;
    }

    void delta(int sourceTurn, int sourceStep, String sourceAttempt, String chunk) {
        if (turn != sourceTurn || step != sourceStep || settled || chunk.isEmpty()) return;
        if (attempt != null && !attempt.equals(sourceAttempt)) replaceTail("");
        attempt = sourceAttempt;
        append(body.length() == stepStart && stepStart > 0 ? "\n\n" + chunk : chunk);
    }

    void commit(int sourceTurn, int sourceStep, String text) {
        start(sourceTurn, sourceStep);
        if (settled) return;
        String canonical = text.isBlank() ? "" : stepStart == 0 ? text : "\n\n" + text;
        String provisional = body.substring(stepStart);
        if (canonical.startsWith(provisional)) append(canonical.substring(provisional.length()));
        else replaceTail(canonical);
        settled = true;
    }

    private void append(String suffix) {
        if (suffix.isEmpty()) return;
        body.append(suffix);
        publish.accept(suffix, null);
    }

    private void replaceTail(String replacement) {
        body.setLength(stepStart);
        body.append(replacement);
        publish.accept(replacement, stepStart);
    }

    int offset() { return body.length(); }
    /** 当前这一步的正文从哪里开始；这一步的思考就排在这个位置。 */
    int stepStart() { return stepStart; }
    String text() { return body.toString(); }
}

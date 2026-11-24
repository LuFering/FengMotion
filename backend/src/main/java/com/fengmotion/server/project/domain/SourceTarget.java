package com.fengmotion.server.project.domain;

public record SourceTarget(String file, int line, int column, String fileHash, String code) { }

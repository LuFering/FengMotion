package com.fengmotion.server.asset.service;

import com.fengmotion.server.asset.domain.AssetStates;

final class AssetMediaTypes {
    private AssetMediaTypes() {
    }

    static String effectiveMimeType(String fileName, String mimeType, AssetStates.MediaType mediaType) {
        if (mimeType != null && !mimeType.isBlank()
                && !mimeType.equalsIgnoreCase("application/octet-stream")) {
            return mimeType;
        }
        String name = fileName == null ? "" : fileName.toLowerCase();
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1) : "";
        return switch (ext) {
            case "mp4", "m4v" -> "video/mp4";
            case "mov" -> "video/quicktime";
            case "mkv" -> "video/x-matroska";
            case "webm" -> "video/webm";
            case "avi" -> "video/x-msvideo";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "svg" -> "image/svg+xml";
            case "avif" -> "image/avif";
            case "mp3" -> "audio/mpeg";
            case "wav" -> "audio/wav";
            case "flac" -> "audio/flac";
            case "aac", "m4a" -> "audio/aac";
            case "ogg" -> "audio/ogg";
            case "woff2" -> "font/woff2";
            case "woff" -> "font/woff";
            case "ttf" -> "font/ttf";
            case "otf" -> "font/otf";
            case "pdf" -> "application/pdf";
            case "md" -> "text/markdown";
            case "txt" -> "text/plain";
            case "json" -> "application/json";
            default -> switch (mediaType) {
                case VIDEO -> "video/mp4";
                case IMAGE -> "image/png";
                case AUDIO -> "audio/mpeg";
                case FONT -> "font/ttf";
                case DOC -> "application/octet-stream";
            };
        };
    }

    static AssetStates.MediaType mediaTypeOf(String fileName, String mimeType) {
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        String name = fileName.toLowerCase();
        if (mime.startsWith("image/") || name.matches(".*\\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$")) {
            return AssetStates.MediaType.IMAGE;
        }
        if (mime.startsWith("video/") || name.matches(".*\\.(mp4|mov|mkv|webm|avi|m4v)$")) {
            return AssetStates.MediaType.VIDEO;
        }
        if (mime.startsWith("audio/") || name.matches(".*\\.(mp3|wav|flac|aac|m4a|ogg)$")) {
            return AssetStates.MediaType.AUDIO;
        }
        if (mime.startsWith("font/") || name.matches(".*\\.(woff2?|ttf|otf)$")) {
            return AssetStates.MediaType.FONT;
        }
        if (mime.equals("application/pdf") || name.matches(".*\\.(pdf|md|txt|docx?|json)$")) {
            return AssetStates.MediaType.DOC;
        }
        return null;
    }

    static String extensionOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0 || dot == fileName.length() - 1) {
            return "";
        }
        String ext = fileName.substring(dot).toLowerCase();
        return ext.matches("\\.[a-z0-9]{1,10}") ? ext : "";
    }
}

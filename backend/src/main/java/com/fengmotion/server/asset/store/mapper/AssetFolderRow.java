package com.fengmotion.server.asset.store.mapper;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * asset_folders 表的持久化行。
 */
@Data
@NoArgsConstructor
public class AssetFolderRow {
    private String id;
    private String name;
    private String createdAt;
    private String updatedAt;
}

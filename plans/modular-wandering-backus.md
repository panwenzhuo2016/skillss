# 文档标签筛选功能实现计划

## Context

文档标签功能（2425）的主体已完成，但现有的文档搜索和树接口不支持按 `visibilityTag`（系统标签）和 `tagIds`（个人标签）筛选。用户选择方案 B：搜索 + 树接口都加筛选。

## 改动范围

### 1. `SpaceNodeFilterRo.java` — 搜索入参加字段
- 新增 `Integer visibilityTag`（可选，@Min(0) @Max(2)）
- 新增 `List<Long> tagIds`（可选）

### 2. `SpaceNodeFilterVo.java` — 搜索出参加字段
- 新增 `Integer visibilityTag` — 让前端展示系统标签

### 3. `ISpaceNodeTagRelService.java` + Impl — 新增批量 tagIds 查询方法
- 新增 `Set<Long> listSpaceNodeIdsByTagIdsAndUserId(List<Long> tagIds, Long userId)`
- 实现：`WHERE tag_id IN (?) AND user_id = ?`，SELECT space_node_id，返回 Set

### 4. `SpaceNodeQueryManagerImpl.java` — 搜索逻辑加过滤

在 `filterSpaceNode` 方法中，合并标题+创建者查询结果后、转 VO 前：
1. 若 `visibilityTag` 非空 → 过滤 `entity.getVisibilityTag().equals(ro.getVisibilityTag())`
2. 若 `tagIds` 非空 → 调用 `listSpaceNodeIdsByTagIdsAndUserId` 获取匹配的 nodeId 集合 → 取交集
3. 注入 `ISpaceNodeTagRelService` 依赖
4. `SpaceNodeFilterVo` 组装时设置 `filterVo.setVisibilityTag(vo.getVisibilityTag())`

### 5. `SpaceNodeQueryManagerImpl.java` — 树接口加过滤

在 `getSpaceNodeTree` 方法中，**不改签名**，新增一个重载方法：
`getSpaceNodeTree(String spaceId, Integer visibilityTag, List<Long> tagIds)`

逻辑：复用现有 `getSpaceNodeTree(spaceId)` 获取完整树后，对树做 post-prune：
- 若 `visibilityTag` 非空 → 只保留 `vo.getVisibilityTag().equals(visibilityTag)` 的叶节点（保留文件夹层级）
- 若 `tagIds` 非空 → 只保留 id 在 tagIds 对应 nodeId 集合中的叶节点（保留文件夹层级）
- 复用 `keepByAppNodeGroupAndAncestors` 的剪枝模式写类似方法

### 6. `SpaceNodeQueryManager.java`（接口） — 新增重载方法签名
- `List<TreeNode<SpaceNodeVo>> getSpaceNodeTree(String spaceId, Integer visibilityTag, List<Long> tagIds)`

### 7. `SpaceNodeController.java` — 树接口加参数

给 `getSpaceNodeTree` 新增可选 `@RequestParam`：
```java
@RequestParam(required = false) Integer visibilityTag,
@RequestParam(required = false) List<Long> tagIds
```
当参数都为空时走原逻辑，否则调用新重载。

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `workspace/ro/SpaceNodeFilterRo.java` | 加字段 |
| `workspace/vo/SpaceNodeFilterVo.java` | 加字段 |
| `workspace/service/ISpaceNodeTagRelService.java` | 加方法 |
| `workspace/service/impl/ISpaceNodeTagRelServiceImpl.java` | 加实现 |
| `workspace/manager/query/SpaceNodeQueryManager.java` | 加重载签名 |
| `workspace/manager/query/impl/SpaceNodeQueryManagerImpl.java` | 改搜索 + 加树过滤 |
| `workspace/controller/SpaceNodeController.java` | 树接口加参数 |

## 验证方式

1. 编译通过：`./gradlew build -x test`
2. 部署到测试环境后用 curl/脚本验证：
   - `POST /node/filterSpaceNode` 带 visibilityTag=1 → 只返回公开文档
   - `POST /node/filterSpaceNode` 带 tagIds=[xxx] → 只返回贴了该标签的文档
   - `GET /node/spaceNodeTree?visibilityTag=1` → 树只保留公开文档
   - `GET /node/spaceNodeTree?tagIds=xxx` → 树只保留贴了标签的文档
   - 不带新参数时行为不变（向后兼容）

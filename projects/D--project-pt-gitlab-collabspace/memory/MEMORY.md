# CollabSpace 项目记忆

## 自查清单
- 写完 Java 代码后，检查新引入的类型是否已 import（尤其是 java.util 下的 Set、Map、List 等）
- 写测试脚本时，注意后端接口的参数限制（如 pageSize 最大 100）
- 写测试脚本前，先读对应的 RO 类确认参数名和类型，不凭记忆写（addRole 用 unitIds 数组，editRole/deleteRole 用 unitId 单个）
- 树结构数据要递归展开 children 再做断言

## 关键业务知识
- apitable 的 `loadMemberTeamTree` 会将根小组 teamId 强制设为 0（TeamServiceImpl:658）
- 根小组的默认权限是 editor
- 文档权限 role 值：reader / editor / manager，null 表示不可见（无权限记录）
- collabspace 和 apitable 通过 gRPC 通信，proto 文件需要两边同步

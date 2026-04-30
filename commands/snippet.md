# 代码片段

生成常用的代码片段。

## 参数

$ARGUMENTS — 代码片段描述（如「分页查询模板」「文件上传」「定时任务」）

## 执行步骤

1. 理解需要什么代码片段
2. 查看项目现有代码风格
3. 生成符合项目规范的代码片段
4. 展示代码并说明使用方式

## 常用片段分类

### 后端（Spring Boot）
- 分页查询 Controller + Service
- 文件上传/下载
- 定时任务（@Scheduled / ShedLock）
- Redis 缓存操作
- RabbitMQ 消息发送/消费
- 全局异常处理
- 参数校验（@Valid + 自定义校验）
- 接口幂等性处理
- 分布式锁（Redisson）
- 数据导入导出（EasyExcel）

### 前端（React + TypeScript）
- 通用表格页面（查询 + 分页 + 操作）
- 表单页面（新增/编辑共用）
- 自定义 Hook（useRequest、useDebounce）
- 文件上传组件
- 权限控制 HOC/Hook
- 无限滚动列表
- 弹窗表单
- 搜索筛选栏

### 通用
- Dockerfile
- docker-compose.yml
- Nginx 配置
- CI/CD 脚本
- .gitignore 模板

## 规则

- 代码片段要完整可用，不是伪代码
- 使用项目已有的工具和依赖
- 标注需要修改的地方（如包名、表名等）
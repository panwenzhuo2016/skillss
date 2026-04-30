# 环境配置

帮助配置开发环境或排查环境问题。

## 参数

$ARGUMENTS — 环境问题描述（如「npm install 报错」「Java 版本不对」「Redis 连不上」）

## 执行步骤

1. 读取项目的环境要求（CLAUDE.md、README、package.json、build.gradle）
2. 检查当前环境状态
3. 识别问题或差异
4. 给出配置指导

## 检查项

### 运行时环境
- Node.js 版本（`node -v`）
- Java 版本（`java -version`）
- npm / pnpm / yarn 版本
- Gradle / Maven 版本

### 依赖服务
- MySQL 连接状态
- Redis 连接状态
- RabbitMQ 连接状态
- MinIO / OSS 配置

### 项目配置
- 环境变量是否齐全
- 配置文件是否正确（application.yml、.env）
- IDE 配置（.editorconfig、tsconfig.json）

### 常见问题排查
- 端口占用
- 权限不足
- 网络代理配置
- npm 镜像源配置
- Gradle 代理配置

## 输出

- 当前环境状态
- 发现的问题
- 逐步修复指导（可复制的命令）
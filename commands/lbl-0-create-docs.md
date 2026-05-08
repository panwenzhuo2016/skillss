# 生成项目技术文档

基于当前项目代码，自动生成一套完整的技术文档，输出到 `myfeature/` 目录下。

## 文档清单

| 编号 | 文档 | 内容 |
|------|------|------|
| 01 | 技术方案设计 | 项目概述、技术栈、系统架构、业务领域、关键技术决策、安全设计 |
| 02 | 架构图 | 系统总览、后端模块、前端结构、实时协作、数据流、部署架构、权限架构（ASCII） |
| 03 | 数据库设计 | ER 图、表清单（按领域分组）、数据量统计、核心表字段级文档（从 Entity 类提取） |
| 04 | 接口设计文档 | 全部 API 端点（从 Controller 的 @RequestMapping 注解提取实际路径） |
| 05 | 时序图与流程图 | 核心业务流程的时序图（登录、OAuth、实时协作、CRUD、文件上传、权限校验等） |
| 06 | 开发规范 | 项目结构、命名规范、编码规范、Git 规范、日志规范、异常处理、安全规范、国际化 |
| 07 | 环境配置文档 | 环境概览、系统要求、本地开发搭建、中间件配置、端口分配、环境变量完整清单 |
| 08 | 部署文档 | CI/CD 流水线、Docker Compose 编排、手动部署、健康检查、备份恢复、回滚方案 |
| 09 | 运维手册 | 日常巡检、故障排查（常见 N 种场景）、服务重启、日志查看、数据库运维、监控告警 |
| 10 | 数据字典 | 业务术语、状态枚举、角色编码、ID 格式规范、错误码、字段类型、视图类型、消息队列 |
| 11 | 性能基线与压测方案 | 性能目标、资源基线、JVM/中间件参数、压测场景、压测脚本、瓶颈分析、监控指标 |
| 12 | 安全设计文档 | 认证体系、授权体系、会话安全、数据安全、输入安全、网络安全、审计日志、风险清单 |
| 13 | 第三方集成文档 | 每个外部系统的对接方式、配置项、数据流、认证方式、异常处理、注意事项 |

## 核心原则

1. **全部从代码提取，不猜测**：API 路径从 Controller 注解读、环境变量从 docker-compose/application.yml 读、字段定义从 Entity 类读、安全配置从 Filter/Interceptor 读
2. **发现问题要标注**：代码中发现的安全风险、配置问题、潜在 bug，在文档中按优先级标注
3. **可追溯**：关键信息标注来源文件路径，方便跳转查代码

## 执行步骤

### 第一步：项目探索（5 分钟）

快速了解项目全貌，收集生成文档所需的基础信息：

```
1. 读取项目根目录结构（ls / tree）
2. 读取构建配置确定技术栈：
   - Java: build.gradle / pom.xml → Spring Boot 版本、依赖列表
   - Node: package.json → 框架版本、monorepo 结构
   - Python: requirements.txt / pyproject.toml
3. 读取部署配置：
   - docker-compose.yaml → 服务列表、端口、依赖关系
   - Dockerfile → 构建方式、JVM 参数
   - CI 配置（.gitlab-ci.yml / Jenkinsfile / .github/workflows）
4. 读取应用配置：
   - application.yml / .env / .env.example → 中间件连接、业务参数
5. 快速统计：
   - 数据库表数量（搜索 Entity 类或 Mapper 接口数量）
   - 接口数量（搜索 Controller 类数量）
   - 前端页面/组件数量
```

→ 产出：技术栈清单、服务列表、中间件清单、代码规模概览

### 第二步：并行生成文档（分 3 批）

**第 1 批（并行 4 个 Agent）—— 架构与设计类：**

| Agent | 输出文件 | 数据来源 |
|-------|---------|---------|
| Agent-1 | 01-技术方案设计.md | 构建配置 + 目录结构 + 核心代码 |
| Agent-2 | 02-架构图.md | docker-compose + 模块依赖 + 网关配置 |
| Agent-3 | 05-时序图与流程图.md | Controller → Service 调用链分析 |
| Agent-4 | 06-开发规范.md | 代码风格分析 + 命名模式 + 项目约定 |

**第 2 批（并行 4 个 Agent）—— 数据与接口类：**

| Agent | 输出文件 | 数据来源 |
|-------|---------|---------|
| Agent-5 | 03-数据库设计.md | 全部 Entity 类（字段名、类型、注解） |
| Agent-6 | 04-接口设计文档.md | 全部 Controller 类（@RequestMapping 路径、方法、参数） |
| Agent-7 | 10-数据字典.md | Entity 枚举 + 常量类 + 数据库枚举值 |
| Agent-8 | 13-第三方集成文档.md | 搜索第三方 SDK/Client/OAuth 代码 |

**第 3 批（并行 5 个 Agent）—— 运维与安全类：**

| Agent | 输出文件 | 数据来源 |
|-------|---------|---------|
| Agent-9 | 07-环境配置文档.md | docker-compose + application.yml + .env |
| Agent-10 | 08-部署文档.md | CI 配置 + Dockerfile + docker-compose |
| Agent-11 | 09-运维手册.md | 健康检查端点 + 日志配置 + 监控配置 |
| Agent-12 | 11-性能基线与压测方案.md | 连接池/线程池/JVM 配置 + 限流配置 |
| Agent-13 | 12-安全设计文档.md | 认证 Filter + 权限 Service + 网关配置 |

### 第三步：交叉验证

文档全部生成后，检查：

1. **接口文档 vs 代码**：抽查 5 个 API 路径是否与 Controller 注解一致
2. **数据库文档 vs Entity**：抽查 3 个表的字段是否完整
3. **环境变量 vs 配置文件**：检查是否有遗漏的关键变量
4. **文档间交叉引用**：确保术语、ID 格式、枚举值在各文档中一致

### 第四步：输出汇总

列出所有生成的文档和行数，报告发现的问题（如有）。

## 适配不同技术栈

本命令会根据项目实际技术栈自动适配：

| 项目类型 | Entity 来源 | Controller 来源 | 配置来源 |
|---------|------------|----------------|---------|
| Spring Boot | `*Entity.java` | `*Controller.java` | `application.yml` |
| NestJS | `*.entity.ts` | `*.controller.ts` | `.env` / `config/*.ts` |
| Django | `models.py` | `views.py` / `urls.py` | `settings.py` |
| Go (Gin/Echo) | `model/*.go` | `handler/*.go` / `router.go` | `config.yaml` |
| Laravel | `app/Models/*.php` | `app/Http/Controllers/*.php` | `.env` |

如果是 Monorepo，对每个子项目分别生成，最后合并。

## 文档格式要求

- 文件编码：UTF-8 无 BOM
- 格式：Markdown
- 语言：中文
- 每个文档开头标注版本和更新时间
- 表格用 Markdown 表格，不用 HTML
- 架构图/时序图用 ASCII art，不依赖外部渲染工具
- 代码示例用 fenced code block 并标注语言

## 注意事项

1. **Agent 并行数量**：根据上下文窗口大小调整，每批最多 4-5 个 Agent 并行
2. **大型项目分批**：如果 Controller 超过 50 个或 Entity 超过 80 个，分批读取，先读文件列表再按批次读内容
3. **敏感信息**：密码、密钥等使用 `****` 脱敏，不要写入文档
4. **已有文档**：如果 `myfeature/` 下已有同名文档，先读取现有内容，在其基础上更新而非覆盖
5. **生成完毕后**：问用户是否有需要补充或调整的

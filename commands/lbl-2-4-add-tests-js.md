# JS 接口测试生成

用 Node.js 原生 fetch 生成 Web 接口的全覆盖自动化测试脚本，360 度无死角。

## 参数

$ARGUMENTS — 接口文档路径、Controller 代码路径、API 前缀、或需要测试的功能描述

## 适用场景

- 后端接口开发完成后的验收测试
- 测试环境部署后的冒烟测试
- 接口重构后的回归测试
- 新功能上线前的全量接口验证

## 硬性指标（不满足就不算完成）

1. **每个接口至少 5 个 assert**：正常返回结构 + 至少 1 个字段类型校验 + 至少 1 个参数校验 + 至少 1 个异常数据 + 至少 1 个注入/特殊字符
2. **多账号测试不可跳过**：必须测至少 2 种权限级别（管理员 + 普通用户），有权限校验的写接口必须验证普通用户被拒绝
3. **覆盖矩阵必须输出**：生成完成后必须输出「13 维度 × N 接口」覆盖表，每格标注 ✅（已覆盖）/ ❌（未覆盖，需补）/ N/A（不适用+原因）
4. **最低 assert 总数 = 接口数 × 8**：例如 15 个接口至少 120 个 assert。不足必须补
5. **所有写操作必须有清理/还原逻辑**：测试结束后数据状态不应比开始时更脏

## 执行步骤

### 第一步：收集信息

1. **读功能点对照文档**（`myfeature/` 目录下的 `*功能点对照*.md`），提取所有功能点编号和描述
   - 如果没有功能点对照文档，先用 `/lbl-04-feature-mapping` 生成
   - 记录每个功能点的编号（如 `§1.创建公告`）、说明、关键代码位置
   - 这是测试用例组织的**核心依据**：每个测试函数/assert 必须标注对应的功能点
2. **读接口文档**（md / swagger / 代码注释），提取**所有**接口路径、方法、参数、返回值
   - 特别注意：单个/批量版本必须都列出（如 editRole / batchEditRole、deleteRole / batchDeleteRole）
3. **读 Controller 代码**，确认：
   - 权限注解（哪些接口需要登录、需要什么角色）
   - 参数校验注解（@Valid、@NotNull、@NotEmpty、@Min、@Max）—— 特别关注**列表参数是否校验了空列表**
   - 返回值类型和结构
   - **权限校验异常是否被统一异常处理器正确映射**（是返回 403 还是 500？）
4. **读 Service/Manager 实现代码**，重点关注：
   - 写操作的 upsert 逻辑是否真的能 update（MyBatis-Plus `saveOrUpdateBatch` 基于主键，不基于业务唯一键）
   - 同类接口的逻辑对称性（如 listA 考虑继承但 listB 不考虑）
   - 内存去重（`Collectors.toMap(..., (a,b)->a)`）是否掩盖了 DB 层重复数据
5. **查数据库**找测试数据 + 检查数据质量：
   - 目标资源的 ID（空间 ID、节点 ID、文档 ID 等）
   - 所有相关用户及其角色（owner / admin / manager / editor / reader / 外部 / 系统）
   - 用 `SELECT` 确认数据存在，不要假设
   - **查重复数据**：`SELECT count(*), col1, col2 FROM table GROUP BY col1, col2 HAVING count(*) > 1`
   - **查唯一索引**：`SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_NAME = 'xxx'`
6. **确认认证机制**：
   - 测试登录入口（testLogin 接口 / 测试 token / OAuth mock）
   - CSRF 机制（XSRF-TOKEN cookie 需同时作为 header 发送）
   - Session 机制（cookie 名称、过期策略）
7. **确认测试环境地址**和端口

### 第二步：生成测试脚本

生成 `05-<需求编号>-test-api.js`（需求编号从功能目录名中匹配 `YYMMDD-NNNN-功能名` 格式取 `NNNN`，如 `05-2424-test-api.js`），文件结构固定如下：

```javascript
/**
 * [功能名称] - 接口测试脚本
 *
 * 用法: node 05-<需求编号>-test-api.js
 * 要求: Node.js 18+（原生 fetch）
 * 自动登录测试环境，无需手动填 Cookie
 */

// ========== 配置 ==========
const CONFIG = {
  host: 'http://xxx-test.example.com',
  loginEmail: 'test@example.com',
  // ... 业务相关的 ID
};

// ========== 测试框架 ==========
let passed = 0;
let failed = 0;
let cookie = '';
let xsrfToken = '';

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    if (detail !== undefined)
      console.log(`     实际值:`, typeof detail === 'object'
        ? JSON.stringify(detail).slice(0, 200) : detail);
    failed++;
  }
}

// ========== HTTP 工具 ==========

/** 从 set-cookie 头中提取 cookie 值 */
function parseCookies(res) {
  const cookies = {};
  const setCookieHeaders = res.headers.getSetCookie?.() || [];
  for (const header of setCookieHeaders) {
    const [kv] = header.split(';');
    const [k, v] = kv.split('=');
    cookies[k.trim()] = v.trim();
  }
  return cookies;
}

async function rawFetch(method, url, body) {
  const headers = {
    'x-space-id': CONFIG.spaceId,      // 按项目实际 header 调整
    'content-type': 'application/json',
  };
  if (cookie) headers['cookie'] = cookie;
  if (xsrfToken) headers['x-xsrf-token'] = xsrfToken;

  const opts = { method, headers, redirect: 'manual' };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

async function GET(path) {
  const res = await rawFetch('GET', `${CONFIG.host}/api/v1${path}`);
  return res.json();
}

async function POST(path, body) {
  const res = await rawFetch('POST', `${CONFIG.host}/api/v1${path}`, body);
  return res.json();
}

// ========== 登录管理 ==========

async function login() {
  console.log(`🔑 登录 ${CONFIG.loginEmail} ...`);
  const res = await fetch(`${CONFIG.host}/api/v1/testLogin/${CONFIG.loginEmail}`,
    { redirect: 'manual' });
  const cookies = parseCookies(res);
  if (!cookies.SESSION) {
    console.log('❌ 登录失败');
    process.exit(1);
  }
  xsrfToken = cookies['XSRF-TOKEN'] || '';
  cookie = `SESSION=${cookies.SESSION}; XSRF-TOKEN=${xsrfToken}`;
  console.log(`   ✅ 登录成功\n`);
}

let savedSessions = {};
function saveSession(name) {
  savedSessions[name] = { cookie, xsrfToken };
}
function restoreSession(name) {
  ({ cookie, xsrfToken } = savedSessions[name]);
}

async function loginAs(email) {
  const res = await fetch(`${CONFIG.host}/api/v1/testLogin/${email}`,
    { redirect: 'manual' });
  const cookies = parseCookies(res);
  if (!cookies.SESSION) {
    console.log(`  ⚠️  登录 ${email} 失败，跳过`);
    return false;
  }
  xsrfToken = cookies['XSRF-TOKEN'] || '';
  cookie = `SESSION=${cookies.SESSION}; XSRF-TOKEN=${xsrfToken}`;
  return true;
}

// ========== 测试用例 ==========
// 每组一个 async function，按维度组织

// ========== 执行 ==========
async function main() {
  console.log('🚀 [功能名称] - 接口测试');
  try {
    await login();
    // await testXxx(); ...
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED') {
      console.log('\n❌ 无法连接测试环境，请检查网络');
    } else {
      console.log(`\n❌ 异常: ${e.stack || e.message}`);
    }
    process.exit(1);
  }
  console.log(`\n=============================`);
  console.log(`✅ 通过: ${passed}  ❌ 失败: ${failed}  📊 总计: ${passed + failed}`);
  console.log(`=============================`);
  process.exit(failed > 0 ? 1 : 0);
}
main();
```

### 第三步：功能点映射 → 测试用例

**核心原则：每个 assert 必须标注它在测试哪个功能点。**

1. **按功能点组织测试函数**：每个功能点对应一个或多个测试函数，函数名包含功能点编号
2. **assert 注释标注功能点**：`assert('§3.定时发布 - 定时类型status=TIMED', ...)`
3. **测试脚本顶部输出功能点对照表**：运行时先打印功能点清单，让人知道覆盖了哪些
4. **13 个维度是补充**：功能点覆盖是主线，13 个维度用于发现功能点之外的边界问题

#### 测试函数命名规则
```javascript
// 函数名用纯 ASCII（§ 不是合法 JS 标识符字符），编号和功能点用英文简写
// § 符号只在 assert 的 name 字符串参数里使用
async function test_1_create_notice() { ... }
async function test_3_scheduled_publish_validation() { ... }
async function test_16_permission_multi_account() { ... }
```

#### assert 标注格式
```javascript
// 每个 assert 的 name 参数必须以 §编号 开头
assert('§1.创建公告 - title 必填校验', res.success === false);
assert('§3.定时发布 - publishTime 为未来时间', res.data.status === 3);
assert('§5.弹窗提示 - isPopup=true 时弹窗', res.data.isPopup === true);
assert('§16.权限校验 - 非管理员不能创建空间站公告', res.success === false);
```

#### main 函数中打印功能点覆盖清单
```javascript
async function main() {
  console.log('🚀 [功能名称] - 接口测试');
  console.log('');
  console.log('📋 功能点覆盖清单（来自功能点对照文档）：');
  console.log('  §1. 创建公告');
  console.log('  §2. 立即发布');
  console.log('  §3. 定时发布');
  // ... 列出所有功能点
  console.log('');

  try {
    await login();
    // 按功能点顺序调用
    await test_1_create_notice();
    await test_2_publish_now();
    // ...
  }
}
```

### 第四步：按 13 个维度补充用例

在功能点测试之外，**每个接口都要过一遍所有适用的维度**，不能只测一个接口就算覆盖了。
**单个/批量版本的接口必须分别测试**，不能只测单个就认为批量也没问题。
**维度测试的 assert 也要标注关联的功能点**（如有）。

---

#### 维度 1：正常流程
每个接口的基本调用：
```javascript
async function testBasicCrud() {
  console.log('📋 1. 基本 CRUD');

  const res = await GET('/listXxx?pageNo=1&pageSize=20');
  assert('接口返回 success', res.success === true, res);
  assert('data 不为 null', res.data != null, res.data);
  assert('包含 total', typeof res.data?.total === 'number', res.data?.total);
  assert('包含 records 数组', Array.isArray(res.data?.records), res.data?.records);

  // 逐个验证字段类型和名称，与接口文档一一对应
  if (res.data?.records?.length > 0) {
    const first = res.data.records[0];
    assert('记录含 id', first.id != null, first.id);
    assert('记录含 name (string)', typeof first.name === 'string', first.name);
    // ... 所有文档定义的字段都要验
  }
}
```

#### 维度 2：分页边界
```javascript
async function testPaginationBoundary() {
  console.log('\n📐 分页边界');

  // 最小 pageSize
  const p1 = await GET('/listXxx?pageNo=1&pageSize=1');
  assert('pageSize=1 最多返回1条', p1.data?.records?.length <= 1);

  // 最大合法 pageSize
  const p100 = await GET('/listXxx?pageNo=1&pageSize=100');
  assert('pageSize=100 返回成功', p100.success === true);

  // total 与 records 一致性
  if (p100.data?.total <= 100) {
    assert('total <= 100 时 length === total',
      p100.data.records.length === p100.data.total);
  }

  // 超出最后一页
  const overPage = await GET('/listXxx?pageNo=9999&pageSize=20');
  assert('超页返回空列表', overPage.data?.records?.length === 0);
  assert('超页 total 不变', overPage.data?.total === p100.data?.total);

  // 两页不重复
  if (p1.data?.total > 1) {
    const p2 = await GET('/listXxx?pageNo=2&pageSize=1');
    assert('第2页有数据', p2.data?.records?.length > 0);
    assert('两页 ID 不重复',
      p1.data.records[0].id !== p2.data.records[0].id);
  }

  // 不传分页参数用默认值
  const noPage = await GET('/listXxx');
  assert('不传分页参数用默认值', noPage.success === true);
  assert('默认 records 不超过 20', noPage.data?.records?.length <= 20);
}
```

#### 维度 3：搜索边界
```javascript
async function testSearchBoundary() {
  console.log('\n🔎 搜索边界');

  // 先拿一条真实数据
  const all = await GET('/listXxx?pageNo=1&pageSize=100');
  if (all.data?.records?.length > 0) {
    const realName = all.data.records[0].name;

    // 精确匹配
    const exact = await GET(`/listXxx?keyword=${encodeURIComponent(realName)}&pageNo=1&pageSize=20`);
    assert(`精确搜索"${realName}"有结果`, exact.data?.records?.length > 0);

    // 部分匹配
    if (realName.length > 1) {
      const partial = realName.substring(0, 1);
      const partialRes = await GET(`/listXxx?keyword=${encodeURIComponent(partial)}&pageNo=1&pageSize=20`);
      assert(`部分匹配"${partial}"有结果`, partialRes.data?.records?.length > 0);
    }

    // 大小写不敏感（如有英文）
    if (/[a-zA-Z]/.test(realName)) {
      const upper = await GET(`/listXxx?keyword=${encodeURIComponent(realName.toUpperCase())}&pageNo=1&pageSize=20`);
      const lower = await GET(`/listXxx?keyword=${encodeURIComponent(realName.toLowerCase())}&pageNo=1&pageSize=20`);
      assert('搜索大小写不敏感', upper.data?.total === lower.data?.total);
    }
  }

  // 空 keyword 等同不传
  const noKw = await GET('/listXxx?pageNo=1&pageSize=20');
  const emptyKw = await GET('/listXxx?keyword=&pageNo=1&pageSize=20');
  assert('空 keyword 等同不传', emptyKw.data?.total === noKw.data?.total);

  // 纯空格
  const spaceKw = await GET(`/listXxx?keyword=${encodeURIComponent('   ')}&pageNo=1&pageSize=20`);
  assert('纯空格 keyword 不报错', spaceKw.success === true);

  // 不存在
  const none = await GET(`/listXxx?keyword=${encodeURIComponent('不存在的xxx')}&pageNo=1&pageSize=20`);
  assert('不存在关键词返回空', none.data?.records?.length === 0);

  // 搜索 + 分页 total 一致
  if (all.data?.records?.length > 0) {
    const kw = all.data.records[0].name;
    const s1 = await GET(`/listXxx?keyword=${encodeURIComponent(kw)}&pageNo=1&pageSize=1`);
    const s2 = await GET(`/listXxx?keyword=${encodeURIComponent(kw)}&pageNo=1&pageSize=100`);
    assert('搜索不同 pageSize 下 total 一致', s1.data?.total === s2.data?.total);
  }
}
```

#### 维度 4：参数校验
```javascript
async function testParamValidation() {
  console.log('\n🔒 参数校验');

  // 每个列表接口都要测，不只测一个
  const endpoints = ['/listXxx', '/listYyy', '/listZzz'];
  for (const ep of endpoints) {
    const r1 = await GET(`${ep}?pageNo=0&pageSize=20`);
    assert(`${ep} pageNo=0 应返回错误`, r1.success === false);

    const r2 = await GET(`${ep}?pageNo=-1&pageSize=20`);
    assert(`${ep} pageNo=-1 应返回错误`, r2.success === false);

    const r3 = await GET(`${ep}?pageNo=1&pageSize=0`);
    assert(`${ep} pageSize=0 应返回错误`, r3.success === false);

    const r4 = await GET(`${ep}?pageNo=1&pageSize=101`);
    assert(`${ep} pageSize=101 应返回错误`, r4.success === false);

    const r5 = await GET(`${ep}?pageNo=1&pageSize=-1`);
    assert(`${ep} pageSize=-1 应返回错误`, r5.success === false);
  }

  // POST 接口缺少必填字段
  const noField1 = await POST('/editXxx', { /* 缺少必填字段 */ });
  assert('缺少必填字段返回错误', noField1.success === false);
}
```

#### 维度 5：特殊字符与注入防护
```javascript
async function testInjectionAndSpecialChars() {
  console.log('\n🛡️ 注入防护 + 特殊字符');

  // 特殊字符
  const specialChars = ['%', '_', '\'', '"', '\\', '<script>', '&&', '||'];
  for (const ch of specialChars) {
    const res = await GET(`/listXxx?keyword=${encodeURIComponent(ch)}&pageNo=1&pageSize=20`);
    assert(`特殊字符 "${ch}" 不报500`,
      res.success === true || (res.code && res.code !== 500));
  }

  // SQL 注入
  const injections = [
    "' OR 1=1 --",
    "1; DROP TABLE xxx;",
    "' UNION SELECT * FROM users --",
    "1' AND '1'='1",
    "admin'/*",
  ];
  for (const payload of injections) {
    const res = await GET(`/listXxx?keyword=${encodeURIComponent(payload)}&pageNo=1&pageSize=20`);
    assert(`注入 "${payload.slice(0, 25)}..." 不报500`,
      res.success === true || (res.code && res.code !== 500));
  }

  // 超长字符串
  const longStr = 'a'.repeat(200);
  const longRes = await GET(`/listXxx?keyword=${encodeURIComponent(longStr)}&pageNo=1&pageSize=20`);
  assert('超长 keyword 不报错',
    longRes.success === true || (longRes.code && longRes.code !== 500));
}
```

#### 维度 6：写操作验证
```javascript
async function testWriteAndVerify() {
  console.log('\n⚡ 写操作验证');

  // 1. 读取原始状态
  const before = await GET('/listXxx?pageNo=1&pageSize=1');
  const original = before.data?.records?.[0];
  if (!original) { console.log('  ⚠️ 无数据，跳过'); return; }
  const originalValue = original.role;
  const newValue = originalValue === 'reader' ? 'editor' : 'reader';

  // 2. 记录日志数量
  const logsBefore = await GET('/logs?pageNo=1&pageSize=1');
  const totalBefore = logsBefore.data?.total || 0;

  // 3. 执行写操作
  const editRes = await POST('/editXxx', { id: original.id, role: newValue });
  assert('写操作返回 success', editRes.success === true);

  // 4. 查询验证变更生效
  const after = await GET('/listXxx?pageNo=1&pageSize=20');
  const updated = after.data?.records?.find(r => r.id === original.id);
  assert('变更已生效', updated?.role === newValue);

  // 5. 验证日志/审计记录
  const logsAfter = await GET('/logs?pageNo=1&pageSize=1');
  assert('日志数量增加', logsAfter.data?.total > totalBefore);

  // 6. 幂等性：相同操作再执行一次
  const sameRes = await POST('/editXxx', { id: original.id, role: newValue });
  assert('相同操作不报错', sameRes.success === true);

  // 7. ⚠️ 还原数据
  await POST('/editXxx', { id: original.id, role: originalValue });
  console.log(`  ℹ️  已还原为 ${originalValue}`);
}
```

#### 维度 7：多账号权限（最关键最容易出 bug）
```javascript
async function testMultiAccountRead() {
  console.log('\n👤👤 多账号 - 读权限');
  saveSession('admin');

  // 普通成员：可读
  if (await loginAs('normal@example.com')) {
    const res = await GET('/listXxx?pageNo=1&pageSize=20');
    assert('普通成员可读', res.success === true);
  }
  restoreSession('admin');
}

async function testMultiAccountWrite() {
  console.log('\n🚫👤 多账号 - 写权限');
  saveSession('admin');

  // 无权限用户：写操作被拒绝
  if (await loginAs('normal@example.com')) {
    const res = await POST('/editXxx', { id: '1', role: 'reader' });
    assert('无权限用户 editXxx 被拒绝', res.success === false);
    assert('错误码非500', res.code !== 500);
  }
  restoreSession('admin');
}

async function testMultiAccountDataConsistency() {
  console.log('\n🔄👤 多账号 - 数据一致性');
  saveSession('admin');

  const adminData = await GET('/listXxx?pageNo=1&pageSize=100');

  if (await loginAs('other-manager@example.com')) {
    const otherData = await GET('/listXxx?pageNo=1&pageSize=100');
    assert('两用户 total 一致',
      adminData.data?.total === otherData.data?.total);
  }
  restoreSession('admin');
}

async function testMultiAccountOperatorLog() {
  console.log('\n📝👤 多账号 - 操作人日志');
  saveSession('admin');

  // ⚠️ 关键：不要改操作者自己的权限！
  // 正确做法：操作者 A 改目标 C，操作者 B 改目标 C
  // 错误做法：管理员把 B 降级，然后期望 B 还能写操作

  // 1. 准备：确保操作者 B 有管理权限
  // 2. 管理员 A 改目标 C → 查日志 operatorName === A 的名字
  // 3. 切换到 B → B 改目标 C → 查日志 operatorName === B 的名字
  // 4. 清理还原

  restoreSession('admin');
}

async function testExternalAndSystemAccounts() {
  console.log('\n🌐🤖 外部成员 + 系统账号');
  saveSession('admin');

  // 外部域成员
  if (await loginAs('external@other-domain.com')) {
    const res = await GET('/listXxx?pageNo=1&pageSize=20');
    assert('外部成员可读', res.success === true);
    const edit = await POST('/editXxx', { id: '1', role: 'reader' });
    assert('外部成员写操作被拒绝', edit.success === false);
  }

  // 系统账号
  if (await loginAs('system@default.com')) {
    const res = await GET('/listXxx?pageNo=1&pageSize=20');
    assert('系统账号不报500', res.code !== 500);
  }

  restoreSession('admin');
}

async function testUnloggedAccess() {
  console.log('\n🔒 未登录访问');
  saveSession('admin');
  cookie = ''; xsrfToken = '';

  // GET 接口行为取决于注解（@GetResource externalOnly）
  const getRes = await rawFetch('GET', `${CONFIG.host}/api/v1/listXxx?pageNo=1&pageSize=20`);
  assert('未登录 GET 不报500', getRes.status !== 500);

  // POST 写操作必须被拒绝
  const postRes = await rawFetch('POST', `${CONFIG.host}/api/v1/editXxx`,
    { id: '1', role: 'reader' });
  assert('未登录 POST 返回非200', postRes.status !== 200);

  restoreSession('admin');
}
```

#### 维度 8：不存在/异常数据
```javascript
async function testNotExistData() {
  console.log('\n🚫 不存在的数据');

  // ⚠️ ID 必须是合法类型！Java Long 最大值 9223372036854775807
  // 不要用 '9999999999999999999'（超出 Long 范围会导致解析异常 500）
  const fakeId = '1';

  const r1 = await GET(`/${fakeId}/listXxx?pageNo=1&pageSize=20`);
  assert('不存在 ID 不报500',
    r1.success === true || (r1.code && r1.code !== 500));

  const r2 = await POST('/editXxx', { id: fakeId, unitId: '1', role: 'reader' });
  assert('不存在 unitId 不报500', r2.code !== 500);
}
```

#### 维度 9：并发请求
```javascript
async function testConcurrency() {
  console.log('\n🔀 并发请求');

  const promises = Array.from({ length: 5 }, (_, i) =>
    GET(`/listXxx?pageNo=${i + 1}&pageSize=5`)
  );
  const results = await Promise.all(promises);
  const allOk = results.every(r => r.success === true);
  assert('5个并发请求都成功', allOk);
}
```

#### 维度 10：响应结构一致性
```javascript
async function testResponseStructure() {
  console.log('\n📦 响应结构一致性');

  const endpoints = [
    { name: 'listXxx', path: '/listXxx?pageNo=1&pageSize=5' },
    { name: 'listYyy', path: '/listYyy?pageNo=1&pageSize=5' },
  ];
  for (const ep of endpoints) {
    const res = await GET(ep.path);
    assert(`${ep.name} 含 pageNum`, typeof res.data?.pageNum === 'number');
    assert(`${ep.name} 含 pageSize`, typeof res.data?.pageSize === 'number');
    assert(`${ep.name} pageSize 与请求一致`, res.data?.pageSize === 5);
    assert(`${ep.name} 含 total`, typeof res.data?.total === 'number');
    assert(`${ep.name} 含 records`, Array.isArray(res.data?.records));
    assert(`${ep.name} records.length <= pageSize`, res.data?.records?.length <= 5);
  }
}
```

#### 维度 11：批量接口（单个/批量对比）
```javascript
async function testBatchOperations() {
  console.log('\n📦 批量接口');

  // 如果有 editRole / batchEditRole 这样的单个/批量对，必须都测
  // 1. batchEditRole：同时修改多个 unitId
  const batchRes = await POST('/batchEditRole', {
    spaceNodeId: CONFIG.spaceNodeId,
    unitIds: [unitId1, unitId2],
    role: 'editor',
  });
  assert('batchEditRole 返回 success', batchRes.success === true);

  // 2. 验证每个 unitId 都生效
  const after = await GET('/listXxx?pageNo=1&pageSize=100');
  const u1 = after.data?.records?.find(r => r.unitId === unitId1);
  const u2 = after.data?.records?.find(r => r.unitId === unitId2);
  assert('批量操作后 u1 角色正确', u1?.role === 'editor');
  assert('批量操作后 u2 角色正确', u2?.role === 'editor');

  // 3. batchDeleteRole
  const batchDelRes = await POST('/batchDeleteRole', {
    spaceNodeId: CONFIG.spaceNodeId,
    unitIds: [unitId1],
  });
  assert('batchDeleteRole 返回 success', batchDelRes.success === true);

  // 4. 还原
}
```

#### 维度 12：数据重复检测（写操作幂等性深度验证）
```javascript
async function testDuplicateDataBug() {
  console.log('\n🐛 数据重复检测');

  // 重点：反复调用 addRole / editRole，验证不会产生重复记录

  // 1. 清理目标
  await POST('/deleteRole', { spaceNodeId: CONFIG.spaceNodeId, unitId: targetUnitId });

  // 2. 第一次 addRole
  await POST('/addRole', { spaceNodeId: CONFIG.spaceNodeId, unitIds: [targetUnitId], role: 'reader' });

  const after1 = await GET('/listXxx?pageNo=1&pageSize=100');
  const count1 = after1.data?.records?.filter(r => r.unitId === targetUnitId).length;
  assert('第1次 addRole 后只出现1次', count1 === 1);

  // 3. 第二次 addRole（重复添加同一个 unitId，换角色）
  await POST('/addRole', { spaceNodeId: CONFIG.spaceNodeId, unitIds: [targetUnitId], role: 'editor' });

  const after2 = await GET('/listXxx?pageNo=1&pageSize=100');
  const count2 = after2.data?.records?.filter(r => r.unitId === targetUnitId).length;
  assert('重复 addRole 后仍只出现1次（不应有重复记录）', count2 === 1);

  // 4. editRole 再改一次
  await POST('/editRole', { spaceNodeId: CONFIG.spaceNodeId, unitId: targetUnitId, role: 'manager' });

  const after3 = await GET('/listXxx?pageNo=1&pageSize=100');
  const count3 = after3.data?.records?.filter(r => r.unitId === targetUnitId).length;
  assert('editRole 后仍只出现1次', count3 === 1);

  // 5. 清理
  await POST('/deleteRole', { spaceNodeId: CONFIG.spaceNodeId, unitId: targetUnitId });
}
```

#### 维度 13：错误码规范性
```javascript
async function testErrorCodeStandard() {
  console.log('\n🔢 错误码规范性');

  // 权限不足应返回 403/业务错误码，不应返回 500
  saveSession('admin');
  if (await loginAs('normal@example.com')) {
    const res = await POST('/editXxx', { id: '1', role: 'reader' });
    assert('权限不足 success=false', res.success === false);
    assert('权限不足不应返回500', res.code !== 500, res.code);
  }
  restoreSession('admin');

  // 空列表参数应返回 400，不应返回 500
  const r1 = await POST('/addXxx', { spaceNodeId: CONFIG.spaceNodeId, unitIds: [], role: 'reader' });
  assert('空列表参数 success=false', r1.success === false);
  assert('空列表参数不应返回500', r1.code !== 500, r1.code);

  // 缺少必填字段应返回参数校验错误，不应返回 500
  const r2 = await POST('/editXxx', {});
  assert('缺少必填字段 success=false', r2.success === false);
  assert('缺少必填字段不应返回500', r2.code !== 500, r2.code);
}
```

### 第四步半：强制自检（生成后、执行前必须过）

**在写完测试脚本后、执行前，必须逐项自检。不通过的项必须补完再执行。**

#### 自检清单

```
□ 1. 接口全覆盖：列出所有接口（含 Controller 中的每个方法），确认每个都有至少 1 个测试函数
□ 2. assert 数量：统计总 assert 数 >= 接口数 × 8
□ 3. 多账号测试：确认至少用了 2 个不同权限的账号（管理员 + 普通用户）
□ 4. 权限拒绝测试：每个有权限校验的写接口，都用普通用户测了被拒绝 + 错误码非 500
□ 5. 参数校验全覆盖：每个 POST 接口的每个必填字段，都测了缺失场景
□ 6. 不存在数据：每个需要 ID 的接口，都用不存在的合法 ID 测了
□ 7. 注入防护：至少对 2 个不同参数位置（URL param + body field）测了 SQL 注入和 XSS
□ 8. 写操作闭环：每个写操作都有「写 → 查询验证 → 清理还原」三步
□ 9. Long ID 处理：assert 中 ID 比较使用 String() 转换，不用 === 直接比
□ 10. 返回类型核实：每个接口的 data 断言与 Controller 返回类型一致（Void → null, List → 数组, Object → 对象）
□ 11. 错误码规范：所有预期失败的 assert 都验证了 code !== 500
□ 12. 数据清理：main 函数末尾有完整的清理逻辑，测试可重复执行
```

#### 覆盖矩阵输出格式

生成完毕后，必须输出如下矩阵（示例）：

```
| 维度 \ 接口          | create | list | update | delete | active | read | redpots |
|---------------------|--------|------|--------|--------|--------|------|---------|
| 1.正常流程           | ✅     | ✅   | ✅     | ✅     | ✅     | ✅   | ✅      |
| 2.分页边界           | N/A    | ✅   | N/A    | N/A    | N/A    | N/A  | N/A     |
| 3.搜索边界           | N/A    | N/A  | N/A    | N/A    | N/A    | N/A  | N/A     |
| 4.参数校验           | ✅     | ✅   | ✅     | ✅     | ✅     | ✅   | ✅      |
| 5.注入/特殊字符       | ✅     | N/A  | N/A    | N/A    | ✅     | N/A  | N/A     |
| 6.写操作闭环          | ✅     | N/A  | ✅     | ✅     | N/A    | ✅   | N/A     |
| 7.多账号权限          | ✅     | ✅   | ✅     | ✅     | ✅     | N/A  | ✅      |
| 8.不存在/异常数据     | ✅     | N/A  | ✅     | ✅     | N/A    | ✅   | N/A     |
| 9.并发请求           | N/A    | ✅   | N/A    | N/A    | ✅     | N/A  | ✅      |
| 10.响应结构一致性     | N/A    | ✅   | N/A    | N/A    | ✅     | N/A  | N/A     |
| 11.批量接口          | N/A    | N/A  | N/A    | N/A    | N/A    | N/A  | N/A     |
| 12.数据重复检测       | ✅     | N/A  | N/A    | N/A    | N/A    | ✅   | N/A     |
| 13.错误码规范         | ✅     | N/A  | ✅     | ✅     | N/A    | N/A  | N/A     |
```

**矩阵中 ❌ 数量必须为 0 才能进入执行步骤。**

### 第五步：执行并验证

1. 用 `node 05-<需求编号>-test-api.js` 执行
2. 如果有失败，分析原因：
   - 是测试 bug（如假 ID 超 Long 范围）还是接口 bug
   - 修复测试 bug 后重跑
   - 接口 bug 记录并报告
3. 全部通过后告知用例总数和覆盖维度
4. **输出功能点覆盖率**：列出所有功能点，标注每个功能点有多少个 assert 覆盖

## 铁律（踩坑总结）

### 1. 不改操作者自身权限
```
❌ 管理员把用户 A 从 manager 降为 reader → 切换到 A → A 尝试 editRole → 603 权限不足
✅ 管理员改用户 C → 切换到 A（仍是 manager）→ A 改用户 C → 成功
```
多账号写操作测试时，操作目标必须是**第三方用户**，不能是操作者自己。

### 2. 假 ID 不要超类型范围
```
❌ fakeNodeId = '9999999999999999999'  // 超出 Java Long.MAX_VALUE → NumberFormatException → 500
✅ fakeNodeId = '1'                     // 合法 Long，数据库查不到但不会类型异常
```

### 3. CSRF 必须双发
POST 请求必须同时发送：
- Cookie 里的 `XSRF-TOKEN=xxx`
- Header 里的 `X-XSRF-TOKEN: xxx`
只发一个会 403。

### 4. testLogin 路径可能不带模块前缀
`@ApiResource` 注解如果没有 path，生成的路由不带 Controller 包名前缀：
```
❌ /api/v1/auth/testLogin/{email}   // 以为在 auth 模块下
✅ /api/v1/testLogin/{email}         // 实际路径
```
先读 Controller 代码确认。

### 5. 日志内容可能重复但不算分页重复
多次测试后，日志表里会有内容相同的记录（同一操作执行多次）。分页去重验证不能只比 description，要比唯一标识或直接验证 total 一致。

### 6. GET vs POST 的认证差异
`@GetResource` 默认不需要登录（`externalOnly = false`），`@PostResource(externalOnly = true)` 才需要。未登录测试时要区分：
- GET 可能返回 200（但业务层可能报错）
- POST 写操作才会被拦截返回非 200

### 7. 数据必须还原
所有写操作测完必须还原：
- `editRole` 改回原值
- `addRole` 后要 `deleteRole`
- 提升权限后要降回来
否则下次跑脚本数据状态不一致，用例不可重复。

### 8. encodeURIComponent 所有中文和特殊字符
URL 中的中文参数必须编码，否则可能 400 Bad Request：
```javascript
// ✅
GET(`/list?keyword=${encodeURIComponent('可编辑')}&pageNo=1&pageSize=20`)
// ❌
GET(`/list?keyword=可编辑&pageNo=1&pageSize=20`)
```

### 9. 搜索结果验证要考虑多字段匹配
搜索可能匹配 name、nickName、角色中文名等多个字段，验证"结果都包含关键词"时要 OR 所有可搜字段：
```javascript
const allContain = results.every(r =>
  r.name?.includes(keyword) || r.nickName?.includes(keyword)
);
```

### 10. 多账号查数据库确认角色
不要假设某个用户有某个权限，用数据库查实际角色：
```sql
SELECT member_name, email FROM unit_member WHERE space_id = 'xxx'
SELECT control_id, unit_id, role_code FROM control_role WHERE control_id = 'nodeId'
```

### 11. 批量接口必须单独测试
```
❌ 只测了 editRole，假设 batchEditRole 也没问题
✅ editRole 和 batchEditRole 分别写用例，验证返回值结构一致、数据都生效
```
单个/批量版本可能走不同代码路径（参数校验、事务边界、日志记录），必须分别覆盖。

### 12. 空列表参数 ≠ 缺少参数
```
❌ 只测了缺少 unitIds 字段 → 返回参数校验错误
✅ 还要测 unitIds: [] → 可能绕过 @Valid 进入 Service 层，返回 500 而非 400
```
`@NotNull` 不拦截空列表，需要 `@NotEmpty` 或 `@Size(min=1)`。许多项目漏了这个校验。

### 13. 权限不足不应返回 500
```
❌ 只验证 res.success === false 就认为权限拦截成功
✅ 还要验证 res.code !== 500 — 权限不足应该返回 403/603 等业务错误码
```
如果权限校验抛出的异常没被统一异常处理器正确捕获，会作为未知异常返回 500。表面上"请求被拒绝了"，但 500 意味着服务端异常，是 bug。

### 14. 查数据库验证唯一性，不信 API 返回
```
❌ API 返回 records 里只有 1 条 → 认为没有重复
✅ 直接查 DB：SELECT count(*), col1, col2 FROM table GROUP BY col1, col2 HAVING count(*) > 1
```
API 层的 `Collectors.toMap(..., (a, b) -> a)` 或 `DISTINCT` 会掩盖底层重复数据。`saveOrUpdateBatch` 基于主键 id，不基于业务字段，如果表没有 `UNIQUE INDEX`，重复调用写接口会产生脏数据。

### 15. 同类接口的逻辑对称性要验证
```
❌ listTeamRoles 考虑继承、listMemberRoles 不考虑继承 → 没发现不一致
✅ 对着 Controller 代码逐行对比同类接口的实现差异，测试不对称的地方
```
特别关注：继承/非继承、搜索范围差异、权限校验差异。这类不对称有时是 by design，但更多时候是遗漏。

### 16. Java Long ID 在 JS 中精度丢失
```
❌ const id = res.data.id;  // 2043898931580153856 → JS Number 截断为 2043898931580153900
✅ 用 String(id) 比较，或检查后端是否加了 @JsonSerialize(using = ToStringSerializer.class)
```
Java 雪花 ID 超过 `Number.MAX_SAFE_INTEGER`（2^53），JS 会丢失精度。测试脚本中所有 ID 比较必须用 `String()` 转换。如果后端 VO 的 Long 字段加了 `ToStringSerializer`，则 JSON 中 id 为字符串，直接比即可。

### 17. ResponseData\<Void\> 的 data 是 null
```
❌ assert('返回 data 非空', res.data != null);  // Controller 返回 ResponseData<Void>，data 永远是 null
✅ 先读 Controller 确认返回类型，Void → data 为 null，不要断言 data 非空
```
同一功能的不同 Controller 可能返回类型不同（如 `/create` 返回 Void，`/manageback/create` 返回 CreateVo）。必须逐个接口核实。

### 18. 时钟偏差导致时间校验误判
```
❌ publishTime: formatTime(new Date())  // 客户端"现在" vs 服务端"现在"可能差几秒
✅ 测试定时校验时，用明确的未来/过去时间（如 +5min / +15min），避免"刚好是现在"的边界
```
客户端和服务器时钟可能有秒级偏差。测试时间相关的校验逻辑时，不要用"恰好是当前时间"，而应使用足够大的时间差（如 5 分钟后 vs 15 分钟后）来避免误判。

### 19. 写操作必须回查验证数据变更，不只看返回码
```
❌ setVisibilityTag(nodeId, 0) → success=true → 就认为改成功了
✅ setVisibilityTag(nodeId, 0) → success=true → 再 GET 查询该节点 → 断言 visibilityTag === 0
```
MyBatis-Plus 全局 `updateStrategy = NOT_EMPTY` 会静默跳过 Integer 的 0 值、空字符串等"空值"字段。`updateById` 不会报错，只是生成的 UPDATE SQL 不包含该字段。所以**接口返回 success 不代表数据真的改了**。

所有写操作（create / update / set）都必须有「写 → 回查 → 断言字段值」的闭环验证，特别注意：
- Integer/Long 字段设为 0 的场景
- String 字段设为空字符串的场景
- Boolean 字段设为 false 的场景

这类"零值/空值"在 NOT_EMPTY 策略下都会被跳过，必须用回查断言来兜底。

### 20. 测试数据要自给自足，不依赖存量数据
```
❌ 直接从历史列表取第一条来测 republish → 依赖存量数据，换环境就挂
✅ 测试流程自己创建 → 操作 → 验证 → 清理，完整闭环
```
好的测试应该：先创建数据 → 操作该数据 → 验证结果 → 清理。不要依赖数据库里已有的数据。

## 测试文件拆分

当测试规模变大时，单文件会变得难以维护。以下是拆分的规则和方法。

### 何时拆分

满足**任一**条件就应该拆分：
- assert 总数 > 150
- 测试维度 > 10 个
- 使用 > 2 个测试账号
- 单文件超过 500 行
- 测试之间有明显的分组边界（如"基础接口测试" vs "AI/流式/NER 扩展测试"）

### 拆分结构

```
myfeature/xxx/output/
├── 05-<需求编号>-test-utils.js            # 共享基础设施（非业务）
├── 05-<需求编号>-test-api.js              # 基础测试（§1-§10）
└── 05-<需求编号>-test-api-extended.js     # 扩展测试（§11-§20）
```

如果维度更多，可以继续拆：`test-api-permissions.js`、`test-api-concurrent.js` 等。

### 05-<需求编号>-test-utils.js — 提取什么

**原则：只提取与具体业务无关的通用基础设施。**

必须提取的：
```javascript
// 1. 配置常量
const CONFIG = {
    host: process.env.TEST_HOST || 'http://xxx-test.example.com',
    apiPrefix: '/sfuser-api/',
    mainEmail: 'test1@example.com',
    mainPassword: 'xxx',
    crossEmail: 'test2@example.com',     // 跨用户测试
    crossPassword: 'xxx',
    nonWhitelistEmail: 'test3@example.com', // 无权限用户
    nonWhitelistPassword: 'xxx',
};

// 2. 加密工具（如 RSA 登录加密）
function rsaEncrypt(plainText) { ... }

// 3. 测试框架（assert + 统计）
let passed = 0, failed = 0;
function assert(name, condition, detail) { ... }
function getStats() { return { passed, failed }; }

// 4. HTTP 工具（cookie 管理、请求封装）
let cookie = '';
function parseCookies(res) { ... }
async function POST(path, body) { ... }
// 如果项目有特殊参数包装（如 intact_columns、sys_site），也放这里
function withIntactColumns(body) { ... }

// 5. 登录 + Session 管理
async function login(email, password) { ... }
const savedSessions = {};
function saveSession(name) { savedSessions[name] = cookie; }
function restoreSession(name) { cookie = savedSessions[name] || ''; }
function clearSession() { cookie = ''; }

// 6. 常用辅助
async function getCurrentUserId() { ... }
const PREFIX = 'daily-report/weekly-summary/'; // API 路径前缀

// 7. 导出
module.exports = {
    CONFIG, assert, getStats, POST, login,
    saveSession, restoreSession, clearSession,
    getCurrentUserId, PREFIX,
};
```

**不应提取的**（留在各测试文件中）：
- 具体的测试用例函数
- 业务相关的测试数据构造
- 特定维度的断言逻辑

### 测试文件模板

每个测试文件遵循相同的结构：

```javascript
/**
 * [功能名称] - 接口测试（基础 / 扩展）
 * 用法: node 05-<需求编号>-test-api.js
 */
const { CONFIG, assert, getStats, POST, login, saveSession, restoreSession, clearSession, PREFIX } = require('./05-<需求编号>-test-utils');

// ========== 测试用例 ==========
async function test_1_xxx() { ... }
async function test_2_xxx() { ... }

// ========== 执行 ==========
async function main() {
    console.log('🚀 [功能名称] - 接口测试（基础）');
    console.log(`   目标: ${CONFIG.host}`);
    console.log('');

    const ok = await login(CONFIG.mainEmail, CONFIG.mainPassword);
    if (!ok) process.exit(1);
    saveSession('main');

    // 按需登录其他账号
    if (await login(CONFIG.crossEmail, CONFIG.crossPassword)) {
        saveSession('cross');
    }
    restoreSession('main');

    // 执行测试
    await test_1_xxx();
    await test_2_xxx();
    // ...

    const { passed, failed } = getStats();
    console.log(`\n=============================`);
    console.log(`✅ 通过: ${passed}  ❌ 失败: ${failed}  📊 总计: ${passed + failed}`);
    console.log(`=============================`);
    process.exit(failed > 0 ? 1 : 0);
}
main();
```

### 多账号 Session 跨文件共享

关键设计：`test-utils.js` 中的 `cookie` 和 `savedSessions` 是**模块级变量**，`require` 同一模块时共享同一份引用。

```javascript
// test-api.js
const { login, saveSession, restoreSession, clearSession } = require('./05-<需求编号>-test-utils');

// 登录主账号
await login(CONFIG.mainEmail, CONFIG.mainPassword);
saveSession('main');

// 登录第二个账号
await login(CONFIG.crossEmail, CONFIG.crossPassword);
saveSession('cross');

// 切换回主账号
restoreSession('main');

// 测试未登录场景
clearSession();  // ← 不要用 restoreSession('__empty__')，用专门的 clearSession
// ... 测试完后
restoreSession('main');
```

### 维度分配策略

| 基础文件 test-api.js | 扩展文件 test-api-extended.js |
|---|---|
| §1 正常流程 | §11 AI 生成内容/prompt 验证 |
| §2 分页边界 | §12 NER 边界（泛称/混合/英文/去重） |
| §3 搜索边界 | §13 Gzip/编码边界 |
| §4 参数校验 | §14 数据一致性（save→get 字段逐一对比） |
| §5 注入防护 | §15 Upsert 完整性（多次 save 验证更新） |
| §6 写操作验证 | §16 权限矩阵（owner/reporter/stranger） |
| §7 多账号权限 | §17 跨用户完整生命周期 |
| §8 不存在/异常数据 | §18 多用户协作（同项目不同用户/周） |
| §9 并发请求 | §19 批量接口边界 |
| §10 响应结构一致性 | §20 扩展边界（Unicode/emoji/trim/去重） |

**分配原则**：
- 基础文件覆盖通用维度（任何接口都该测的）
- 扩展文件覆盖业务特有维度（AI、NER、加密、协作等）
- 每个文件独立可运行（`node 05-<需求编号>-test-api.js` 和 `node 05-<需求编号>-test-api-extended.js`）

### 动态测试数据

避免测试数据残留导致跨次执行失败：

```javascript
// ❌ 硬编码日期 → 第二次跑时 created=false（数据已存在）
const weekStart = '2026-01-19';

// ✅ 基于时间戳动态生成 → 每次跑都是全新数据
const ts = Date.now();
const dynamicDate = new Date(ts);
// 调整到周一
dynamicDate.setDate(dynamicDate.getDate() - dynamicDate.getDay() + 1 + 7 * Math.floor(ts % 100));
const weekStart = dynamicDate.toISOString().slice(0, 10);

// ✅ 项目名也动态化
const projectName = `测试项目_${ts}`;
```

### 执行方式

```bash
# 分别执行
node 05-<需求编号>-test-api.js
node 05-<需求编号>-test-api-extended.js

# 一起执行（看总结果）
node 05-<需求编号>-test-api.js && node 05-<需求编号>-test-api-extended.js
```

### 拆分铁律

1. **05-<需求编号>-test-utils.js 零业务逻辑**：只有配置、HTTP、登录、断言。绝不放测试用例。
2. **每个文件独立可运行**：不依赖其他测试文件先执行。每个文件自己 login + saveSession。
3. **统计独立**：每个文件有自己的 passed/failed 计数（通过 `getStats()` 获取）。模块级变量在同进程内共享，但每个文件是独立进程，所以互不影响。
4. **clearSession 代替 restoreSession('不存在的key')**：`restoreSession` 取不到 key 会得到 `undefined`，不是空字符串。用专门的 `clearSession()` 清空 cookie。
5. **不要跨文件共享测试数据**：每个文件自己创建需要的数据，不依赖另一个文件先跑。

## 输出

在指定目录下生成测试文件（单文件 `05-<需求编号>-test-api.js` 或拆分后的多文件），执行一遍确认全部通过后，输出：
- **功能点覆盖表**（最重要）：列出功能点对照文档中的每个功能点，标注覆盖的 assert 数量和测试函数名
- 总用例数和通过率（多文件时分别列出 + 汇总）
- 覆盖的维度清单（标注每个维度在哪个文件中）
- 使用的测试账号列表和角色
- 发现的 bug 清单（含严重程度和根因分析）
- DB 层数据质量检查结果（重复数据、缺失索引）
- **未覆盖功能点**：如果有功能点对照文档中的功能点没有被任何 assert 覆盖，单独列出并说明原因（纯前端/无法自动化测试等）

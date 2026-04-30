# 题库导入 Skill

读取本地 txt 题库文件，解析单选题，通过 API 批量导入到考试系统。

## 输入参数

| 参数 | 必填 | 说明 |
|------|------|------|
| filePath | 是 | txt 题库文件路径 |
| token | 是 | API Token（X-API-Token 请求头） |
| examName | 否 | 考试名称。未提供时从文件名自动生成（如 `java-basic.txt` → `java-basic`） |
| examId | 否 | 已有考试 ID。提供时直接导入到该考试，忽略 examName |
| apiBaseUrl | 否 | API 地址，默认 `http://localhost:18080` |

## txt 格式

```
1. 题目内容
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：B
解析：解析内容（可选）
```

题目之间用空行分隔。解析行可省略。

## 执行流程

1. **读取文件** — 读取 filePath，不存在则终止
2. **解析题目** — 按空行分割，用正则提取：
   - 题号行: `/^\d+[.、]\s*(.+)$/`
   - 选项行: `/^([ABCD])[.、]\s*(.+)$/`
   - 答案行: `/^答案[：:]\s*([ABCD])$/`
   - 解析行: `/^解析[：:]\s*(.+)$/`
3. **校验** — 题干非空、ABCD 四选项完整、答案为 A/B/C/D。失败的跳过并记录
4. **确定考试名称** — 优先用户提供的 examName，否则取文件名（去掉扩展名）作为考试名称
5. **调用 API** — curl 导入
6. **报告结果** — 解析 N 道，通过 M 道，导入 K 道，失败原因

## API 调用

### 有 examId：导入到已有考试

```bash
curl -X POST "{apiBaseUrl}/api/open/exams/{examId}/questions/batch" \
  -H "X-API-Token: {token}" \
  -H "Content-Type: application/json" \
  -d '{"questions": [...]}'
```

### 无 examId：自动创建考试并导入（默认走这个）

自动创建的考试默认值：白名单模式、60分钟、1次机会、草稿状态。
同名草稿考试已存在时复用，不重复创建。

```bash
curl -X POST "{apiBaseUrl}/api/open/exams/questions/batch" \
  -H "X-API-Token: {token}" \
  -H "Content-Type: application/json" \
  -d '{"examName": "{examName}", "questions": [...]}'
```

### 请求体格式

```json
{
  "examName": "考试名称",
  "questions": [
    {
      "content": "题干",
      "optionA": "A选项",
      "optionB": "B选项",
      "optionC": "C选项",
      "optionD": "D选项",
      "correctAnswer": "B",
      "analysis": "解析（可为空）"
    }
  ]
}
```

成功响应：`{"code": 200, "msg": "ok", "data": 导入数量}`

## 错误处理

- 文件不存在/为空 → 终止
- 题目校验失败 → 跳过该题，列出原因
- 401 → Token 无效
- 500 → 检查考试是否为草稿状态

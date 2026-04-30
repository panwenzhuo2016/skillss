# Plan: 大纲三级结构右键新增/删除

## Context

大纲编辑器的三级结构（幕 Act / 章 Chapter / 场景 Scene）需要支持右键菜单，提供新增和删除操作。纯前端改动，操作内存中的 `acts` 数组后重新渲染。

## 修改文件

- `mt-tool-web/public/shared.js` — 右键菜单逻辑 + 增删操作函数
- `mt-tool-web/public/shared.css` — 复用已有 `.ctx-menu` 样式（无需新增）
- `mt-tool-web/index.html` — 无需改动（已有 `#ctxMenu` DOM）
- `mt-tool-web/admin.html` — 无需改动

## 实现

### 1. 复用已有右键菜单 `#ctxMenu`

现有 `#ctxMenu` 只有"添加批注"一项，改为动态渲染菜单项（根据右键目标不同显示不同选项）。

### 2. 给三级 header 加 `oncontextmenu`

在 `renderOutline()` 中：
- `.act-header` 加 `oncontextmenu="showStructMenu(event,'act',{ai})"`
- `.chapter-header` 加 `oncontextmenu="showStructMenu(event,'chapter',{ai},{ci})"`
- `.scene-item` 区域加 `oncontextmenu`（已有批注菜单，需合并）

### 3. 右键菜单项

| 右键目标 | 菜单项 |
|---------|--------|
| 幕 Act | 在下方新增幕 / 新增章节 / 删除本幕 |
| 章 Chapter | 在下方新增章节 / 新增场景 / 删除本章节 |
| 场景 Scene | 在下方新增场景 / 删除本场景 |

### 4. 新增函数

```
showStructMenu(e, type, ai, ci, sceneIdx)  — 显示结构右键菜单
addAct(afterIndex)        — 在指定位置后插入新幕
deleteAct(index)          — 删除幕（confirm确认）
addChapter(ai, afterCi)   — 在指定幕的指定位置后插入新章节
deleteChapter(ai, ci)     — 删除章节（confirm确认）
addScene(ai, ci, afterSi) — 在指定章节的指定位置后插入新场景
deleteScene(ai, ci, si)   — 删除场景（confirm确认）
```

每个操作后调用 `renderOutline()` + `refreshMeta()` + `scheduleAutoSave()`。

### 5. 新增项默认值

- 新幕：`{ title: '新幕', chapters: [], open: true, notes: '' }`
- 新章节：`{ title: '新章节', scenes: [], open: true }`
- 新场景：`{ id: '??', title: '新场景', summary: '', body: '', detail: '' }`
  - ID 自动生成：取当前章节最后一个场景的数字+字母递增

### 6. 场景右键菜单合并

场景文字区域（`.scene-title-text`, `.scene-body-text`）已有批注右键菜单。需要合并：
- 选中文字时 → 显示"添加批注"
- 未选中文字时 → 显示"在下方新增场景 / 删除本场景"
- 或者：都显示，菜单同时包含结构操作和批注操作

## 验证

1. 右键幕/章/场景标题，弹出对应菜单
2. 新增操作后大纲正确渲染，meta 场景数更新
3. 删除操作有 confirm 确认，删除后正确渲染
4. 自动保存触发
5. 场景右键仍可添加批注（选中文字时）

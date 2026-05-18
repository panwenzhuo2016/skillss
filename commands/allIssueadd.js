// generateAllIssue.js
// 使用 Node.js 将四个项目目录下的 .txt/.md 文件读取并生成 allIssue.html

const fs = require('fs').promises;
const path = require('path');

const OUTPUT_HTML = path.resolve(process.cwd(), 'allIssue.html');

// 请根据你的环境修改这四个路径（保留 \\ 转义或使用 /）
const PROJECT_PATHS = {
    oa: 'D:\\project\\info-gitlab\\oa\\myfeatrue',
    hr: 'D:\\project\\info-gitlab\\hr\\myfeature',
    collabspace: 'D:\\project\\pt-gitlab\\collabspace\\myfeature',
    jira: 'D:\\project\\pt-gitlab\\jira\\myfeature'
};

// 要读取的文件后缀（小写）
const FILTER_EXTS = ['.txt', '.md'];

// 读取文件时截取预览长度
const PREVIEW_LEN = 500;

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch (e) {
        return false;
    }
}

async function walkDir(dir) {
    const results = [];
    async function _walk(cur) {
        let list;
        try {
            list = await fs.readdir(cur, { withFileTypes: true });
        } catch (e) {
            console.warn('无法读取目录：', cur, e.message);
            return;
        }
        for (const d of list) {
            const full = path.join(cur, d.name);
            if (d.isDirectory()) {
                await _walk(full);
            } else if (d.isFile()) {
                const ext = path.extname(d.name).toLowerCase();
                if (FILTER_EXTS.includes(ext)) {
                    results.push(full);
                }
            }
        }
    }
    await _walk(dir);
    return results;
}

function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function fileUrl(p) {
    // 把本地路径转换为 file:// URL（Windows）
    let abs = path.resolve(p);
    // Windows: replace backslashes and add extra slash after file://
    if (process.platform === 'win32') {
        return 'file:///' + abs.replace(/\\/g, '/');
    } else {
        return 'file://' + abs;
    }
}

async function generate() {
    const projects = Object.keys(PROJECT_PATHS);
    const projectFiles = {};
    for (const p of projects) {
        const dir = PROJECT_PATHS[p];
        if (!await exists(dir)) {
            console.warn(`[WARN] 项目目录不存在：${p} -> ${dir}`);
            projectFiles[p] = [];
            continue;
        }
        console.log(`扫描 ${p} -> ${dir} ...`);
        const files = await walkDir(dir);
        projectFiles[p] = files;
        console.log(`  找到 ${files.length} 个文件`);
    }

    // 构建数据项：读取文件内容（异步）
    const items = []; // { project, filePath, name, createdAt, content, preview }
    for (const p of projects) {
        for (const fp of projectFiles[p]) {
            let content = '';
            let stats = null;
            try {
                content = await fs.readFile(fp, 'utf8');
                stats = await fs.stat(fp);
            } catch (e) {
                console.warn('读取文件失败：', fp, e.message);
                continue;
            }
            const name = path.basename(fp);
            const createdAt = stats && stats.mtime ? stats.mtime.toISOString() : new Date().toISOString();
            const preview = content.length > PREVIEW_LEN ? content.slice(0, PREVIEW_LEN) + '\n\n...[已截断]' : content;
            items.push({
                project: p,
                filePath: fp,
                name,
                createdAt,
                content,
                preview
            });
        }
    }

    // 生成 HTML
    const html = buildHtml(items);
    await fs.writeFile(OUTPUT_HTML, html, 'utf8');
    console.log(`生成完成：${OUTPUT_HTML} （共 ${items.length} 条）`);
}

function buildHtml(items) {
    // group by project
    const groups = items.reduce((acc, it) => {
        (acc[it.project] = acc[it.project] || []).push(it);
        return acc;
    }, {});

    const now = new Date().toISOString();

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>All Issues</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif; background:#f6f8fa; color:#111827; padding:20px; }
  h1 { margin:0 0 8px; }
  .meta { color:#6b7280; margin-bottom:18px; }
  .project { margin-bottom:18px; background:#fff; border-radius:10px; padding:14px; box-shadow:0 6px 18px rgba(15,23,42,.04); border:1px solid #e6e9ef; }
  .proj-title { font-weight:700; color:#1f2937; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; }
  ul.item-list { list-style:none; padding:0; margin:0; }
  li.item { padding:10px; border-top:1px solid #f3f4f6; display:flex; gap:12px; align-items:flex-start; }
  li.item:first-child { border-top:none; }
  .chk { margin-top:4px; }
  .content { flex:1; }
  .fn { font-family: "JetBrains Mono", Consolas, monospace; background:#f3f4f6; padding:6px 8px; border-radius:6px; display:inline-block; color:#1f2937; font-size:13px; }
  .preview { margin-top:6px; white-space:pre-wrap; color:#374151; background:#fbfdff; padding:10px; border-radius:6px; border:1px solid #eef2ff; max-height:220px; overflow:auto; }
  .actions { display:flex; gap:8px; margin-left:8px; }
  .btn { padding:6px 10px; border-radius:8px; border:1px solid #e5e7eb; background:#fff; cursor:pointer; font-size:13px; }
  .btn:hover { transform:translateY(-1px); }
  .btn-primary { background:#2563eb; color:#fff; border-color:#2563eb; }
  .open-link { color:#2563eb; text-decoration:none; font-size:13px; }
  .empty { color:#6b7280; padding:14px; text-align:center; }
  .search { margin-bottom:12px; display:flex; gap:8px; }
  input[type="text"] { padding:8px 10px; border-radius:8px; border:1px solid #e6e9ef; width:320px; }
</style>
</head>
<body>
  <h1>All Issues</h1>
  <div class="meta">生成时间：${escapeHtml(now)} · 共 ${items.length} 条（来源：${Object.keys(PROJECT_PATHS).join(', ') }）</div>

  <div class="search">
    <input id="q" type="text" placeholder="搜索内容..." />
    <button id="btnClear" class="btn">清除已完成</button>
    <button id="btnRefresh" class="btn">刷新（从文件系统重新生成）</button>
  </div>

  ${Object.keys(PROJECT_PATHS).map(p => {
        const list = groups[p] || [];
        if (!list.length) {
            return `<div class="project"><div class="proj-title"><div>${escapeHtml(p)}</div><div class="fn">${escapeHtml(PROJECT_PATHS[p])}</div></div><div class="empty">未找到条目</div></div>`;
        }
        return `<div class="project" data-project="${escapeHtml(p)}">
      <div class="proj-title"><div>${escapeHtml(p)}</div><div class="fn">${escapeHtml(PROJECT_PATHS[p])}</div></div>
      <ul class="item-list">
        ${list.map(it => {
            const id = encodeURIComponent(it.filePath); // 作为唯一 key（编码）
            return `<li class="item" data-file="${escapeHtml(it.filePath)}" data-project="${escapeHtml(it.project)}">
            <div class="chk"><input type="checkbox" class="done-chk" data-key="${id}"></div>
            <div class="content">
              <div><strong>${escapeHtml(it.name)}</strong> <span style="color:#6b7280; margin-left:8px; font-size:13px;">${escapeHtml(it.createdAt)}</span></div>
              <div class="preview" data-full="${escapeHtml(it.content)}">${escapeHtml(it.preview)}</div>
              <div style="margin-top:8px; font-size:13px;">
                <a class="open-link" href="${fileUrl(it.filePath)}" target="_blank">在本地打开</a>
                <span style="margin-left:12px; color:#6b7280;">路径: <code style="background:transparent; padding:0; font-family:monospace;">${escapeHtml(it.filePath)}</code></span>
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-primary btn-view" data-key="${id}">查看全文</button>
            </div>
          </li>`}).join('')}
      </ul>
    </div>`;
    }).join('')}

<script>
  // 页面脚本：支持全文查看、保存已完成到 localStorage、搜索过滤、刷新按钮（只是提示，需要重新生成 allIssue.html）
  const STORAGE_KEY = 'allIssue_done_v1';
  function loadDoneMap(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e){ return {}; } }
  function saveDoneMap(m){ localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); }

  const doneMap = loadDoneMap();

  // 初始化复选框状态
  document.querySelectorAll('.done-chk').forEach(cb => {
    const key = cb.getAttribute('data-key');
    if (doneMap[key]) { cb.checked = true; cb.closest('.item').style.opacity = '0.6'; }
    cb.addEventListener('change', () => {
      const k = cb.getAttribute('data-key');
      if (cb.checked) { doneMap[k] = true; cb.closest('.item').style.opacity = '0.6'; } else { delete doneMap[k]; cb.closest('.item').style.opacity = '1'; }
      saveDoneMap(doneMap);
    });
  });

  // 查看全文按钮
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', () => {
      const li = btn.closest('.item');
      const full = li.querySelector('.preview').getAttribute('data-full') || '';
      // 使用新窗口显示全文（或弹窗）
      const w = window.open('', '_blank', 'width=800,height=600');
      const safe = full.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      w.document.write('<pre style="white-space:pre-wrap;font-family:monospace;padding:12px;">' + safe + '</pre>');
      w.document.title = li.querySelector('strong').textContent;
    });
  });

  // 搜索
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    document.querySelectorAll('.item').forEach(it => {
      const txt = (it.getAttribute('data-file') + ' ' + it.textContent).toLowerCase();
      it.style.display = txt.includes(v) ? '' : 'none';
    });
  });

  // 清除已完成（仅从页面状态清除，不删除文件）
  document.getElementById('btnClear').addEventListener('click', () => {
    if (!confirm('确认清除页面中所有已标记的“已完成”状态？（不会删除文件）')) return;
    const keys = Object.keys(doneMap);
    keys.forEach(k => {
      delete doneMap[k];
      const cb = document.querySelector('.done-chk[data-key="'+k+'"]');
      if (cb) { cb.checked = false; const li = cb.closest('.item'); if (li) li.style.opacity = '1'; }
    });
    saveDoneMap(doneMap);
    alert('已清除');
  });

  // 刷新（提示用户需要重新运行 Node 脚本）
  document.getElementById('btnRefresh').addEventListener('click', () => {
    alert('要刷新文件列表，请重新运行 generateAllIssue.js 来重新生成 allIssue.html，然后在浏览器中刷新页面。');
  });

  // 支持点击预览展开全文（在当前页面）
  document.querySelectorAll('.preview').forEach(p => {
    p.addEventListener('click', () => {
      const full = p.getAttribute('data-full') || '';
      if (p.dataset.expanded === '1') {
        // 收回到预览：只保留前 N chars shown originally (we don't keep original preview length here, so just collapse to 200 chars)
        const short = full.length > 500 ? full.slice(0,500) + '\\n\\n...[已截断]' : full;
        p.textContent = short;
        p.dataset.expanded = '0';
      } else {
        p.textContent = full;
        p.dataset.expanded = '1';
      }
    });
  });

  // 链接 file:// 在某些浏览器可能会被阻止（浏览器安全策略）。如果点击无效，请手动在文件管理器打开该文件。
</script>

</body>
</html>`;
}

generate().catch(err => {
    console.error('生成失败：', err);
    process.exit(1);
});

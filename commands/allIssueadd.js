// generateAllIssueFolders.js
// 增量扫描四个项目目录，识别以 YYMMDD- 开头的文件夹（例如 260514-xxx），生成 allIssue.html
// 不读取文件内容，只按文件夹名与 mtime 做增量

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const FORCE_FULL = ARGV.includes('--full') || ARGV.includes('-f');

const OUTPUT_HTML = path.resolve(process.cwd(), 'allIssue.html');
const CACHE_FILE = path.resolve(process.cwd(), 'allIssue.folders.cache.json');

// 请根据你的环境修改这四个路径（注意转义或使用 /）
const PROJECT_PATHS = {
    oa: 'D:\\project\\info-gitlab\\oa\\myfeatrue',
    hr: 'D:\\project\\info-gitlab\\hr\\myfeature',
    collabspace: 'D:\\project\\pt-gitlab\\collabspace\\myfeature',
    jira: 'D:\\project\\pt-gitlab\\jira\\myfeature'
};

// 识别开头为 YYMMDD- 的文件夹名（6 位数字 + '-' + 后缀）
const DATE_FOLDER_RE = /^\d{6}-.+/;

// 是否递归扫描子目录（通常项目目录下直接包含需求文件夹或若要深度请保留 true）
const RECURSIVE_SCAN = true;

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch (e) {
        return false;
    }
}

async function walkDirs(root) {
    const results = [];
    async function _walk(cur) {
        let list;
        try {
            list = await fs.readdir(cur, { withFileTypes: true });
        } catch (e) {
            // 无权限或不存在，跳过
            return;
        }
        for (const d of list) {
            const full = path.join(cur, d.name);
            if (d.isDirectory()) {
                // 如果文件夹名符合日期开头，收集；不会继续深入该符合项下面（但会如果需要可以）
                if (DATE_FOLDER_RE.test(d.name)) {
                    results.push(full);
                    // 仍要递归以便找到更深层次也符合的文件夹（如果需要）
                    if (RECURSIVE_SCAN) {
                        await _walk(full);
                    }
                } else {
                    // 仅继续递归（如果允许）
                    if (RECURSIVE_SCAN) await _walk(full);
                }
            }
        }
    }
    await _walk(root);
    return results;
}

function fileUrl(p) {
    const abs = path.resolve(p);
    if (process.platform === 'win32') {
        return 'file:///' + abs.replace(/\\/g, '/');
    } else {
        return 'file://' + abs;
    }
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function readCache() {
    try {
        if (!fssync.existsSync(CACHE_FILE)) return { folders: {} };
        const raw = await fs.readFile(CACHE_FILE, 'utf8');
        return JSON.parse(raw || '{"folders":{}}');
    } catch (e) {
        console.warn('读取缓存失败，将使用空缓存：', e.message);
        return { folders: {} };
    }
}

async function writeCache(cache) {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

async function generate() {
    console.log('增量扫描（按文件夹名）生成 allIssue.html');
    console.log('force full:', FORCE_FULL);

    const cache = FORCE_FULL ? { folders: {} } : await readCache();
    const seen = new Set(); // 本次扫描见到的 folderPath

    const projects = Object.keys(PROJECT_PATHS);

    for (const p of projects) {
        const dir = PROJECT_PATHS[p];
        if (!await exists(dir)) {
            console.warn(`[WARN] 项目目录不存在：${p} -> ${dir}`);
            continue;
        }

        console.log(`扫描项目 ${p} -> ${dir}`);
        const folders = await walkDirs(dir);

        for (const folderPath of folders) {
            seen.add(folderPath);
            let stats;
            try {
                stats = await fs.stat(folderPath);
            } catch (e) {
                console.warn('stat 失败：', folderPath, e.message);
                continue;
            }
            const mtimeMs = stats.mtimeMs || 0;
            const name = path.basename(folderPath);

            const cached = cache.folders[folderPath];
            if (!cached) {
                // 新增
                cache.folders[folderPath] = {
                    project: p,
                    folderPath,
                    name,
                    mtimeMs
                };
                console.log('新增需求目录：', folderPath);
            } else {
                // 已存在，若 mtime 变化则更新 mtime
                if (cached.mtimeMs !== mtimeMs) {
                    cached.mtimeMs = mtimeMs;
                    cached.project = p; // 项目可能改变（若移动）
                    cached.name = name;
                    console.log('更新需求目录（mtime变化）：', folderPath);
                } else {
                    // 无变化，保持缓存
                    if (!cached.project) cached.project = p;
                }
            }
        }
    }

    // 清理已删除的缓存条目（不再存在的文件夹）
    const cachedPaths = Object.keys(cache.folders);
    for (const cp of cachedPaths) {
        if (!seen.has(cp)) {
            console.log('移除已删除的目录缓存：', cp);
            delete cache.folders[cp];
        }
    }

    // 写回缓存
    cache.updatedAt = new Date().toISOString();
    await writeCache(cache);

    // 生成 items 数组并排序（按 mtime 降序）
    const items = Object.values(cache.folders).sort((a,b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

    // 生成 HTML
    const html = buildHtml(items);
    await fs.writeFile(OUTPUT_HTML, html, 'utf8');
    console.log(`生成完成：${OUTPUT_HTML} （共 ${items.length} 条）`);
}

function buildHtml(items) {
    const now = new Date().toISOString();

    // 分组显示（按项目）
    const groups = items.reduce((acc, it) => {
        (acc[it.project] = acc[it.project] || []).push(it);
        return acc;
    }, {});

    const projects = Object.keys(PROJECT_PATHS);

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>All Issues (folders)</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif; background:#f6f8fa; color:#111827; padding:20px; }
  h1 { margin:0 0 8px; }
  .meta { color:#6b7280; margin-bottom:18px; }
  .project { margin-bottom:18px; background:#fff; border-radius:10px; padding:14px; box-shadow:0 6px 18px rgba(15,23,42,.04); border:1px solid #e6e9ef; }
  .proj-title { font-weight:700; color:#1f2937; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; }
  ul.item-list { list-style:none; padding:0; margin:0; }
  li.item { padding:10px; border-top:1px solid #f3f4f6; display:flex; gap:12px; align-items:center; }
  li.item:first-child { border-top:none; }
  .chk { margin-top:4px; }
  .content { flex:1; }
  .fn { font-family: "JetBrains Mono", Consolas, monospace; background:#f3f4f6; padding:6px 8px; border-radius:6px; display:inline-block; color:#1f2937; font-size:13px; }
  .foldername { font-weight:700; color:#0f172a; }
  .small { color:#6b7280; font-size:13px; margin-left:8px; }
  .actions { display:flex; gap:8px; margin-left:8px; }
  .btn { padding:6px 10px; border-radius:8px; border:1px solid #e5e7eb; background:#fff; cursor:pointer; font-size:13px; }
  .open-link { color:#2563eb; text-decoration:none; font-size:13px; }
  .empty { color:#6b7280; padding:14px; text-align:center; }
  .search { margin-bottom:12px; display:flex; gap:8px; }
  input[type="text"] { padding:8px 10px; border-radius:8px; border:1px solid #e6e9ef; width:320px; }
</style>
</head>
<body>
  <h1>All Issues (folders)</h1>
  <div class="meta">生成时间：${escapeHtml(now)} · 共 ${items.length} 条 · 数据来源：本地项目目录（按文件夹名识别）</div>

  <div class="search">
    <input id="q" type="text" placeholder="搜索文件夹名/路径..." />
    <button id="btnClear" class="btn">清除已完成</button>
    <button id="btnRefresh" class="btn">提示：如需刷新请重新运行脚本</button>
  </div>

  ${projects.map(p => {
        const list = groups[p] || [];
        if (!list.length) {
            return `<div class="project"><div class="proj-title"><div>${escapeHtml(p)}</div><div class="fn">${escapeHtml(PROJECT_PATHS[p])}</div></div><div class="empty">未找到以日期开头的目录</div></div>`;
        }
        return `<div class="project" data-project="${escapeHtml(p)}">
      <div class="proj-title"><div>${escapeHtml(p)}</div><div class="fn">${escapeHtml(PROJECT_PATHS[p])}</div></div>
      <ul class="item-list">
        ${list.map(it => {
            const id = encodeURIComponent(it.folderPath);
            const mtime = new Date(it.mtimeMs || Date.now()).toISOString();
            return `<li class="item" data-folder="${escapeHtml(it.folderPath)}" data-project="${escapeHtml(it.project)}">
            <div class="content">
              <div><span class="foldername">${escapeHtml(it.name)}</span><span class="small">${escapeHtml(mtime)}</span></div>
              <div style="margin-top:8px; font-size:13px;">
                <a class="open-link" href="${fileUrl(it.folderPath)}" target="_blank">在文件管理器打开</a>
                <span style="margin-left:12px; color:#6b7280;">路径: <code style="background:transparent; padding:0; font-family:monospace;">${escapeHtml(it.folderPath)}</code></span>
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-open" data-key="${id}">在浏览器中打开</button>
            </div>
          </li>`}).join('')}
      </ul>
    </div>`;
    }).join('')}

<script>
  // 页面脚本：支持“在浏览器中打开”（使用 file://）与本地标记已完成保存在 localStorage
  const STORAGE_KEY = 'allIssue_folders_done_v1';
  function loadDone(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e){ return {}; } }
  function saveDone(m){ localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); }

  const doneMap = loadDone();

  document.querySelectorAll('.item').forEach(li => {
    const folder = li.getAttribute('data-folder');
    const key = encodeURIComponent(folder);
    // 添加复选框并应用状态
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!doneMap[key];
    chk.style.marginRight = '10px';
    chk.addEventListener('change', () => {
      if (chk.checked) doneMap[key] = true; else delete doneMap[key];
      saveDone(doneMap);
      li.style.opacity = chk.checked ? '0.6' : '1';
    });
    li.querySelector('.content').insertAdjacentElement('afterbegin', chk);
    if (chk.checked) li.style.opacity = '0.6';
  });

  // btn-open 打开文件夹（在新标签打开 file:// URL 或者打开空页并提示）
  document.querySelectorAll('.btn-open').forEach(btn => {
    btn.addEventListener('click', () => {
      const li = btn.closest('.item');
      const folder = li.getAttribute('data-folder');
      // 打开 file:// URL，某些浏览器可能会阻止直接导航到 file://，建议在浏览器直接打开本地文件
      const url = (function(p){
        if (navigator.platform && /Win/.test(navigator.platform)) {
          return 'file:///' + p.replace(/\\\\/g, '/').replace(/\\/g, '/');
        } else {
          return 'file://' + p;
        }
      })(folder);
      window.open(url, '_blank');
    });
  });

  // 搜索过滤
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    document.querySelectorAll('.item').forEach(it => {
      const txt = (it.getAttribute('data-folder') + ' ' + it.textContent).toLowerCase();
      it.style.display = txt.includes(v) ? '' : 'none';
    });
  });

  document.getElementById('btnClear').addEventListener('click', () => {
    if (!confirm('确认清除页面中所有已标记的“已完成”状态？（不会删除文件）')) return;
    Object.keys(doneMap).forEach(k => delete doneMap[k]);
    saveDone(doneMap);
    document.querySelectorAll('.item').forEach(it => { it.style.opacity = '1'; it.querySelector('input[type="checkbox"]').checked = false; });
    alert('已清除');
  });

  document.getElementById('btnRefresh').addEventListener('click', () => {
    alert('如需刷新目录列表，请重新运行 generateAllIssueFolders.js');
  });
</script>

</body>
</html>`;
}

generate().catch(err => {
    console.error('生成失败：', err);
    process.exit(1);
});

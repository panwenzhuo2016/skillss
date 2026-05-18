// 【AI逻辑总结】
// 读取当天 claude-answer-all-YYYYMMDD.html 文件，
// 提取所有包含「本次回答花费」的行中的美元金额，
// 累加并打印每条匹配行与总计花费。

const fs = require('fs');
const path = require('path');
const os = require('os');

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

const filePath = path.join(
  os.homedir(),
  '.claude',
  'commands',
  `claude-answer-all-${formatDate(new Date())}.html`,
);

const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split(/\r?\n/);

let total = 0;
for (const line of lines) {
  if (line.includes('本次回答花费')) {
    const start = line.indexOf(' $');
    const end = line.indexOf('</span>');
    if (start !== -1 && end !== -1 && end > start) {
      const value = parseFloat(line.substring(start + 2, end));
      if (!Number.isNaN(value)) {
        total += value;
      }
    }
    console.log(line);
  }
}

console.log(total);

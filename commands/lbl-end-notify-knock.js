#!/usr/bin/env node
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { gatherContext } = require('./lbl-end-shared');

const KNOCK_URL = 'http://oa-chn.xinyoudi.com/third-api/request';
const CLIENT_ID = 'apitable';
const CLIENT_SECRET = '0977ad6723022fbebd8d5566140f5c14';
const MSG_TYPE = 'knock_send_grt_msg';
const GROUP_TOKEN = 'GRT:97aEBC04OFz8';
const NICKNAME = '罗贝林';

function sign(payloadStr) {
  const params = {
    api_secret: CLIENT_SECRET,
    client_id: CLIENT_ID,
    key: MSG_TYPE,
    payload: payloadStr,
  };
  const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function postKnock(reqBody) {
  return new Promise((resolve, reject) => {
    const u = new URL(KNOCK_URL);
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqBody),
      },
      timeout: 8000,
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.error('[knock] HTTP', res.statusCode, body);
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          resolve(body);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      console.error('[knock] err:', err.message);
      reject(err);
    });
    req.write(reqBody);
    req.end();
  });
}

async function sendGroupRich(title, content) {
  const richContent = JSON.stringify({ title, content });
  const payloadObj = {
    nicknames: [NICKNAME],
    content: richContent,
    msg_type: 'MSG_TYPE_RICH_CARD',
    group_robot_token: GROUP_TOKEN,
  };
  const payloadStr = JSON.stringify(payloadObj);
  const reqBody = JSON.stringify({
    client_id: CLIENT_ID,
    key: MSG_TYPE,
    payload: payloadStr,
    sign: sign(payloadStr),
  });
  return postKnock(reqBody);
}

function truncateChars(s, n) {
  const chars = Array.from(String(s || ''));
  return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
}

(async () => {
  const ctx = await gatherContext();
  const summaryLine = ctx.hasText ? ctx.summary : '（无文本回复 / 仅工具调用）';
  const inputLine = `> 我说：${truncateChars(ctx.userInput, 25)}`;
  try {
    const content = inputLine + '\n\n' + summaryLine + '\n\n' + ctx.statsLine;
    const resp = await sendGroupRich(`爹，干完了：${ctx.sessionName}`, content);
    console.log('[knock] ok:', resp);
  } catch (err) {
    console.error('[knock] 发送失败:', err.message);
    process.exit(1);
  }
})();
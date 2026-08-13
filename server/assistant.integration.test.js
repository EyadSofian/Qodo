import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 45_000 + Math.floor(Math.random() * 1_000);
const AI_PORT = PORT + 1_000;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
let fakeAi;
let adminCookie;

before(async () => {
  fakeAi = http.createServer((req, res) => {
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const chunk = {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call-create-task',
                type: 'function',
                function: {
                  name: 'create_task',
                  arguments: JSON.stringify({ title: 'مراجعة العقد', priority: 'high' }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      })}\n\n`
    );
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => fakeAi.listen(AI_PORT, '127.0.0.1', resolve));

  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-assistant-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'assistant-test-session-secret-12345678',
      SSO_SECRET: 'assistant-test-sso-secret-1234567890',
      OPENAI_API_KEY: '',
      QODO_AI_BASE_URL: `http://127.0.0.1:${AI_PORT}/v1`,
      QODO_AI_API_KEY: 'test-key',
      QODO_AI_MODEL: 'qodo-test-model',
      GOOGLE_CLIENT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let errors = '';
  server.stderr.on('data', (chunk) => {
    errors += chunk.toString();
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) break;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!(await fetch(`${ORIGIN}/api/health`)).ok) {
    throw new Error(`Assistant test server did not start.\n${errors}`);
  }
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.local', password: 'AdminPass123!' },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  adminCookie = login.cookie;
});

after(async () => {
  if (server && !server.killed) server.kill();
  if (fakeAi) await new Promise((resolve) => fakeAi.close(resolve));
  if (dataDirectory?.startsWith(os.tmpdir())) {
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${ORIGIN}/api${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return {
    status: response.status,
    data,
    text,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

function sseEvents(text) {
  return text
    .split('\n\n')
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
}

test('the compatible provider drafts a write and only confirmation creates it once', async () => {
  const status = await request('/assistant/status', { cookie: adminCookie });
  assert.deepEqual(status.data, {
    available: true,
    model: 'qodo-test-model',
    provider: 'qodo-compatible',
  });

  const beforeTasks = await request('/tasks', { cookie: adminCookie });
  assert.equal(beforeTasks.status, 200);

  const chat = await request('/assistant/chat', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      lang: 'ar',
      messages: [{ role: 'user', content: 'اعمل تاسك مراجعة العقد' }],
    },
  });
  assert.equal(chat.status, 200, chat.text);
  const confirmation = sseEvents(chat.text).find((event) => event.type === 'confirmation');
  assert.ok(confirmation?.actionId, chat.text);
  assert.equal(confirmation.arguments.title, 'مراجعة العقد');

  const stillUnchanged = await request('/tasks', { cookie: adminCookie });
  assert.equal(stillUnchanged.data.tasks.length, beforeTasks.data.tasks.length);

  const confirmed = await request('/assistant/confirm', {
    method: 'POST',
    cookie: adminCookie,
    body: { actionId: confirmation.actionId, lang: 'ar' },
  });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.result.task.title, 'مراجعة العقد');

  const afterTasks = await request('/tasks', { cookie: adminCookie });
  assert.equal(afterTasks.data.tasks.length, beforeTasks.data.tasks.length + 1);

  const replay = await request('/assistant/confirm', {
    method: 'POST',
    cookie: adminCookie,
    body: { actionId: confirmation.actionId, lang: 'ar' },
  });
  assert.equal(replay.status, 410);
  const afterReplay = await request('/tasks', { cookie: adminCookie });
  assert.equal(afterReplay.data.tasks.length, afterTasks.data.tasks.length);
});

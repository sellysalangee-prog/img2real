// 자동 녹화 장치 (CLAUDE.md 4항)
//
// 훅 모드: .claude/settings.json의 PostToolUse 훅이 부릅니다.
//   작업 기록(logs/office-log.jsonl)의 마지막 줄이 클로드의 "완료"이고 clip 칸이 있으면
//   홈페이지를 PC 화면 크기로 약 8초 녹화해 clips/순번_clip.webm으로 저장합니다.
// 직접 모드: npm run record -- <clip> [--page 경로] [--out 폴더]
//   기록과 상관없이 바로 녹화합니다. 다시 찍기나 시험 녹화에 씁니다.

import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG_FILE = join(ROOT, 'logs', 'office-log.jsonl');
const CLIP_DIR = join(ROOT, 'clips');
const DEFAULT_PAGE = 'index.html';
const VIEWPORT = { width: 1920, height: 1080 };
const DURATION_MS = 8000;
const CLIP_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
};

// 홈페이지에 필요 없는 파일은 보여 주지 않습니다. 점(.)으로 시작하는 폴더·파일과 작업 기록이 대상입니다.
const HIDDEN = (segments) => segments.some((s) => s.startsWith('.')) || segments[0] === 'logs';

function insideRoot(file) {
  return file === ROOT || file.startsWith(ROOT + sep);
}

// 프로젝트 폴더를 http://localhost 로 보여 주는 작은 서버. 포트는 비어 있는 번호를 씁니다.
function startServer() {
  const server = createServer((req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(ROOT, '.' + path);
    if (!insideRoot(file) || HIDDEN(relative(ROOT, file).split(sep))) {
      res.writeHead(403).end();
      return;
    }
    try {
      // 바로가기(정션·심볼릭 링크)가 프로젝트 밖을 가리키면 막습니다.
      if (!insideRoot(realpathSync(file))) {
        res.writeHead(403).end();
        return;
      }
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

function nextNumber(dir) {
  const used = existsSync(dir)
    ? readdirSync(dir).map((f) => /^(\d+)_/.exec(f)?.[1]).filter(Boolean).map(Number)
    : [];
  return String(Math.max(0, ...used) + 1).padStart(2, '0');
}

function alreadyRecorded(dir, clip) {
  return existsSync(dir) && readdirSync(dir).some((f) => new RegExp(`^\\d+_${clip}\\.webm$`).test(f));
}

// 녹화는 브라우저 창을 연 순간부터 DURATION_MS 동안입니다. 페이지가 늦게 열려도 영상 길이는 늘지 않습니다.
async function record(clip, page, outDir) {
  const { chromium } = await import('playwright');
  const rawDir = mkdtempSync(join(tmpdir(), 'i2r-clip-'));
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: rawDir, size: VIEWPORT },
    });
    const tab = await context.newPage();
    const started = Date.now();
    const url = `http://localhost:${server.address().port}/${page.split(/[\\/]/).join('/')}`;
    await tab.goto(url, { waitUntil: 'load', timeout: DURATION_MS }).catch(() => {});
    await tab.waitForTimeout(Math.max(0, DURATION_MS - (Date.now() - started)));
    await context.close();
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, `${nextNumber(outDir)}_${clip}.webm`);
    await tab.video().saveAs(target);
    return target;
  } finally {
    await browser?.close();
    server?.close();
    rmSync(rawDir, { recursive: true, force: true });
  }
}

function lastLogEntry() {
  if (!existsSync(LOG_FILE)) return null;
  const lines = readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    return null;
  }
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((ok) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => ok(data));
  });
}

// 클로드에게 결과를 알려 줍니다. 훅은 실패해도 작업을 막지 않도록 항상 정상 종료합니다.
function report(message) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `[자동 녹화] ${message}` },
  }));
}

async function hookMode() {
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || '{}');
  } catch {
    return;
  }
  const touched = JSON.stringify(input.tool_input ?? {});
  if (!touched.includes('office-log.jsonl')) return;

  const entry = lastLogEntry();
  if (!entry || entry.from !== 'claude' || entry.state !== '완료') return;
  const clip = entry.clip ?? '';
  if (!clip) {
    report('clip 칸이 비어 있어 녹화하지 않았습니다.');
    return;
  }
  if (!CLIP_NAME.test(clip)) {
    report(`clip 이름 "${clip}"이 규칙(영어 소문자와 하이픈)에 맞지 않아 녹화하지 않았습니다.`);
    return;
  }
  if (alreadyRecorded(CLIP_DIR, clip)) {
    report(`"${clip}" 클립이 이미 있어 녹화하지 않았습니다. 다시 찍으려면 npm run record -- ${clip}`);
    return;
  }
  if (!existsSync(join(ROOT, DEFAULT_PAGE))) {
    report(`홈페이지(${DEFAULT_PAGE})가 아직 없어 녹화하지 않았습니다.`);
    return;
  }
  try {
    const saved = await record(clip, DEFAULT_PAGE, CLIP_DIR);
    report(`녹화를 저장했습니다: ${relative(ROOT, saved)}`);
  } catch (err) {
    report(`녹화에 실패했습니다: ${err.message}`);
  }
}

async function directMode(args) {
  const clip = args[0];
  const option = (name) => {
    const i = args.indexOf(name);
    return i > 0 ? args[i + 1] : undefined;
  };
  if (!CLIP_NAME.test(clip ?? '')) {
    console.error('사용법: npm run record -- <clip> [--page 경로] [--out 폴더]  (clip은 영어 소문자와 하이픈)');
    process.exit(1);
  }
  const page = option('--page') ?? DEFAULT_PAGE;
  if (!existsSync(join(ROOT, page))) {
    console.error(`페이지가 없습니다: ${page}`);
    process.exit(1);
  }
  const saved = await record(clip, page, resolve(option('--out') ?? CLIP_DIR));
  console.log(`녹화를 저장했습니다: ${saved}`);
}

const args = process.argv.slice(2);
if (args.length) await directMode(args);
else await hookMode();

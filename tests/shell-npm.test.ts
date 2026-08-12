import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, VirtualFs } from '@/lib/runners/cli-sim';

function newShell(files: Record<string, string> = {}, allowed: string[] = []) {
  const fs = new VirtualFs(files);
  return { shell: new Shell(fs, allowed), fs };
}

/* ── Andamiaje ───────────────────────────────────────────────────── */

test('npm create vite genera un proyecto React completo', () => {
  const { shell, fs } = newShell();
  const result = shell.execute('npm create vite@latest app -- --template react');

  assert.equal(result.exitCode, 0);
  assert.ok(fs.exists('app/package.json'));
  assert.ok(fs.exists('app/src/main.jsx'));
  assert.ok(fs.exists('app/src/App.jsx'));
  assert.ok(fs.exists('app/index.html'));
  assert.ok(result.touched.length >= 5, 'debe reportar los archivos creados');
});

test('la plantilla de Vue genera .vue y no .jsx', () => {
  const { shell, fs } = newShell();
  shell.execute('npm create vite@latest app -- --template vue');

  assert.ok(fs.exists('app/src/App.vue'));
  assert.equal(fs.exists('app/src/App.jsx'), false);
});

test('una plantilla inexistente falla diciendo cuáles hay', () => {
  const { shell } = newShell();
  const result = shell.execute('npm create vite@latest app -- --template svelte');

  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('react'), 'el error debe listar las disponibles');
});

test('no sobrescribe un directorio existente', () => {
  const { shell } = newShell({ 'app/algo.txt': 'x' });
  const result = shell.execute('npm create vite@latest app -- --template react');

  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('ya existe'));
});

/* ── Instalación ─────────────────────────────────────────────────── */

test('npm install fuera de la carpeta del proyecto falla con una pista útil', () => {
  const { shell } = newShell();
  shell.execute('npm create vite@latest app -- --template react');

  const result = shell.execute('npm install'); // sin cd
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('package.json'));
  assert.ok(result.stderr.includes('cd'), 'debe sugerir el cd');
});

test('⭐ el flujo completo de la lección funciona: create → cd → install → dev', () => {
  const { shell, fs } = newShell();

  assert.equal(shell.execute('npm create vite@latest app -- --template react').exitCode, 0);
  assert.equal(shell.execute('cd app').exitCode, 0);
  assert.equal(shell.getCwd(), '/app');

  const install = shell.execute('npm install');
  assert.equal(install.exitCode, 0);
  assert.ok(fs.exists('app/node_modules/react/package.json'), 'react debe quedar instalado');
  assert.ok(install.touched.some((path) => path.includes('node_modules')));

  const dev = shell.execute('npm run dev');
  assert.equal(dev.exitCode, 0);
  assert.ok(dev.stdout.includes('5173'));
  assert.equal(shell.isDevServerRunning(), true);
});

test('npm run dev sin node_modules falla antes de arrancar', () => {
  const { shell } = newShell();
  shell.execute('npm create vite@latest app -- --template react');
  shell.execute('cd app');

  const result = shell.execute('npm run dev');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('node_modules'));
});

test('un script inexistente enumera los disponibles', () => {
  const { shell } = newShell();
  shell.execute('npm create vite@latest app -- --template react');
  shell.execute('cd app');
  shell.execute('npm install');

  const result = shell.execute('npm run arrancar');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('dev'), 'debe listar los scripts reales');
});

/* ── Navegación ──────────────────────────────────────────────────── */

test('cd entra, sube y rechaza rutas inexistentes', () => {
  const { shell } = newShell({ 'app/src/main.jsx': 'x' });

  assert.equal(shell.execute('cd app').exitCode, 0);
  assert.equal(shell.getCwd(), '/app');

  assert.equal(shell.execute('cd src').exitCode, 0);
  assert.equal(shell.getCwd(), '/app/src');

  assert.equal(shell.execute('cd ..').exitCode, 0);
  assert.equal(shell.getCwd(), '/app');

  assert.equal(shell.execute('cd fantasma').exitCode, 1);
  assert.equal(shell.getCwd(), '/app', 'un cd fallido no mueve el cwd');
});

test('ls y cat respetan el directorio actual', () => {
  const { shell } = newShell({ 'app/package.json': '{"name":"x"}', 'raiz.md': 'y' });

  assert.ok(shell.execute('ls').stdout.includes('raiz.md'));

  shell.execute('cd app');
  assert.ok(shell.execute('ls').stdout.includes('package.json'));
  assert.ok(shell.execute('cat package.json').stdout.includes('"name"'));
});

/* ── Barandilla de comandos ──────────────────────────────────────── */

test('un comando fuera de la lista permitida se bloquea con la lista visible', () => {
  const { shell } = newShell({}, ['npm', 'ls', 'cd']);

  const result = shell.execute('rm -rf node_modules');
  assert.equal(result.exitCode, 126);
  assert.ok(result.stderr.includes('npm'), 'debe decir qué SÍ se puede usar');

  assert.notEqual(shell.execute('ls').exitCode, 126);
});

test('sin lista de permitidos no se bloquea nada', () => {
  const { shell } = newShell();
  assert.notEqual(shell.execute('rm algo').exitCode, 126);
});

/* ── Transcripción, para la regla cli-transcript de la Fase 4 ────── */

test('la transcripción registra todo, incluidos los comandos fallidos', () => {
  const { shell } = newShell();
  shell.execute('npm create vite@latest app -- --template react');
  shell.execute('npm install');
  shell.execute('cd app');

  assert.deepEqual(shell.getTranscript(), [
    'npm create vite@latest app -- --template react',
    'npm install',
    'cd app',
  ]);
});

/* ── El simulador de Docker sigue intacto tras la extracción ─────── */

test('docker build sigue funcionando desde la shell extraída', () => {
  const { shell } = newShell({
    Dockerfile: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\n',
    'package.json': '{"name":"api"}',
  });

  const first = shell.execute('docker build -t api .');
  assert.equal(first.exitCode, 0);
  assert.ok(first.stdout.includes('Step 1/'));

  const second = shell.execute('docker build -t api .');
  assert.ok(second.stdout.includes('Using cache'), 'el segundo build debe reutilizar capas');
});

test('docker history revela los secretos horneados en el Dockerfile', () => {
  const { shell } = newShell({
    Dockerfile: 'FROM node:20\nENV API_KEY=sk-live-123456\nCMD ["node"]\n',
  });

  const result = shell.execute('docker history api');
  assert.ok(result.stdout.includes('API_KEY'), 'el secreto debe verse en el historial');
});

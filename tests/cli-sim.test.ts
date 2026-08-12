import assert from 'node:assert/strict';
import test from 'node:test';
import { dockerBuild, parseDockerfile, VirtualFs } from '@/lib/runners/cli-sim';

const BROKEN_DOCKERFILE = `FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
ENV API_KEY=sk-live-8f3a2b91c4
EXPOSE 3000
CMD ["node", "dist/server.js"]
`;

const FIXED_DOCKERFILE = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
`;

function makeFs(dockerfile: string, dockerignore = '') {
  return new VirtualFs({
    Dockerfile: dockerfile,
    '.dockerignore': dockerignore,
    'package.json': '{"name":"api","dependencies":{"express":"4.19.2"}}',
    'src/server.ts': 'import express from "express";\napp.listen(3000);',
  });
}

/* ── Parser ──────────────────────────────────────────────────────── */

test('el parser reconoce fases, imagen base y COPY --from', () => {
  const parsed = parseDockerfile(FIXED_DOCKERFILE);

  assert.equal(parsed.stages.length, 2);
  assert.equal(parsed.stages[0].name, 'builder');
  assert.equal(parsed.stages[0].baseImage, 'node:20-alpine');
  assert.equal(parsed.stages[1].name, 'runtime');
  assert.deepEqual(parsed.stages[1].copiesFrom, ['builder']);
});

test('el parser une líneas continuadas con barra invertida', () => {
  const parsed = parseDockerfile('FROM alpine\nRUN apk add curl && \\\n    apk add git\n');
  const run = parsed.instructions.find((i) => i.instruction === 'RUN');
  assert.equal(run?.args, 'apk add curl && apk add git');
});

test('el parser ignora comentarios y líneas vacías', () => {
  const parsed = parseDockerfile('# comentario\n\nFROM alpine\n\n# otro\nCMD ["sh"]\n');
  assert.equal(parsed.instructions.length, 2);
});

/* ── Caché de capas: el corazón de la lección ────────────────────── */

test('el primer build no cachea nada', () => {
  const { result } = dockerBuild(makeFs(BROKEN_DOCKERFILE), null);
  assert.ok(result.ok);
  assert.equal(result.layers.every((layer) => !layer.cached), true);
});

test('sin cambios, el segundo build cachea todo', () => {
  const fs = makeFs(BROKEN_DOCKERFILE);
  const first = dockerBuild(fs, null);
  const second = dockerBuild(fs, first.fingerprints);

  assert.equal(second.result.layers.every((layer) => layer.cached), true);
  assert.equal(second.result.totalSeconds, 0);
});

test('⭐ el Dockerfile roto pierde la caché de npm install al tocar el código', () => {
  const fs = makeFs(BROKEN_DOCKERFILE);
  const first = dockerBuild(fs, null);

  // El usuario cambia una línea de src/ — lo que pasa veinte veces al día.
  fs.write('src/server.ts', 'import express from "express";\napp.listen(4000);');
  const second = dockerBuild(fs, first.fingerprints);

  const install = second.result.layers.find((layer) => layer.args.includes('npm install'));
  assert.equal(install?.cached, false, 'npm install NO debería cachearse: COPY . . va antes');
  assert.ok(second.result.totalSeconds > 60, 'el build sigue siendo lento');
});

test('⭐ el Dockerfile arreglado conserva la caché de npm ci al tocar el código', () => {
  const fs = makeFs(FIXED_DOCKERFILE, 'node_modules\ndist\n.git\n');
  const first = dockerBuild(fs, null);

  fs.write('src/server.ts', 'import express from "express";\napp.listen(4000);');
  const second = dockerBuild(fs, first.fingerprints);

  const installs = second.result.layers.filter((layer) => layer.args.includes('npm ci'));
  assert.ok(installs.length >= 1);
  assert.equal(installs[0].cached, true, 'npm ci SÍ debe cachearse: los manifests no cambiaron');

  const rebuilt = second.result.layers.filter((layer) => !layer.cached);
  assert.ok(rebuilt.length < second.result.layers.length, 'algo se reutiliza');
});

test('cambiar package.json sí invalida la instalación en el Dockerfile arreglado', () => {
  const fs = makeFs(FIXED_DOCKERFILE, 'node_modules\n');
  const first = dockerBuild(fs, null);

  fs.write('package.json', '{"name":"api","dependencies":{"express":"5.0.0"}}');
  const second = dockerBuild(fs, first.fingerprints);

  const install = second.result.layers.find((layer) => layer.args.includes('npm ci'));
  assert.equal(install?.cached, false, 'cambió el manifiesto: debe reinstalar');
});

test('una capa invalidada invalida todas las siguientes', () => {
  const fs = makeFs(FIXED_DOCKERFILE, 'node_modules\n');
  const first = dockerBuild(fs, null);

  fs.write('package.json', '{"name":"api","dependencies":{"express":"5.0.0"}}');
  const second = dockerBuild(fs, first.fingerprints);

  const layers = second.result.layers;
  const firstInvalid = layers.findIndex((layer) => !layer.cached);
  assert.ok(firstInvalid >= 0);
  assert.equal(
    layers.slice(firstInvalid).every((layer) => !layer.cached),
    true,
    'ninguna capa posterior a la invalidada puede estar cacheada',
  );
});

/* ── Tamaño de imagen ────────────────────────────────────────────── */

test('el multi-stage reduce el tamaño de la imagen final', () => {
  const broken = dockerBuild(makeFs(BROKEN_DOCKERFILE), null).result;
  const fixed = dockerBuild(makeFs(FIXED_DOCKERFILE, 'node_modules\n'), null).result;

  assert.ok(
    fixed.imageSizeMb < broken.imageSizeMb / 2,
    `esperado bastante menor: ${fixed.imageSizeMb} MB vs ${broken.imageSizeMb} MB`,
  );
  assert.ok(fixed.imageSizeMb < 200, 'debe cumplir la restricción de la lección (<200 MB)');
});

test('.dockerignore reduce el coste de COPY . .', () => {
  const withIgnore = dockerBuild(makeFs(BROKEN_DOCKERFILE, 'node_modules\n'), null).result;
  const without = dockerBuild(makeFs(BROKEN_DOCKERFILE, ''), null).result;

  const copyWith = withIgnore.layers.find((layer) => layer.instruction === 'COPY');
  const copyWithout = without.layers.find((layer) => layer.instruction === 'COPY');
  assert.ok((copyWith?.seconds ?? 0) < (copyWithout?.seconds ?? 0));
});

/* ── Errores ─────────────────────────────────────────────────────── */

test('sin Dockerfile, el build falla con un mensaje útil', () => {
  const { result } = dockerBuild(new VirtualFs({ 'package.json': '{}' }), null);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-dockerfile');
});

/* ── FS virtual ──────────────────────────────────────────────────── */

test('el FS virtual deriva directorios de las rutas', () => {
  const fs = new VirtualFs({ 'src/a.ts': '1', 'src/nested/b.ts': '2', 'README.md': '3' });

  assert.deepEqual(fs.list(''), ['README.md', 'src/']);
  assert.deepEqual(fs.list('src'), ['a.ts', 'nested/']);
  assert.equal(fs.isDirectory('src'), true);
  assert.equal(fs.isDirectory('README.md'), false);
});

test('borrar un directorio borra su contenido', () => {
  const fs = new VirtualFs({ 'src/a.ts': '1', 'src/b.ts': '2', 'keep.md': '3' });
  assert.equal(fs.delete('src'), 2);
  assert.deepEqual(fs.paths(), ['keep.md']);
});

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Copia PGlite a `public/pglite/` para servirlo desde nuestro propio origen.
 *
 * Hacen falta las dos cosas, y por motivos distintos:
 *
 * 1. **No se puede empaquetar.** `import('@electric-sql/pglite')` a secas
 *    revienta en el navegador con `m.instantiateWasm is not a function`: el
 *    paquete trae su propio grafo de chunks y el reempaquetado le rompe la
 *    interoperabilidad del namespace. Servido tal cual, funciona.
 *
 * 2. **No queremos un CDN de terceros.** Se probó jsDelivr y va, pero ata la
 *    lección a que un dominio ajeno esté disponible y sin bloquear, y ya
 *    arrastramos esa condición con Sandpack. Sirviéndolo nosotros, la versión
 *    queda clavada a la del `package.json` y no hay nada más que pueda caerse.
 *
 * Son 18 MB, así que NO se commitean: se generan en cada build desde
 * `node_modules` (`prebuild`) y `public/pglite/` está en `.gitignore`.
 */

const require = createRequire(import.meta.url);

/*
 * El paquete no exporta su `package.json`, así que se resuelve el módulo y se
 * sube hasta la raíz. Resolver el punto de entrada es lo único que el campo
 * `exports` garantiza.
 */
const entry = require.resolve('@electric-sql/pglite');
const dist = path.dirname(entry);
const root = path.resolve(dist, '..');
const target = path.resolve(import.meta.dirname, '../public/pglite');

/** Lo que el navegador pide: los módulos, el wasm y el sistema de archivos. */
const WANTED = /\.(js|wasm|data)$/;
/** Los `.map` triplican el peso y no los mira nadie en producción. */
const SKIP = /\.map$/;

function main() {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  let bytes = 0;
  let count = 0;

  for (const name of readdirSync(dist)) {
    if (!WANTED.test(name) || SKIP.test(name)) continue;
    const from = path.join(dist, name);
    if (!statSync(from).isFile()) continue;

    copyFileSync(from, path.join(target, name));
    bytes += statSync(from).size;
    count += 1;
  }

  if (count === 0) {
    throw new Error(
      `No se copió nada de ${dist}. ¿Cambió la estructura de @electric-sql/pglite?`,
    );
  }

  const version = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ).version as string;
  console.log(
    `✔ PGlite ${version} → public/pglite (${count} archivos, ${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
}

main();

/**
 * Sistema de archivos virtual en memoria.
 *
 * Plano a propósito: un `Map` de ruta → contenido, con los directorios
 * derivados de las rutas en lugar de almacenados. Un árbol real no aporta
 * nada aquí y complica el borrado recursivo y el renombrado.
 */
export class VirtualFs {
  private files = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(normalize(path), content);
    }
  }

  read(path: string): string | null {
    return this.files.get(normalize(path)) ?? null;
  }

  write(path: string, content: string): void {
    this.files.set(normalize(path), content);
  }

  exists(path: string): boolean {
    const target = normalize(path);
    if (this.files.has(target)) return true;
    // Un directorio "existe" si alguna ruta cuelga de él.
    return [...this.files.keys()].some((key) => key.startsWith(`${target}/`));
  }

  isDirectory(path: string): boolean {
    const target = normalize(path);
    return (
      !this.files.has(target) &&
      [...this.files.keys()].some((key) => key.startsWith(`${target}/`))
    );
  }

  delete(path: string): number {
    const target = normalize(path);
    let removed = 0;
    for (const key of [...this.files.keys()]) {
      if (key === target || key.startsWith(`${target}/`)) {
        this.files.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Entradas directas de un directorio, con `/` al final si lo son. */
  list(path = ''): string[] {
    const prefix = path === '' || path === '.' ? '' : `${normalize(path)}/`;
    const entries = new Set<string>();

    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === '') continue;
      const slash = rest.indexOf('/');
      entries.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`);
    }

    return [...entries].sort();
  }

  /**
   * Todas las rutas del sistema, en orden.
   *
   * `list()` da solo las entradas directas de un directorio, que es lo que
   * necesita un `ls`. Para recorrer un árbol entero —el router de Next lo
   * es— hace falta verlo completo.
   */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  /** Huella del contenido, para decidir si una capa de Docker se invalida. */
  fingerprint(patterns: string[]): string {
    const matched = this.paths().filter((path) => matchesAny(path, patterns));
    return matched.map((path) => `${path}:${hash(this.files.get(path) ?? '')}`).join('|');
  }
}

function normalize(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Glob mínimo: soporta `.`, `*` y prefijos de directorio. Nada más hace falta. */
export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((raw) => {
    const pattern = normalize(raw);
    if (pattern === '' || pattern === '.') return true;
    if (!pattern.includes('*')) {
      return path === pattern || path.startsWith(`${pattern}/`);
    }
    const regex = new RegExp(
      `^${pattern.split('*').map(escapeRegex).join('[^/]*')}$`,
    );
    return regex.test(path);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** djb2 — no criptográfico; solo hay que detectar "cambió o no cambió". */
function hash(value: string): string {
  let result = 5381;
  for (let i = 0; i < value.length; i++) {
    result = ((result << 5) + result + value.charCodeAt(i)) | 0;
  }
  return (result >>> 0).toString(36);
}

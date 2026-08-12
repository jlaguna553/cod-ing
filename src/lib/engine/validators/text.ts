import type { Validator } from '../context';
import { verdict } from '../context';

/**
 * Validadores textuales: los más baratos, y los únicos que se pueden permitir
 * correr en `phase: "type"` con cada pulsación.
 */

/** Localiza la primera coincidencia para poder señalar la línea en el editor. */
function locate(content: string, regex: RegExp): { line: number; column: number } | null {
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const local = new RegExp(regex.source, regex.flags.replace('g', ''));
    const match = local.exec(lines[index]);
    if (match) return { line: index + 1, column: match.index + 1 };
  }
  return null;
}

function build(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    // Una regex mal escrita en el contenido no debe tumbar la lección entera;
    // `validate-content` debería haberla cazado antes.
    return null;
  }
}

export const regexMust: Validator<'regex-must'> = (rule, context) => {
  const content = context.files[rule.file];
  if (content === undefined) {
    return verdict(false, {
      detail: { expected: `el archivo ${rule.file}`, actual: 'no existe' },
    });
  }

  const regex = build(rule.pattern, rule.flags);
  if (!regex) return verdict(false, { detail: { actual: 'patrón inválido en la lección' } });

  const found = regex.test(content);
  return verdict(found, found ? {} : { detail: { expected: rule.pattern } });
};

export const regexForbid: Validator<'regex-forbid'> = (rule, context) => {
  const content = context.files[rule.file];
  // Si el archivo no existe, no hay nada prohibido dentro: la regla pasa.
  if (content === undefined) return verdict(true);

  const regex = build(rule.pattern, rule.flags);
  if (!regex) return verdict(true);

  const found = regex.test(content);
  const location = found ? locate(content, regex) : null;

  return verdict(!found, {
    ...(location ? { location: { file: rule.file, ...location } } : {}),
    ...(found ? { detail: { actual: rule.pattern } } : {}),
  });
};

export const fileExists: Validator<'file-exists'> = (rule, context) => {
  const exact = context.files[rule.file] !== undefined;
  // Una ruta puede ser un directorio: existe si algo cuelga de ella.
  const asDirectory = Object.keys(context.files).some((path) =>
    path.startsWith(`${rule.file.replace(/\/$/, '')}/`),
  );

  const exists = exact || asDirectory;
  return verdict(exists, exists ? {} : { detail: { expected: rule.file, actual: 'no existe' } });
};

export const stdoutMatch: Validator<'stdout-match'> = (rule, context) => {
  /*
   * Sin ejecución previa no hay veredicto posible: `null` deja la comprobación
   * en «pendiente» (gris) en lugar de marcarla en rojo. Suspender a alguien por
   * una salida que todavía no ha tenido ocasión de producir es la forma más
   * rápida de que deje de fiarse del panel de pruebas.
   */
  if (!context.hasRun) return null;

  if (context.exitCode !== rule.expectExitCode) {
    return verdict(false, {
      detail: { expected: `código de salida ${rule.expectExitCode}`, actual: String(context.exitCode) },
    });
  }

  const output = context.stdout.trim();

  if (rule.equals !== undefined) {
    const passed = output === rule.equals.trim();
    return verdict(passed, passed ? {} : { detail: { expected: rule.equals, actual: output } });
  }

  if (rule.matches !== undefined) {
    const regex = build(rule.matches, 's');
    if (!regex) return verdict(false);
    const passed = regex.test(output);
    return verdict(passed, passed ? {} : { detail: { expected: rule.matches, actual: output } });
  }

  // Sin `equals` ni `matches`, la regla solo comprueba el código de salida.
  return verdict(true);
};

/**
 * Comprueba que el usuario ejecutó ciertos comandos, en orden.
 *
 * La comparación es por prefijo porque `docker build -t api .` y
 * `docker build .` son el mismo acto pedagógico: exigir el comando literal
 * convertiría la lección en un dictado.
 */
export const cliTranscript: Validator<'cli-transcript'> = (rule, context) => {
  const history = context.transcript;
  let cursor = 0;

  for (const expected of rule.expectedCommands) {
    const found = history.findIndex(
      (command, index) => index >= cursor && command.startsWith(expected),
    );
    if (found === -1) {
      return verdict(false, {
        detail: { expected, actual: history.join(' · ') || '(sin comandos)' },
      });
    }
    // Sin `allowExtra`, los comandos deben ser consecutivos.
    if (!rule.allowExtra && found !== cursor) {
      return verdict(false, { detail: { expected, actual: history[cursor] ?? '(nada)' } });
    }
    cursor = found + 1;
  }

  return verdict(true);
};

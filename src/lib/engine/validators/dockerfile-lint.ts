import { copySources, parseDockerfile } from '@/lib/runners/cli-sim/dockerfile';
import type { Validator } from '../context';
import { verdict } from '../context';

/**
 * Reglas de buenas prácticas sobre un Dockerfile (ADR-03).
 *
 * Comparte el parser con el simulador de `docker build` a propósito: si cada
 * uno leyera el archivo a su manera, la terminal podría decir «CACHED» mientras
 * la evaluación insiste en que el orden está mal. Un solo parser, una sola
 * verdad.
 */

type LintRule =
  | 'multi-stage'
  | 'cache-order'
  | 'non-root-user'
  | 'pinned-base-image'
  | 'no-secrets'
  | 'minimal-layers'
  | 'has-dockerignore'
  | 'healthcheck';

interface LintFailure {
  rule: LintRule;
  detail: string;
  line?: number;
}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
/** Manifiestos de dependencias por ecosistema. */
const MANIFESTS = /package.*\.json|package-lock|yarn\.lock|pnpm-lock|requirements\.txt|go\.(mod|sum)|Gemfile|pom\.xml|composer\.json|Cargo\.toml/i;
const INSTALL_COMMAND = /npm (ci|install)|yarn( install)?|pnpm install|pip install|go mod download|bundle install|mvn|composer install|cargo fetch/i;

function check(rule: LintRule, source: string, files: Record<string, string>): LintFailure | null {
  const parsed = parseDockerfile(source);

  switch (rule) {
    case 'multi-stage':
      return parsed.stages.length >= 2
        ? null
        : { rule, detail: 'solo hay una fase; la imagen final arrastra las herramientas de build' };

    case 'pinned-base-image': {
      const unpinned = parsed.stages.find(
        (stage) => stage.baseImage.endsWith(':latest') || !stage.baseImage.includes(':'),
      );
      return unpinned
        ? { rule, detail: `imagen sin versión fija: ${unpinned.baseImage}` }
        : null;
    }

    case 'cache-order': {
      /*
       * El corazón de la lección: dentro de CADA fase, el COPY de los
       * manifiestos debe ir ANTES del comando de instalación, y el COPY del
       * código fuente DESPUÉS. Se comprueba por fase y no globalmente porque
       * en un multi-stage cada una tiene su propio orden.
       */
      for (const stage of parsed.stages) {
        const installIndex = stage.instructions.findIndex(
          (item) => item.instruction === 'RUN' && INSTALL_COMMAND.test(item.args),
        );
        if (installIndex === -1) continue;

        const copiesBefore = stage.instructions.slice(0, installIndex);
        const copiesEverythingBefore = copiesBefore.find(
          (item) =>
            (item.instruction === 'COPY' || item.instruction === 'ADD') &&
            !/--from=/.test(item.args) &&
            copySources(item.args).some((source) => source === '.' || source === './'),
        );

        if (copiesEverythingBefore) {
          return {
            rule,
            detail: 'se copia todo el código antes de instalar: cualquier cambio invalida la caché',
            line: copiesEverythingBefore.line,
          };
        }

        const copiesManifestBefore = copiesBefore.some(
          (item) => item.instruction === 'COPY' && MANIFESTS.test(item.args),
        );
        if (!copiesManifestBefore) {
          return {
            rule,
            detail: 'no se copian los manifiestos antes de instalar dependencias',
            line: stage.instructions[installIndex].line,
          };
        }
      }
      return null;
    }

    case 'non-root-user': {
      const finalStage = parsed.stages.at(-1);
      const user = [...(finalStage?.instructions ?? [])]
        .reverse()
        .find((item) => item.instruction === 'USER');
      if (!user) return { rule, detail: 'la fase final no declara USER: corre como root' };
      return /^root$|^0$/.test(user.args.trim())
        ? { rule, detail: 'USER root anula la protección', line: user.line }
        : null;
    }

    case 'no-secrets': {
      const leak = parsed.instructions.find(
        (item) =>
          (item.instruction === 'ENV' || item.instruction === 'ARG') &&
          SECRET_NAME.test(item.args) &&
          // `ENV API_KEY` sin valor es una declaración, no un secreto horneado.
          /=\s*\S+/.test(item.args),
      );
      return leak
        ? { rule, detail: `secreto horneado en la imagen: ${leak.args.split('=')[0]}`, line: leak.line }
        : null;
    }

    case 'minimal-layers': {
      const runs = parsed.instructions.filter((item) => item.instruction === 'RUN');
      return runs.length > 4
        ? { rule, detail: `${runs.length} instrucciones RUN; encadénalas con &&` }
        : null;
    }

    case 'has-dockerignore': {
      const content = files['.dockerignore'] ?? files['./.dockerignore'];
      if (content === undefined) return { rule, detail: 'no existe .dockerignore' };
      return content.trim() === '' ? { rule, detail: '.dockerignore está vacío' } : null;
    }

    case 'healthcheck':
      return parsed.instructions.some((item) => item.instruction === 'HEALTHCHECK')
        ? null
        : { rule, detail: 'sin HEALTHCHECK: el orquestador no sabe si el contenedor está sano' };

    default:
      return null;
  }
}

export const dockerfileLint: Validator<'dockerfile-lint'> = (rule, context) => {
  const source = context.files[rule.file];
  if (source === undefined) {
    return verdict(false, { detail: { expected: rule.file, actual: 'no existe' } });
  }

  const failures = rule.rules
    .map((name) => check(name as LintRule, source, context.files))
    .filter((failure): failure is LintFailure => failure !== null);

  if (failures.length === 0) return verdict(true);

  const first = failures[0];
  return verdict(false, {
    ...(first.line ? { location: { file: rule.file, line: first.line } } : {}),
    detail: {
      expected: failures.map((failure) => failure.rule).join(', '),
      actual: failures.map((failure) => failure.detail).join(' · '),
    },
  });
};

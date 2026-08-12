/**
 * Genera `content/schema/lesson.schema.json` desde el schema Zod.
 *
 * Ese JSON Schema no se usa en runtime (Zod ya valida): existe para que VSCode
 * dé autocompletado y errores en vivo a quien escribe lecciones, gracias al
 * `"$schema"` que cada `.lesson.json` declara en su primera línea.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AchievementCatalogSchema, LessonSchema } from '../src/lib/content/lesson.schema';

const OUT_DIR = path.resolve(import.meta.dirname, '../content/schema');

const targets = [
  { file: 'lesson.schema.json', schema: LessonSchema, id: 'https://codequest.dev/schema/lesson.json' },
  { file: 'achievements.schema.json', schema: AchievementCatalogSchema, id: 'https://codequest.dev/schema/achievements.json' },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const target of targets) {
  const jsonSchema = z.toJSONSchema(target.schema, { io: 'input' });
  const out = path.join(OUT_DIR, target.file);
  writeFileSync(out, `${JSON.stringify({ $id: target.id, ...jsonSchema }, null, 2)}\n`);
  console.log(`✔ ${path.relative(process.cwd(), out)}`);
}

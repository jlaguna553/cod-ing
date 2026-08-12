'use client';

import { useTranslations } from 'next-intl';
import { FileCode, Lock } from 'lucide-react';
import { useLessonStore, useVisibleFiles } from '@/stores/useLessonStore';

/**
 * Árbol de archivos del ejercicio. Los `hidden` (tests, andamiaje) no
 * aparecen; los `readOnly` se muestran con candado y se pueden abrir para
 * leerlos — ver el test que te evalúa es parte de aprender a leer tests.
 */
export function FileTree() {
  const t = useTranslations();
  const files = useVisibleFiles();
  const activeFile = useLessonStore((s) => s.activeFile);
  const dirtyFiles = useLessonStore((s) => s.dirtyFiles);
  const setActiveFile = useLessonStore((s) => s.setActiveFile);

  if (files.length === 0) {
    return <p className="text-xs text-[var(--color-ink-faint)]">{t('empty.noLesson')}</p>;
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {files.map((file) => {
        const isActive = file.path === activeFile;
        const isDirty = dirtyFiles.includes(file.path);

        return (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => setActiveFile(file.path)}
              className={
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ' +
                (isActive
                  ? 'bg-[var(--color-raised)] text-[var(--color-neon)]'
                  : 'text-[var(--color-ink-dim)] hover:bg-[var(--color-raised)]/50 hover:text-[var(--color-ink)]')
              }
            >
              {file.readOnly ? (
                <Lock size={11} className="shrink-0 text-[var(--color-ink-faint)]" />
              ) : (
                <FileCode size={11} className="shrink-0" />
              )}
              <span className="truncate">{file.path}</span>
              {isDirty && (
                <span
                  title={t('files.modified')}
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--color-power)]"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

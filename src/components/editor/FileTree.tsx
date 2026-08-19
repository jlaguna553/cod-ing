'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileCode, FilePlus, Lock } from 'lucide-react';
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
  const allowCreate = useLessonStore((s) => s.lesson?.workspace.allowCreate === true);
  const createFile = useLessonStore((s) => s.createFile);

  const [creando, setCreando] = useState(false);
  const [ruta, setRuta] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (files.length === 0) {
    return <p className="text-xs text-[var(--color-ink-faint)]">{t('empty.noLesson')}</p>;
  }

  /**
   * Crear archivos es el ejercicio en media lección de Next.
   *
   * Hasta ahora `allowCreate` estaba en el schema y no lo implementaba nadie,
   * así que un enunciado del tipo «crea `app/layout.tsx`» no se podía cumplir.
   * El campo pide la ruta entera —carpetas incluidas— porque en el App Router
   * la ruta **es** la respuesta: escribirla es parte de lo que se aprende.
   */
  const crear = (event: React.FormEvent) => {
    event.preventDefault();
    const motivo = createFile(ruta);

    if (motivo) {
      setError(t(`files.errors.${motivo}`));
      return;
    }

    setRuta('');
    setError(null);
    setCreando(false);
  };

  return (
    <>
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

      {allowCreate && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          {creando ? (
            <form onSubmit={crear} className="flex flex-col gap-1">
              <input
                autoFocus
                value={ruta}
                onChange={(event) => {
                  setRuta(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setCreando(false);
                }}
                aria-label={t('files.newFile')}
                placeholder="app/layout.tsx"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-abyss)] px-2 py-1 font-mono text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-neon)]"
              />
              {error && (
                <p role="alert" className="text-[10px] text-[var(--color-damage)]">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="self-start rounded-md bg-[var(--color-neon)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--color-void)]"
              >
                {t('files.create')}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreando(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--color-ink-dim)] transition-colors hover:bg-[var(--color-raised)]/50 hover:text-[var(--color-ink)]"
            >
              <FilePlus size={11} className="shrink-0" />
              {t('files.newFile')}
            </button>
          )}
        </div>
      )}
    </>
  );
}

# Desplegar en Vercel

De cero a producción. Unos 15 minutos, la mayoría esperando.

---

## Lo único que puede salirte mal

**Sin `DATABASE_URL`, el progreso de tus usuarios se borra solo.**

En desarrollo la base es PGlite (Postgres en WASM) y vive en la memoria del
proceso. En Vercel cada petición puede caer en una instancia nueva, así que esa
memoria desaparece: la aplicación *parecería* funcionar mientras pierde datos en
silencio.

Por eso el servidor **se niega a arrancar** en producción sin `DATABASE_URL`. Si
ves ese error en el log, no es un fallo: es el guardia haciendo su trabajo.

> Existe una salida, `ALLOW_PGLITE_IN_PRODUCTION=1`, con ese nombre tan largo a
> propósito para que nadie la ponga por accidente. La usan los tests E2E, que
> corren contra un build de producción sin Postgres delante. **No la definas en
> Vercel**: perderías los datos de tus usuarios sin enterarte.

---

## 1. Repositorio

```bash
cd /home/jlaguna/projects/cod-ing
git init
git add -A
git commit -m "CodeQuest: plataforma de aprendizaje gamificada"

gh repo create codequest --private --source=. --push
# o crea el repo en github.com y luego:
#   git remote add origin git@github.com:TU_USUARIO/codequest.git
#   git push -u origin main
```

`.gitignore` ya excluye `.env`, `.pglite/`, `.next/` y los informes de Playwright.

---

## 2. Base de datos

Necesitas un Postgres accesible desde internet. Cualquiera vale; **Neon** tiene
plan gratuito y es el que usa Vercel por debajo.

**Opción A — desde Vercel** (más simple)

En el proyecto: *Storage → Create Database → Postgres*. Vercel crea la base y
define `DATABASE_URL` en las variables de entorno por ti.

**Opción B — Neon directamente**

Crea un proyecto en [neon.tech](https://neon.tech) y copia la cadena de
conexión. Tiene esta forma:

```
postgres://usuario:contraseña@ep-algo-123.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Aplicar el esquema

Una sola vez, antes del primer despliegue:

```bash
DATABASE_URL='postgres://…' npm run db:migrate
```

Debe listar las cuatro tablas: `lesson_progress`, `user_achievements`,
`user_stats`, `users`.

---

## 3. Variables de entorno

En Vercel: *Settings → Environment Variables*. Ambas en **Production** y
**Preview**.

| Variable | Valor | Por qué |
|---|---|---|
| `DATABASE_URL` | La cadena de tu Postgres | Sin ella el servidor no arranca |
| `SESSION_SECRET` | `openssl rand -base64 32` | Firma la cookie de sesión |

Sobre `SESSION_SECRET`: la cookie de identidad va firmada con HMAC. Sin firma,
editarla en devtools sería suplantar a cualquier usuario cuyo id se conozca. En
producción sin esta variable el servidor también se niega a arrancar, en lugar
de firmar con una clave conocida y aparentar seguridad.

**Genera una distinta para producción.** Y si alguna vez la cambias, todas las
sesiones anónimas existentes dejan de validar y sus dueños empiezan de cero.

---

## 4. Desplegar

```bash
npx vercel          # preview
npx vercel --prod   # producción
```

O conecta el repositorio desde el panel de Vercel y cada `push` a `main`
desplegará solo.

No hace falta configurar nada más: Vercel detecta Next.js, y `next.config.ts` ya
declara `@electric-sql/pglite` como paquete externo del servidor (su binario
WASM se rompe si el bundler intenta empaquetarlo).

---

## 5. Comprobar que quedó bien

```bash
curl -sI https://TU-APP.vercel.app/ | head -3            # 307 → /es
curl -s https://TU-APP.vercel.app/api/progress | head -c 120
```

Lo segundo debe devolver un JSON con un `userId` que empiece por `anon_`. Si
devuelve un error 500, mira los logs: casi siempre es `DATABASE_URL` sin definir
o el esquema sin aplicar.

Luego, en el navegador: abre una lección, escribe algo, espera tres segundos
(autosave) y recarga. El código debe seguir ahí.

---

## Antes de abrirlo al público

**Ejecuta el pipeline completo.** No despliegues sin esto:

```bash
npm run check   # contenido + traducciones + 143 tests + build
npm run e2e     # 32 tests en navegador real
```

**Revisa el estado del contenido.** Hoy son 15 lecciones: JavaScript y React
completos, y el resto de tracks a medias. Backend está **vacío** y su pantalla
dice «Todavía no hay lecciones en esta ruta». Es honesto, pero conviene saberlo
antes de compartir el enlace.

**Lo que todavía no está resuelto**, por si afecta a tu caso:

- No hay forma de **reclamar la cuenta anónima** con un email. Si alguien borra
  las cookies, pierde su progreso.
- La **racha diaria corta a medianoche UTC**. Para alguien en UTC-6 el día
  «termina» a las 18:00.
- Sandpack (lecciones de React y Vue) descarga su bundler de un CDN externo en
  el primer arranque. Sin conexión a ese CDN, esas lecciones no compilan.

---

## Coste

Con el plan gratuito de Vercel y de Neon, cero — el proyecto no tiene procesos
largos ni almacenamiento pesado. Lo que consume es la base de datos, y el
progreso de un usuario ocupa unos pocos kilobytes.

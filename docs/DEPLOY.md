# Desplegar en Vercel — referencia

> **¿Solo quieres ponerlo en marcha, gratis y sin complicaciones?**
> Usa **[DEPLOY-VERCEL.md](./DEPLOY-VERCEL.md)**: todo desde el panel de Vercel,
> con la base de datos provisionada desde su Marketplace.
>
> Este documento es la referencia completa: cubre Supabase, qué variables
> existen y por qué, y qué hacer cuando algo falla.

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

Ya está subido a `jlaguna553/cod-ing` y `jlaguna553/cod-ing-portfolio`. Para
cambios posteriores:

```bash
git add -A
git commit -m "…"
git push origin main             # cod-ing
git push portfolio main          # cod-ing-portfolio
```

`.gitignore` excluye `.env`, `.pglite/`, `.next/` y los informes de Playwright,
y deja pasar `.env.example`, que documenta qué variables hacen falta.

---

## 2. Base de datos — Supabase

Cualquier Postgres accesible desde internet sirve. Con **Supabase** hay un
detalle que hay que acertar o la aplicación falla en producción, así que va
primero y con detalle. (Al final está la alternativa con Neon o Vercel
Postgres, que es más directa.)

### 2.1 Crear el proyecto

1. Entra en [supabase.com](https://supabase.com) → **New project**.
2. Elige una región **cercana a la de tu despliegue en Vercel**: cada consulta
   cruza esa distancia, y con la base en Europa y las funciones en Virginia se
   notan los ~100 ms de ida y vuelta en cada carga.
3. Guarda la contraseña de la base que te muestra. **Solo se enseña una vez.**

### 2.2 La parte que importa: qué cadena de conexión usar

Supabase ofrece tres, y no son intercambiables. En *Project Settings →
Database → Connection string*:

| Cadena | Puerto | Para qué | En Vercel |
|---|---|---|---|
| **Direct connection** | 5432 | Migraciones, backends persistentes | ❌ es **IPv6**, y Vercel no lo tiene |
| **Transaction pooler** | **6543** | Serverless y edge | ✅ **la que necesitas** |
| **Session pooler** | 5432 | Backends persistentes sobre IPv4 | ❌ mantiene sesión por conexión |

La del runtime es la de **transaction pooler**, puerto **6543**:

```
postgresql://postgres.abcdefgh:TU_CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Dos razones para esa y no otra:

- **La conexión directa es IPv6.** Vercel no tiene salida IPv6, así que la
  conexión simplemente no se establece. Es el error más común y el más
  desconcertante, porque la misma cadena funciona desde tu portátil.
- **Serverless abre y cierra conexiones constantemente.** El pooler en modo
  transacción está hecho para eso; una conexión directa agota los slots del
  servidor en cuanto hay algo de tráfico.

El modo transacción **no soporta prepared statements**, y el cliente ya está
configurado con `prepare: false` (`src/lib/db/client.ts`) precisamente por esto.
No hace falta que toques nada, pero si alguna vez ves
`prepared statement "s1" already exists`, es este parámetro.

> Sustituye `TU_CONTRASEÑA` por la del paso 2.1. Si tiene caracteres raros
> (`@`, `:`, `/`, `#`), hay que codificarlos en la URL o la cadena se
> interpreta mal.

### 2.3 Aplicar el esquema

Una sola vez, antes del primer despliegue. Desde tu máquina:

```bash
DATABASE_URL='postgresql://postgres.abcdefgh:CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:6543/postgres' \
  npm run db:migrate
```

Debe listar las cuatro tablas: `lesson_progress`, `user_achievements`,
`user_stats`, `users`.

Sirve tanto el pooler como la conexión directa: el script usa `prepare: false`
para funcionar con ambos. Si tu red tiene IPv6 y prefieres la directa, también
vale.

### 2.4 Cierra la puerta de PostgREST ⚠️

**Este paso no es opcional en Supabase.**

Supabase expone automáticamente todas las tablas del esquema `public` a través
de una API REST pública. Cualquiera con tu clave anónima —que va en el
navegador y por tanto es visible— podría leer y modificar el progreso, el XP y
los logros de todos los usuarios.

En *SQL Editor*, ejecuta:

```sql
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements  ENABLE ROW LEVEL SECURITY;
```

Sin políticas, RLS **deniega todo** a través de PostgREST — que es justo lo que
queremos. La aplicación no se ve afectada: se conecta por Postgres directo con
el rol dueño de las tablas, y el dueño no pasa por RLS.

Para comprobarlo, con la clave anónima de *Settings → API*:

```bash
curl "https://TU_PROYECTO.supabase.co/rest/v1/user_stats?select=*" \
  -H "apikey: TU_ANON_KEY"
```

Debe devolver `[]` o un error de permisos. Si devuelve filas con datos, RLS no
está activo y tus datos son públicos.

---

### Alternativa: Neon o Vercel Postgres

Más directa, sin la parte del pooler ni la de RLS.

**Desde Vercel:** *Storage → Create Database → Postgres*. Crea la base y define
`DATABASE_URL` por ti.

**Neon:** crea un proyecto en [neon.tech](https://neon.tech) y copia la cadena,
que ya viene lista para serverless:

```
postgres://usuario:contraseña@ep-algo-123.us-east-2.aws.neon.tech/neondb?sslmode=require
```

En ambos casos, aplica el esquema igual: `DATABASE_URL='…' npm run db:migrate`.

---

## 3. Variables de entorno

En Vercel: *Settings → Environment Variables*. Ambas en **Production** y
**Preview**.

| Variable | Valor | Por qué |
|---|---|---|
| `DATABASE_URL` | Con Supabase, la del **pooler (6543)** | Sin ella el servidor no arranca |
| `SESSION_SECRET` | `openssl rand -base64 32` | Firma la cookie de sesión |

Con Supabase, asegúrate de pegar la del **puerto 6543**. La de 5432 funciona en
tu portátil y falla en Vercel, que es la forma más molesta de descubrir un
error.

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

Lo segundo debe devolver un JSON con un `userId` que empiece por `anon_`.

Si da error 500, mira los logs de Vercel (*Deployments → tu despliegue →
Runtime Logs*) y busca el mensaje:

| Mensaje | Causa |
|---|---|
| `DATABASE_URL es obligatoria en producción` | Falta la variable, o no está en el entorno *Production* |
| `SESSION_SECRET es obligatorio en producción` | Ídem |
| `ETIMEDOUT` / `ENETUNREACH` | Con Supabase: estás usando el puerto 5432 (IPv6). Cambia al 6543 |
| `prepared statement … already exists` | El cliente perdió `prepare: false` |
| `relation "users" does not exist` | Falta ejecutar `npm run db:migrate` |
| `TypeError: Invalid URL` al migrar | La cadena vale `[SENSITIVE]`: Vercel no descarga el valor de las variables de sus integraciones. Cópiala del panel |

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

# Producción en Vercel, gratis — paso a paso

Todo desde el panel de Vercel, sin tarjeta y sin salir a otro proveedor.
Unos 15 minutos.

Al terminar tendrás la aplicación en `https://algo.vercel.app` con el progreso
de los usuarios guardado de verdad.

---

## Antes de empezar

Necesitas dos cosas y ya las tienes:

- El repositorio subido → `jlaguna553/cod-ing` ✅
- Una cuenta en [vercel.com](https://vercel.com) (entra con GitHub)

**El plan Hobby de Vercel es gratis y no pide tarjeta.** La base de datos la
provisionaremos desde su Marketplace, también en plan gratuito.

---

## Paso 1 — Importar el proyecto

1. Entra en [vercel.com/new](https://vercel.com/new).
2. Busca **`cod-ing`** en la lista de repositorios y pulsa **Import**.
3. Vercel detecta Next.js solo. **No cambies nada** de Framework Preset,
   Build Command ni Output Directory.
4. **No pulses Deploy todavía.** Despliega abajo *Environment Variables* y
   añade esta:

   | Name | Value |
   |---|---|
   | `SESSION_SECRET` | pega aquí el resultado de `openssl rand -base64 32` |

   Genera el valor en tu terminal:

   ```bash
   openssl rand -base64 32
   ```

   Opcionalmente, `INSIGHTS_TOKEN` (otro `openssl rand -base64 24`): es la
   llave de `/api/insights`, el resumen de errores y de los pasos donde la
   gente encalla. Sin esa variable la ruta responde 404 y no existe.

5. Ahora sí, **Deploy**.

El primer despliegue **va a fallar al abrir la web**, y es lo esperado: todavía
no hay base de datos. El servidor se niega a arrancar sin ella en lugar de
funcionar a medias y perder datos en silencio. Lo arreglamos en el paso 2.

---

## Paso 2 — Crear la base de datos (gratis)

1. En tu proyecto de Vercel, pestaña **Storage**.
2. **Create Database** → verás el Marketplace con varios proveedores.
3. Elige **Neon** (Serverless Postgres).
   - Es el más simple de los tres para este caso: no hay que elegir cadena de
     conexión ni configurar nada.
   - Si prefieres Supabase, funciona igual pero tiene dos pasos extra; están
     en [DEPLOY.md](./DEPLOY.md).
4. Plan: **Free**.
5. Región: **la misma que tu proyecto** (si no la cambiaste, `Washington D.C.
   (iad1)`). Cada consulta cruza esa distancia; con la base en Europa y las
   funciones en Virginia se notan ~100 ms en cada carga.
6. **Create**.

Vercel conecta la base al proyecto y **define `DATABASE_URL` por ti**. No tienes
que copiar ni pegar nada.

> Compruébalo en *Settings → Environment Variables*: debe aparecer
> `DATABASE_URL` con el candado de "creada por la integración".

---

## Paso 3 — (ya no hace falta hacer nada)

**Las tablas se crean solas.** La aplicación aplica el esquema la primera vez
que se conecta a la base de datos.

No es por comodidad: con las integraciones del Marketplace **es la única forma
posible**. Vercel marca sus variables como *Sensitive* y `vercel env pull`
devuelve el literal `[SENSITIVE]` en lugar de la cadena de conexión — la
credencial solo existe dentro del servidor, así que es el servidor quien tiene
que crear las tablas.

Es seguro porque el DDL es idempotente (`CREATE TABLE IF NOT EXISTS`): aplicarlo
de nuevo no borra ni modifica nada, y cuesta milisegundos cuando las tablas ya
existen. Hay tests que lo comprueban.

Las columnas que se añaden después van como `ALTER TABLE … ADD COLUMN IF NOT
EXISTS` en el mismo DDL, porque `CREATE TABLE IF NOT EXISTS` **no toca una tabla
que ya existe**: sin ese `ALTER`, una base creada antes se quedaría sin las
columnas nuevas y el despliegue fallaría al escribir en ellas. Es lo que pasó
con `password_hash` y `recovery_hash` al añadir las cuentas.

> Si prefieres hacerlo a mano —o usas un Postgres cuya cadena sí puedes leer—
> el comando sigue disponible:
>
> ```bash
> DATABASE_URL='postgresql://…' npm run db:migrate
> ```

---

## Paso 4 — Volver a desplegar

El despliegue del paso 1 se hizo sin base de datos, así que hay que rehacerlo
para que tome la variable nueva:

**Deployments** → el último → menú `⋯` → **Redeploy**.

O desde la terminal:

```bash
npx vercel --prod
```

---

## Paso 5 — Comprobar que funciona

```bash
curl -s https://TU-APP.vercel.app/api/progress | head -c 100
```

Debe devolver un JSON con `"userId":"anon_…"`. Si es así, ya está.

Y en el navegador, la prueba de verdad:

1. Abre `https://TU-APP.vercel.app`
2. Entra en una lección y escribe algo
3. Espera **tres segundos** (el autosave tiene ese retardo)
4. **Recarga la página** → tu código debe seguir ahí

Si sobrevive a la recarga, la base está conectada y guardando.

---

## Si algo falla

Los logs están en *Deployments → tu despliegue → **Runtime Logs***. Busca el
mensaje y compáralo con esta tabla:

| Mensaje en el log | Qué pasa |
|---|---|
| `DATABASE_URL es obligatoria en producción` | La base no se creó, o se creó después del último despliegue. Vuelve al paso 4 y redespliega |
| `SESSION_SECRET es obligatorio en producción` | Falta la variable del paso 1. Añádela en *Settings → Environment Variables* y redespliega |
| `relation "users" does not exist` | Falta el paso 3: las tablas no están creadas |
| `ETIMEDOUT` / `ENETUNREACH` | Solo con Supabase: estás usando el puerto 5432. Necesitas el pooler, 6543. Ver [DEPLOY.md](./DEPLOY.md) |

**Un cambio de variable de entorno no se aplica solo.** Vercel las inyecta al
construir, así que después de tocar cualquiera hay que redesplegar.

---

## Cómo mirar qué pasa, ya desplegado

Tres sitios, ninguno de pago:

| Dónde | Qué contesta |
|---|---|
| `GET /api/health` | Si la base responde, si el contenido cargó y **qué versión** está desplegada. Devuelve 503 cuando algo falla, así que sirve para un vigilante externo sin leer el cuerpo |
| *Runtime Logs* de Vercel | Una línea JSON por petición (`event`, `route`, `status`, `ms`) y una por error del servidor, con el `digest` que ve el usuario en pantalla |
| `GET /api/insights?token=…` | Errores repetidos del navegador y **los pasos donde la gente encalla**, con la regla que más falla en cada uno |

El tercero necesita `INSIGHTS_TOKEN`; sin esa variable la ruta responde 404.
Es lo que conviene mirar antes de escribir una lección nueva: un paso con muchos
intentos y pocos aciertos no suele ser difícil, suele estar mal explicado.

```bash
curl -s https://TU-APP.vercel.app/api/health | jq
curl -s -H "authorization: Bearer $INSIGHTS_TOKEN" \
  https://TU-APP.vercel.app/api/insights?dias=7 | jq
```

---

## Qué cuesta esto

Nada, con estos límites:

| | Plan gratuito | Para qué da |
|---|---|---|
| **Vercel Hobby** | 100 GB de ancho de banda al mes | De sobra para uso personal o una demo |
| **Neon Free** | 0,5 GB de almacenamiento | El progreso de un usuario ocupa unos pocos KB: miles de usuarios |

Dos límites del plan gratuito que conviene conocer:

- **Vercel Hobby es solo para uso no comercial.** Si algún día cobras por la
  plataforma, hay que pasar a Pro.
- **Neon suspende la base tras un rato sin actividad.** Se reactiva sola en la
  siguiente consulta, pero esa primera petición tarda un par de segundos más.
  Para una demo es irrelevante.

---

## Despliegues siguientes

Vercel queda conectado al repositorio, así que a partir de aquí:

```bash
git add -A
git commit -m "…"
git push origin main
```

Cada `push` a `main` despliega solo. Antes de empujar, conviene:

```bash
npm run check    # contenido + traducciones + 143 tests + build
```

---

## Antes de enseñárselo a alguien

Tres cosas que están así a propósito, pero que conviene que sepas:

- **Node, Python y Go siguen sin motor.** El track de Backend ya tiene SQL, C#
  y PHP; esos tres módulos aparecen en el mapa pero no se pueden ejecutar.
- **Las lecciones de React descargan su compilador de un CDN externo** la
  primera vez. Tardan unos segundos en arrancar; las de HTML, CSS, JavaScript,
  Vue, SQL y PHP se sirven desde el propio dominio y son inmediatas.
- **Quien no reclame su cuenta pierde el progreso al borrar las cookies.** El
  aviso está en la portada y reclamarla son dos campos, pero nadie está
  obligado.

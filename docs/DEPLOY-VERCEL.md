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

## Paso 3 — Crear las tablas

La base existe pero está vacía. Desde tu máquina, una sola vez:

**Copia la cadena de conexión del panel** y pásala al migrador:

1. En Vercel: *Storage → tu base de datos → **Connect*** (o abre el panel de
   Neon desde ahí).
2. Copia la cadena que empieza por `postgresql://`.
3. Ejecútalo con esa cadena:

```bash
cd /home/jlaguna/projects/cod-ing

DATABASE_URL='postgresql://…pega-aquí-la-cadena…' npm run db:migrate
```

> **Por qué a mano y no con `vercel env pull`.** Las variables que crean las
> integraciones del Marketplace quedan marcadas como *Sensitive*, y Vercel **no
> descarga su valor**: escribe el literal `[SENSITIVE]` en `.env.local`. El pull
> parece funcionar —el archivo se actualiza— pero lo que llega no sirve. Es una
> medida de seguridad suya, no un fallo.
>
> Si aun así quieres usar `vercel env pull`, recuerda añadir
> `--environment=production`: sin esa bandera baja las de *development*, donde
> `DATABASE_URL` ni siquiera existe.

Debe terminar así:

```
Conectando a ep-algo-123.us-east-2.aws.neon.tech…
✔ Esquema aplicado. Tablas:
    lesson_progress
    user_achievements
    user_stats
    users
```

> `.env.local` queda en tu máquina con credenciales reales. `.gitignore` ya lo
> excluye, pero no lo compartas.

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

- **El track de Backend está vacío** y su pantalla lo dice. Es lo primero que
  vería alguien que entre por ahí.
- **Si un usuario borra las cookies, pierde su progreso.** La identidad es
  anónima y todavía no hay forma de reclamar la cuenta con un email.
- **Las lecciones de React y Vue** descargan su compilador de un CDN externo la
  primera vez. Tardan unos segundos en arrancar; las de HTML, CSS y JavaScript
  son instantáneas.

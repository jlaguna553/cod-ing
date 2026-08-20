# Plan de ejecución

Ocho fases. Cada una termina con algo demostrable, no con "infraestructura lista".
El orden está elegido para que el riesgo técnico se descubra pronto: las fases 3 y 4
son las que pueden matar el proyecto, y por eso van antes que el pulido visual.

---

### ✅ Fase 0 — Modelo de contenido (COMPLETADA)

| Entregable | Ruta |
|---|---|
| Arquitectura y ADRs | `docs/ARCHITECTURE.md` |
| Schema Zod (fuente de verdad) | `src/lib/content/lesson.schema.ts` |
| Tipos + contrato `Runner` | `src/lib/content/types.ts` |
| Localizador profundo | `src/lib/content/localize.ts` |
| Lección ejemplo — drill frontend | `content/lessons/frontend/javascript/js-03-array-map.lesson.json` |
| Lección ejemplo — boss devops | `content/lessons/devops/docker/docker-07-layer-cache.lesson.json` |
| Validador CI + generador JSON Schema | `scripts/` — `npm run content:check`, `npm run content:schema` |

**Verificado:** 2 lecciones validan; 5 pruebas negativas (traducción faltante, ruleId
huérfano, entry inválido, drill con <3 repeticiones, interview sin bloque) son rechazadas.

---

### ✅ Fase 1 — Esqueleto Next.js + i18n (COMPLETADA)

Next 16.3 (App Router, Turbopack) · React 19 · next-intl 4 · Tailwind 4 · Zustand 5.

| Entregable | Ruta |
|---|---|
| Routing i18n + navegación consciente del locale | `src/i18n/{routing,navigation,request}.ts` |
| Proxy de detección de idioma | `src/proxy.ts` |
| Aislamiento COOP/COEP por ruta (ADR-04) | `next.config.ts` |
| Diccionarios de UI (68 claves × 2) | `messages/{es,en}.json` |
| Paridad i18n en CI | `scripts/check-i18n-parity.ts` |
| Layout de juego de 3 zonas | `src/components/layout/{GameShell,LeftPanel,RightPanel,OutputDock}.tsx` |
| Selector de idioma que conserva la ruta | `src/components/i18n/LocaleSwitch.tsx` |
| Tema CRT/cyberpunk + modo rendimiento | `src/app/globals.css` |
| Estado de sesión fuera de React | `src/stores/useSessionStore.ts` |

**Verificado en runtime** (`next build` + `next start`):

- `/` → 307 a `/es`; con `Accept-Language: en` → 307 a `/en`.
- `/es` sirve «Elige tu ruta», `/en` sirve «Pick your track»; ambos prerenderizados como estáticos.
- COOP `same-origin` presente en `/es/play/devops/*` y `/es/play/backend/*`, **ausente** en
  `/es/play/frontend/*` y en la home — el aislamiento no contamina el resto de la app.
- El chequeo de paridad detecta clave faltante, clave sobrante y placeholder ICU divergente (exit 1).

**Corrección al criterio de salida original.** Estaba mal planteado: decía «cambiar idioma no
remonta ningún componente con estado». En el App Router eso es imposible — `/es/…` → `/en/…`
cambia el segmento `[locale]`, así que React **sí** remonta el subárbol. La garantía real del
ADR-01 se consigue de otra forma: el estado vive **fuera del árbol de React**, en stores de
módulo de Zustand con `persist`. El remount ocurre y da igual.

**Criterio de salida (corregido):** ningún estado de progreso —combo, XP, pulsaciones, buffer
del editor— se guarda en `useState` dentro del subárbol de `[locale]`. `useSessionStore` es
la implementación de referencia y `SessionMeter` la prueba visible.

> Actualización tras la Fase 2: la lógica ya está cubierta por
> `tests/lesson-store.test.ts`, que prueba la supervivencia del progreso al cambiar de
> idioma a nivel de store. Sigue faltando el E2E de navegador que lo confirme con
> navegación real de cliente — pendiente de Playwright en Fase 5.

### ✅ Fase 2 — Content loader + store de lección (COMPLETADA)

| Entregable | Ruta |
|---|---|
| Loader con índice `id → fichero`, validación y caché | `src/lib/content/loader.ts` |
| Recorte de payload hacia el cliente (`toClientLesson`) | `src/lib/content/loader.ts` |
| Endpoint de pistas | `src/app/api/hint/route.ts` |
| Store de lección | `src/stores/useLessonStore.ts` |
| Guía, pistas, briefing de entrevista, markdown | `src/components/lesson/*` |
| Árbol de archivos y editor con buffer editable | `src/components/editor/*` |
| Tests del store | `tests/lesson-store.test.ts` — 8/8 |

Las 4 rutas de lección (2 lecciones × 2 idiomas) se prerenderizan desde JSON en build.

**La invariante del ADR-01 ya está probada, no solo razonada.** El test
«cambiar de idioma NO reinicia el progreso» escribe código, revela una pista, cambia
de idioma y comprueba que los textos cambian mientras el buffer, el paso y las pistas
gastadas siguen intactos. Toda la implementación es un `if` en `syncLesson`: misma
lección → sustituye solo los textos.

#### Hallazgo: la solución viajaba al navegador

Al inspeccionar el HTML servido apareció que el payload RSC —texto plano dentro del
HTML— incluía `solution.files` **con el Dockerfile ya resuelto**, el texto de todas las
pistas (que cuestan XP) y las reglas marcadas como `hidden`. Abrir devtools era una
estrategia ganadora y la economía de XP no valía nada.

Corregido en tres piezas:

1. `toClientLesson()` elimina `solution`, el texto de las pistas y las reglas ocultas.
2. `/api/hint` entrega el texto de UNA pista bajo demanda, que es donde la Fase 7
   descontará el XP en servidor.
3. Las reglas `hidden: true` no viajan → **se evaluarán en servidor** en la Fase 4.
   Consecuencia de diseño a tener presente: el motor de evaluación tendrá dos rutas,
   cliente para las reglas visibles e inmediatas, servidor para las ocultas.

**Verificado:** barrido sobre el HTML servido en ES y EN — ninguna de las 5 líneas que
la solución añade sobre el código de partida aparece en el documento.

#### Hallazgo: la lección regalaba su propia respuesta

El mismo barrido destapó un problema de autoría, no de código: el paso 3 de
`docker-07-layer-cache` pegaba el Dockerfile multi-stage resuelto como material
didáctico, y un follow-up daba el flag exacto. Recortar el payload no sirve de nada si
el enunciado contiene la solución.

Ambos reescritos para enseñar la *forma* con un ejemplo ajeno (un build de Go) y dejar
que el usuario la traslade a su ejercicio. Y convertido en check automático dentro de
`validate-content.ts`, con dos matices que evitan falsos positivos:

- **Solo se aplica de `adept` en adelante.** En `novice`/`apprentice`, enseñar la
  sintaxis exacta es la pedagogía correcta; nadie deduce `COPY package*.json` en su
  primera lección de Docker.
- **Solo cuenta lo que la solución añade** sobre el código de partida. `RUN npm run build`
  ya está delante del usuario: repetirlo no revela nada.

Las pistas quedan fuera del check a propósito: la de tier 3 **sí** debe poder ser la
solución literal — cuesta XP y solo se sirve cuando el usuario decide gastarla.

**Criterio de salida:** cumplido. `npm run check` (contenido + i18n + tests + build) en verde.

### ✅ Fase 3 — Runners (COMPLETADA para el contenido existente)

| Entregable | Ruta |
|---|---|
| Contrato único + emisor de salida | `src/lib/runners/types.ts` |
| Runner de DOM (iframe aislado) | `src/lib/runners/dom.ts` |
| Runner de Sandpack | `src/lib/runners/sandpack.ts` |
| Simulador de CLI + FS virtual + `docker build` | `src/lib/runners/cli-sim/` |
| Factory con carga perezosa | `src/lib/runners/factory.ts` |
| Estado del runner | `src/stores/useRunnerStore.ts` |
| Terminal xterm.js con historial | `src/components/terminal/XtermPane.tsx` |
| Superficie de ejecución | `src/components/preview/RunnerSurface.tsx` |
| Tests | `tests/cli-sim.test.ts` (14) · `tests/dom-runner.test.ts` (8) |

**Reordenado por cobertura de contenido, no por riesgo teórico.** El plan original
ponía Sandpack primero. Al contar los runtimes de las 15 lecciones, `dom` cubre **8** y
no tiene dependencias externas — así que va primero y desbloquea más de la mitad del
contenido antes de tocar una sola librería de terceros.

| kind | lecciones | estado |
|---|---|---|
| `dom` | 8 | ✅ implementado y probado |
| `sandpack` | 6 | ✅ implementado (bundler vía CDN en el primer arranque) |
| `cli-sim` | 1 | ✅ implementado y probado |
| `webcontainer` | 0 | ❌ **dependencia eliminada** (ADR-09) |
| `pyodide` | 0 | ⏸️ sin contenido que lo use |
| `remote` | 0 | ⏸️ sin contenido que lo use |

Pyodide y el runner remoto no son deuda: construir un motor antes de que exista una
sola lección que lo ejercite es código sin usuario que valide su diseño. Se harán en
cuanto haya contenido de Python o de Go.

#### Decisión: WebContainers fuera (ADR-09)

La terminal se convirtió en una **capacidad componible** en lugar de un tipo de runtime.
`Shell` se extrajo de `CliSimRunner` y ahora se acopla a cualquier runner, así que
`react-04` es `sandpack` **con** `terminal.enabled` — preview real de React y consola a
la vez, que era la combinación que se creía imposible.

Resultado: **ninguna lección depende de WebContainers**, ni de su licencia. El coste,
declarado abiertamente dentro de la propia lección, es que no es Node real: no se puede
instalar un paquete arbitrario, solo las plantillas de `npm-scenario.ts`.

Verificado con 15 tests, incluido el flujo completo de la lección:
`npm create vite@latest app -- --template react` → `cd app` → `npm install` → `npm run dev`,
con los errores realistas por el camino (instalar sin `cd`, arrancar sin `node_modules`,
pedir un script que no existe).

**El simulador de Docker simula el ruido, no el mecanismo.** `docker build` parsea el
Dockerfile de verdad y calcula la caché de capas de verdad: huella por instrucción,
contenido real de los archivos que toca cada `COPY`, y la regla de que una capa
invalidada invalida todas las siguientes. Lo inventado son los hashes y los segundos.
Reordenar dos líneas cambia lo que sale por la terminal — que es exactamente lo que
`docker-07-layer-cache` enseña. Verificado con 14 tests, entre ellos:

- el Dockerfile roto **pierde** la caché de `npm install` al tocar `src/`;
- el arreglado **la conserva**, y solo la pierde al cambiar `package.json`;
- ninguna capa posterior a una invalidada aparece como cacheada;
- el multi-stage baja la imagen por debajo de los 200 MB que exige la lección.

**Aislamiento del runner de DOM:** iframe con `sandbox="allow-scripts"` y **sin**
`allow-same-origin`, lo que le da origen opaco — el código del usuario no alcanza
`localStorage`, cookies ni el DOM de la app. Cada ejecución crea un iframe nuevo en
lugar de reutilizarlo: es la única forma barata de garantizar que no sobreviven timers
ni globals del intento anterior, que es el origen del clásico "lo arreglé y sigue
fallando". Un `setTimeout` de respaldo resuelve la promesa si el código nunca termina.

#### Corrección de contrato

`Runner.boot()` pedía `RuntimeSpec` —la versión bilingüe—, pero los runners viven en el
cliente, que solo recibe contenido ya localizado. El tipo lo destapó al integrar la
terminal: `terminal.greeting` llegaba como `string` donde se esperaba `{es, en}`.
El contrato ahora pide `LocalizedRuntimeSpec`, coherente con el ADR-01: **ningún
componente ni motor de cliente conoce el locale.**

**Criterio de salida:** cumplido para los tres runtimes con contenido. `npm run check`
en verde con 30 tests.

### Fase 3.5 — Workspace de proyecto real

Que el ejercicio se sienta un proyecto, no un formulario con un hueco.

**Terminal interactiva** (`XtermPane` sobre `WebContainerRunner`)

- Shell real con `npm install`, `npm create vue@latest`, `git`, `ls`, `cat`.
- El usuario **teclea el comando**: instalar Vite forma parte de la lección, no es
  andamiaje que ocurre por detrás.
- Historial persistente por lección y `cli-transcript` (regla ya existente en el schema)
  para validar que el comando correcto llegó a ejecutarse.
- Barandilla: lista de comandos permitidos por lección. No por seguridad —el contenedor
  ya está aislado— sino pedagógica: `rm -rf node_modules` a mitad de una lección de
  React solo genera una sesión de soporte.

**Árbol de archivos vivo** (`FileTree` mutable)

- Carpetas anidadas, crear / renombrar / borrar, menú contextual, arrastrar y soltar.
- **Sincronización bidireccional**: lo que el usuario crea aparece en el FS del runner,
  y lo que un comando genera (`npm create vue` escribiendo 40 archivos) aparece en el
  árbol. Este es el trabajo real de la fase; el resto es UI.
- Badges de estado: modificado, creado, generado por herramienta.
- `node_modules` colapsado y virtualizado — 300 MB de árbol no se renderizan.

**Impacto en el modelo de contenido**

`workspace.files` deja de ser la lista definitiva de archivos y pasa a ser el estado
*inicial*. Campos nuevos en el schema (ver ADR-08): `workspace.allowCreate`,
`allowDelete`, `protectedPaths`, y `runtime.terminal` con `enabled` y `allowedCommands`.

**Criterio de salida:** una lección donde el usuario abre la terminal, ejecuta
`npm create vite@latest`, ve aparecer el árbol generado, edita un archivo y el preview
se recarga — todo dentro de la pestaña.

### ✅ Fase 4 — Motor de evaluación (COMPLETADA para el contenido existente)

| Entregable | Ruta |
|---|---|
| Contexto de evaluación y contrato `Validator` | `src/lib/engine/context.ts` |
| Validadores textuales (regex, file, stdout, transcript) | `src/lib/engine/validators/text.ts` |
| Validador AST (acorn + esquery) | `src/lib/engine/validators/ast.ts` |
| Aserciones sobre el DOM | `src/lib/engine/validators/dom.ts` |
| Buenas prácticas de Dockerfile | `src/lib/engine/validators/dockerfile-lint.ts` |
| Registro y veredicto de paso | `src/lib/engine/index.ts` |
| Fases, debounce y margen de gracia | `src/lib/engine/dispatcher.ts` |
| Estado de evaluación | `src/stores/useEvaluationStore.ts` |
| Lista de comprobaciones con 3 estados | `src/components/lesson/TestResultList.tsx` |
| Tests | `tests/engine.test.ts` — 48 |

**Ocho validadores, elegidos por uso real.** `yaml-path`, `unit-test`, `http-assert` y
`custom` están en el schema pero ninguna lección los usa: se implementarán cuando exista
contenido que los ejercite, por el mismo criterio que Pyodide en la Fase 3.

#### `ast-query`: acorn + esquery en lugar de tree-sitter

El schema lo especificó con queries de tree-sitter, pero llevarlo al navegador cuesta un
WASM de 1-2 MB **por lenguaje**, y las reglas que lo usan son todas de JS/JSX. `acorn` +
`esquery` cubren ese caso con una fracción del peso y con selectores tipo CSS que además
se leen mejor: `CallExpression[callee.property.name="map"]`. Cuando haya lecciones de
Python o Go, tree-sitter volverá como validador aparte para esos lenguajes — el registro
permite tener ambos sin que la UI ni el contenido se enteren.

#### Tres estados, no dos

Un validador devuelve `null` cuando **no puede pronunciarse**: `dom-assert` sin haber
ejecutado nada, `ast-query` sobre código a medio escribir. Eso se pinta en gris, no en
rojo. Marcar como incorrecto lo que el usuario aún no ha tenido ocasión de hacer bien es
la forma más rápida de que deje de mirar el panel de pruebas.

Por lo mismo, una regla `damage` no dispara hasta 800 ms después de la última pulsación:
nadie debe recibir un golpe por estar a medio escribir `func`.

#### ⭐ El test de oro, y los tres bugs que encontró

Cada lección se evalúa **contra su propia solución de referencia** (debe pasar) y
**contra su código de partida** (alguna regla bloqueante debe fallar, o el ejercicio ya
venía resuelto). Para las lecciones con terminal, el test ejecuta antes los comandos que
la regla `cli-transcript` declara — lo que de paso prueba que la transcripción esperada
es realmente ejecutable.

Encontró tres defectos reales de contenido:

1. **`js-02` / `no-console-inside`** y **`js-09` / `listener-outside-loop`** eran reglas
   `regex-forbid` que intentaban expresar «dentro de esta función» y «dentro de este
   bucle». **Una regex no puede razonar sobre bloques**: ambas marcaban como infractora
   la propia solución de referencia, porque el patrón cruzaba el cierre del bloque.
   Habrían castigado al usuario por hacerlo bien. Migradas a `ast-query`, donde la
   relación de anidamiento se expresa de verdad.
2. **`react-04` / `deps-installed`** falsamente en rojo: el test no ejecutaba los
   comandos, así que el proyecto generado por `npm create vite` no existía. Bug del test,
   corregido reconstruyendo el workspace resuelto.

**Criterio de salida:** cumplido. Las 7 reglas de `docker-07-layer-cache` evalúan
correctamente contra la solución y contra el estado inicial roto. `npm run check` en
verde con **93 tests**.

### ✅ Fase 5 — Editor gamificado (COMPLETADA)

| Entregable | Ruta |
|---|---|
| Monaco con tema CRT y lenguaje por extensión | `src/components/editor/{CodeCanvas,monaco-theme}.ts(x)` |
| Partículas Power Mode sobre canvas | `src/components/editor/PowerModeFX.ts` |
| Decoraciones de daño y foco del paso | `CodeCanvas.tsx` + `globals.css` |
| E2E de navegador | `e2e/lesson.spec.ts` — 7 tests · `playwright.config.ts` |

**Criterio de salida: cumplido y medido.** 49 fps sostenidos tecleando a ~50
pulsaciones/segundo con partículas activas, en Chromium headless (donde el techo real
está por debajo de 60). Tres decisiones lo sostienen:

- **Canvas, no DOM.** Un `<div>` por partícula obligaría a recalcular estilo y layout de
  decenas de nodos por fotograma.
- **Pool fijo de 220 partículas, sin asignaciones.** Crear objetos por pulsación llenaría
  la nursery del GC y produciría microparones justo al escribir rápido.
- **El bucle se detiene solo.** Sin partículas vivas no se pide `requestAnimationFrame`:
  el coste en reposo es cero, no un bucle vacío girando a 60 Hz.

El autocompletado de Monaco se desactiva a propósito (`quickSuggestions: false`):
sugerir `.map(` regala parte del ejercicio que la lección quiere enseñar.

#### 🐛 El bug que llevaba tres fases escondido

Al abrir la app en un navegador real **por primera vez**, la página entera no cargaba:
`Minified React error #185` — «Maximum update depth exceeded». No era de la Fase 5.

```ts
// El culpable, presente desde la Fase 2:
useLessonStore((s) => s.lesson?.workspace.files.filter((f) => !f.hidden) ?? [])
```

Zustand v5 compara la salida del selector con `Object.is`. Un `.filter()` devuelve un
array **nuevo** en cada llamada, así que el componente se consideraba cambiado siempre.
Lo mismo con `?? []`. Corregido con `useShallow` en `useVisibleFiles`,
`useCurrentStepRules` y `allowedCommands`, y con `useMemo` en `useStepChecks`.

Un segundo bucle, este sí de la Fase 4: `LessonBoot` escribe en el store durante su
render, y le añadí un `useEffect` suscrito a `stepIndex`. Cada escritura lo volvía a
renderizar. La limpieza de veredictos se movió a `useLessonStore.subscribe`, fuera del
árbol de React.

**La lección de método:** 93 tests unitarios en verde y el build limpio no detectaron que
**la aplicación no arrancaba**. Ninguna de las cinco fases anteriores la había abierto en
un navegador. El E2E no es un extra de esta fase: es lo que convierte «compila» en
«funciona».

#### E2E — 7 tests contra el build de producción

Incluye por fin el pendiente arrastrado desde la Fase 1: **cambiar de idioma con
navegación de cliente real conserva el código escrito**. Se teclea en Monaco, se pulsa
el selector de idioma, y se comprueba que el texto de la guía cambia mientras el buffer
sigue intacto. El ADR-01 ya no está garantizado «por construcción» ni solo a nivel de
store: está probado de extremo a extremo en un navegador.

> Nota de entorno: `playwright install --with-deps` requiere sudo y no está disponible
> aquí; el navegador se instaló sin dependencias del sistema y funciona. En CI conviene
> usar la imagen oficial de Playwright.

### ✅ Fase 6 — Gamificación y audio (COMPLETADA)

| Entregable | Ruta |
|---|---|
| Combo con ventana, decay y anti-cheat | `src/lib/game/combo.ts` |
| Curva de niveles y cálculo de XP | `src/lib/game/xp.ts` |
| Evaluación de logros | `src/lib/game/achievements.ts` |
| Catálogo bilingüe de 12 logros | `content/achievements/achievements.json` |
| Motor de audio y packs sintetizados | `src/lib/audio/{engine,packs}.ts` |
| Store de juego (absorbe `useSessionStore`) | `src/stores/useGameStore.ts` |
| HUD, combo flotante, toasts y confeti | `src/components/gamification/*` |
| Tests | `tests/game.test.ts` (22) · 3 E2E nuevos |

#### El audio se sintetiza, no se descarga

El roadmap preveía muestras grabadas con un presupuesto de 150 KB por pack. Se
sintetizan con Web Audio en su lugar, y el presupuesto pasa a **0 KB**:

- **Nada que precargar ni que falle** en una conexión mala.
- **Variación real y gratis**: cada pulsación cambia frecuencia y duración, así que no
  hay dos golpes idénticos. Con muestras harían falta 3-4 grabaciones por tecla y aun
  así se oye el bucle.
- **Sin licencias** que auditar antes de lanzar.

Seis packs: `mechanical` (click del switch + thock de la placa), `typewriter` (con campana
de retorno de carro en `Enter`), `duck`, `blades`, `retro` (8 bits) y `silent`. El coste
honesto: un teclado mecánico sintetizado no engaña a un audiófilo; `duck` y `retro`
suenan incluso mejor así.

Tres cosas sin las que el audio estorba en lugar de aportar, todas implementadas: el
`AudioContext` arranca suspendido y se reanuda en el **primer gesto real** (si no, el
navegador lo bloquea y el pack parece roto); techo de **12 voces** en ventanas de 90 ms
para que teclear rápido no sea un muro de ruido; y un único nodo maestro para volumen y
silencio.

**Silencio es el valor por defecto**, y el Modo Rendimiento apaga también el sonido:
`prefers-reduced-motion` no cubre el audio, así que necesita su propio interruptor.

#### Combo y economía de XP

Cinco tramos (1× → 3×) con ventana de 1,8 s. Tres decisiones deliberadas:

- **El combo multiplica la base pero NO las bonificaciones.** Si multiplicara también el
  bonus por resolver sin pistas, teclear rápido valdría más que pensar.
- **Un pegado de más de 40 caracteres rompe el combo** (ADR-06). Sin esto, pegar la
  solución daría el multiplicador máximo y «Racha imparable» no significaría nada.
- **Mantener una tecla pulsada no cuenta**: se filtra `event.repeat`, y las teclas de
  navegación quedan fuera.

La curva de niveles es cuadrática suave, no exponencial: verificado en test que el nivel
20 no cuesta más de 12× lo que el nivel 5, para que a partir de cierto punto no deje de
sentirse como progreso.

#### Logros

12 logros bilingües con progreso parcial calculable. `findNewlyUnlocked` devuelve solo
los que **cambian** de estado: reabrir la app no dispara una cascada de toasts por cosas
celebradas hace semanas.

> Se conceden en cliente y por tanto son falseables. `isUnlocked` es una función pura
> sobre `PlayerStats` precisamente para que la Fase 7 la reutilice en el servidor sin
> tocar una línea.

**Criterio de salida:** cumplido. **115 tests unitarios + 10 E2E**. El combo y el
anti-cheat están probados en navegador real, y los fps con partículas ligadas al combo
subieron a **70** (frente a los 49 de la Fase 5, misma prueba).

### ✅ Fase 7 — Persistencia y perfil (COMPLETADA)

| Entregable | Ruta |
|---|---|
| Schema Postgres (Drizzle) | `src/lib/db/schema.ts` |
| Cliente con doble driver | `src/lib/db/client.ts` |
| Consultas y economía de XP | `src/lib/db/queries.ts` |
| Identidad anónima firmada | `src/lib/auth/session.ts` |
| Autosave y carga | `src/app/api/progress/route.ts` |
| Cierre de lección y XP | `src/app/api/progress/complete/route.ts` |
| Puente cliente↔servidor | `src/components/system/ProgressSync.tsx` |
| Tests | `tests/db.test.ts` (13) · 4 E2E nuevos |

#### PGlite: Postgres de verdad, sin servidor

No había Postgres disponible para desarrollar ni para probar. En lugar de mockear la
capa de datos —que es tanto como no probarla— se usa **PGlite**, Postgres compilado a
WASM. Mismo SQL, mismo schema Drizzle, mismos tipos. En producción basta definir
`DATABASE_URL` y cambia el driver; el schema no se toca.

Eso permitió **13 tests contra una base real**: claves primarias compuestas,
`ON CONFLICT`, `GREATEST`/`LEAST` y columnas `jsonb` ejercitados como en producción.

#### El hueco declarado en la Fase 6, cerrado

La economía vivía entera en el cliente y bastaba la consola del navegador para
inventarse el nivel 99. Ahora:

- **El cliente no envía cuánto XP merece**, envía qué hizo: qué lección, cuánto tardó,
  si usó pistas, si recibió daño. El servidor lee las recompensas desde `content/` y
  calcula. Verificado en E2E: una petición con `xpAwarded: 999999` recibe **145**, que es
  lo que `js-01-variables` reparte de verdad.
- **Completar dos veces no paga dos veces.** Sin esta comprobación, recargar tras
  terminar una lección sería una máquina de XP infinito. Probado.
- **El track y el módulo salen del contenido**, no de la petición: aceptarlos de fuera
  permitiría falsear las estadísticas por track.
- **Y desde el ADR-23, tampoco basta con decir «he terminado»**: hay que mandar el código,
  y el servidor comprueba contra él las reglas del último paso que puede juzgar sin
  ejecutar nada. Cierra la reclamación falsa en 18 de las 35 lecciones; en el resto el
  último paso solo se puede juzgar ejecutando, y eso se dice en vez de fingirlo.
- **Los contadores solo suben** (`GREATEST`): un cliente obsoleto no puede bajarlos.
  Contra los inflados no hay defensa sin instrumentar el editor, y no compensa.
- **El logro «módulo completado» solo puede concederlo el servidor**, porque hace falta
  saber cuántas lecciones tiene el módulo — dato que el cliente no posee.

#### Identidad anónima antes que Auth.js

Pedir registro antes de dejar escribir una línea de código es la forma más eficaz de
perder al usuario en la primera pantalla. La plataforma arranca con una identidad
anónima que ya guarda progreso; `users.email` es opcional justo para que la cuenta se
reclame después heredando el mismo `id`.

La cookie va **firmada con HMAC** y se verifica en tiempo constante: sin firma, editarla
en devtools sería suplantar a cualquier usuario cuyo id se conozca. En producción sin
`SESSION_SECRET` el servidor **se niega a arrancar** en lugar de firmar con una clave
conocida y aparentar seguridad — comportamiento que el propio E2E destapó al fallar.

#### Autosave

Debounce de 2,5 s. En cada pulsación serían peticiones cada 80 ms; solo al salir se
perdería todo si el navegador se cierra de golpe. Al volver, el buffer se restaura —
pero **solo si el usuario no ha empezado a escribir ya**: pisarle lo que acaba de teclear
sería peor que no restaurar nada.

Verificado en navegador: se escribe, se recarga la página, y el código sigue ahí.

**Criterio de salida:** cumplido. **128 tests unitarios + 14 E2E**.

> Pendientes conocidos: la racha diaria corta a medianoche **UTC** (para un usuario en
> UTC-6 el día "termina" a las 18:00); el mapa de mundos con progreso por track sigue sin
> construirse; y no hay flujo para reclamar la cuenta anónima con un email.
>
> *(Los tres cerrados. El mapa de mundos, en la Fase 8. Reclamar la cuenta, en el ADR-17:
> correo y contraseña conservando el mismo `id`, código de recuperación en vez de correo de
> reset, y fusión del progreso anónimo al entrar. Y la racha, en el ADR-24: corta a la
> medianoche del calendario del usuario, con su zona horaria IANA guardada.)*

### ✅ Fase 8 — Mapa de mundos, autoría y CI (COMPLETADA)

| Entregable | Ruta |
|---|---|
| Lógica de progresión y desbloqueo | `src/lib/content/progression.ts` |
| Mapa de mundos por track | `src/app/[locale]/tracks/[track]/page.tsx` |
| Home con progreso y racha | `src/app/[locale]/page.tsx` |
| Guía de autoría | `docs/AUTHORING.md` |
| CI (contenido, tipos, tests, E2E) | `.github/workflows/ci.yml` |
| Tests | `tests/progression.test.ts` (10) |

#### El mapa de mundos, y una decisión sobre el bloqueo

Cada lección tiene cuatro estados: completada, en progreso, disponible y bloqueada. La
decisión que importa es **qué bloquea**:

> Un prerequisito **que existe** y no está completado bloquea la lección. Un
> prerequisito **que aún no se ha escrito** no bloquea nada.

Sin ese matiz, el backlog del currículo —12 lecciones referenciadas y no escritas— haría
inaccesible media plataforma hasta terminar el temario entero. Hay un test dedicado.

Y dos comprobaciones sobre el currículo real, no sobre datos inventados:

- **El track tiene punto de entrada**: sin al menos una lección disponible de inicio,
  nadie podría empezar — el fallo más caro posible en un mapa de progresión.
- **Todo es alcanzable**: se simula un usuario avanzando siempre por la recomendada y se
  comprueba que llega a las 15 lecciones. Si una quedara inalcanzable por un ciclo o un
  prerequisito imposible, el test falla.

La página se renderiza en servidor leyendo el progreso directamente de la base de datos:
es una pantalla de solo lectura y no gana nada pasando por una API. Sin sesión se ve
igual, solo sin progreso.

#### CI

Dos jobs. El de contenido corre `content:check` **primero**, antes que los tipos y el
build: es el control más rápido y el que más falla al escribir lecciones — falla en 2 s
en vez de después de un build completo. El de E2E usa la imagen oficial de Playwright,
que trae las dependencias de sistema del navegador (el problema que apareció en la
Fase 5, donde `--with-deps` necesitaba sudo).

**Criterio de salida:** cumplido. **138 tests unitarios + 14 E2E**, y la aplicación es
navegable de principio a fin: home → track → lección → progreso guardado.

---

## Estado del contenido

**15 lecciones**, todas bilingües y validadas en CI. El track de Frontend arrancó primero
por decisión deliberada: es el de runners más simples y el que puede lanzarse completo.

### ✅ JavaScript — módulo completo y jugable de principio a fin

Cadena sin huecos, de primer contacto a nivel `adept`. Es el primer módulo que se puede
recorrer entero sin encontrarse una lección que no existe:

```
js-01-variables ──▶ js-02-functions ──▶ js-03-array-map ──▶ js-06-dom-manipulation
   const/let          arrows, return       .map(), inmutable      querySelector, XSS
                                                                        │
                                            js-09-event-delegation ◀── js-08-event-listeners
                                             burbujeo, 5.000 filas       preventDefault
```

| Lección | Tipo / Nivel | Qué enseña de verdad |
|---|---|---|
| `js-01-variables` | concept / novice | Que `const` congela la **referencia**, no el valor |
| `js-02-functions` | drill / novice | El `return` implícito y por qué `=> { n * 2 }` da `undefined` · **4 drills** |
| `js-03-array-map` | drill / apprentice | Transformar sin mutar · **4 drills** |
| `js-06-dom-manipulation` | concept / apprentice | `textContent` vs `innerHTML` como asunto de **seguridad**, no de estilo |
| `js-08-event-listeners` | challenge / apprentice | `addTask()` vs `addTask`, y por qué el formulario recarga |
| `js-09-event-delegation` | challenge / adept | Burbujeo, fugas de memoria, y **cuándo NO delegar** |

### ✅ React — módulo completo, con boss

Segunda cadena sin huecos, y la primera que llega hasta nivel entrevista:

```
react-01-components ──▶ react-02-jsx ──▶ react-03-props ──▶ react-04-state-and-events
   3 reglas, función      llaves, key       solo lectura        terminal + useState
                                                                       │
                                            react-10-render-performance ◀┘
                                              👑 BOSS · memo/useMemo/useCallback
```

| Lección | Tipo / Nivel | Runtime | Qué enseña de verdad |
|---|---|---|---|
| `react-01-components` | concept / novice | `sandpack` | Las 3 reglas: mayúscula, `return`, raíz única |
| `react-02-jsx` | drill / novice | `sandpack` | `className`, y por qué el índice es mala `key` · **4 drills** |
| `react-03-props` | challenge / apprentice | `sandpack` | Flujo unidireccional: por qué las props no se tocan |
| `react-04-state-and-events` | challenge / apprentice | `webcontainer` | **Scaffolding con terminal real** + actualización funcional |
| `react-10-render-performance` | **interview** / interview | `sandpack` | Igualdad referencial, y **cuándo NO memoizar** |

`react-10` es el primer boss de Frontend. Su tercer paso no pide código: pide argumentar
que la mejor optimización aquí no es memoizar sino **mover el estado**, porque si `query`
viviera junto al `input` la tabla no se repintaría en absoluto. Los cuatro follow-ups
cubren lo que de verdad se pregunta en una entrevista senior: por qué `memo` no mejoró
nada (props inestables), qué pasa al omitir una dependencia (bug de corrección, peor que
la lentitud), por qué con 2.000 filas visibles haría falta virtualización, y cómo
demostrarlo con el Profiler y el INP.

### Resto de módulos

| Lección | Módulo | Tipo / Nivel | Runtime | Qué enseña |
|---|---|---|---|---|
| `html-01-first-page` | HTML | concept / novice | `dom` | El esqueleto: doctype, `lang`, charset, viewport |
| `html-02-semantic-structure` | HTML | concept / novice | `dom` | Landmarks, `div` soup, accesibilidad |
| `css-03-box-model` | CSS | concept / novice | `dom` | `border-box`, y por qué 300px no miden 300px |
| `css-05-flexbox-centering` | CSS | drill / apprentice | `dom` | Eje principal vs transversal · **4 drills** |
| `vue-03-reactivity` | Vue | concept / apprentice | `sandpack` | `ref`/`reactive`, `.value`, `computed` |
| `docker-03-dockerfile-basics` | Docker | concept / apprentice | `cli-sim` | `RUN` vs `CMD`, `:latest`, contexto de build |
| `docker-05-images-layers` | Docker | concept / adept | `cli-sim` | Capas inmutables: lo que borras sigue ahí |
| `docker-07-layer-cache` | Docker | interview / interview | `cli-sim` | Caché de capas, multi-stage, secretos |

Las tres de Docker forman ahora una cadena: `docker-03` escribe la receta, `docker-05`
la abre por dentro y `docker-07` la exprime. Las tres se apoyan en el **mismo parser**
(ADR-03), así que la terminal y el evaluador nunca pueden contradecirse.

Las dos lecciones nuevas de Docker no afirman nada que el simulador no muestre: el
`.dockerignore` de `docker-03` baja la capa de copia de 18 s a 2 s, y el adelgazamiento
de `docker-05` lleva la imagen de 624 MB a 299 MB y saca el secreto de `docker history`.
Verificado ejecutando la `Shell` con el código de partida y con la solución.

**Arquetipos cubiertos:** `concept`, `drill`, `challenge`, `interview`. Falta `system-design`.

`react-04` estrena los campos nuevos del schema (`runtime.terminal`,
`workspace.allowCreate`) y ejercita el ADR-07: el usuario teclea `npm create vite@latest`,
ve el árbol llenarse y solo entonces escribe React.

### Backend — arrancado con SQL sobre PGlite (ADR-11)

El track que estaba vacío ya tiene su primer módulo, y ejecuta **PostgreSQL de verdad**
dentro del navegador. No hizo falta un runtime remoto ni un servidor de ejecución: PGlite
ya era dependencia del proyecto para los tests de la capa de datos.

| Lección | Tipo / Nivel | Qué enseña de verdad |
|---|---|---|
| `sql-01-select` | concept / novice | `SELECT`, `WHERE`, por qué `SELECT *` no llega a producción, y `NULL` |
| `sql-02-aggregate` | concept / apprentice | `GROUP BY`, `WHERE` vs `HAVING`, y el orden real de ejecución |
| `sql-03-joins` | **challenge** / adept | `LEFT JOIN`, y el `WHERE` que lo convierte en `INNER` sin avisar |

Las tres encadenan: `sql-02` termina señalando una categoría que **desaparece** del
informe, y `sql-03` existe para recuperarla. El cierre de `sql-03` es el error más caro
del SQL cotidiano precisamente porque el resultado *parece* correcto — nadie revisa un
panel buscando la fila que no está.

Lo que hace fiable este contenido es `tests/sql-lessons.test.ts`: ejecuta cada lección
contra un PGlite real en Node, aplica su esquema, corre la consulta de referencia y la
pasa por el validador. Las filas esperadas se escriben a mano en el JSON de la lección, y
ese es exactamente el sitio donde se cuela una tilde de más o una fila olvidada.

**Pendiente del módulo:** subconsultas y CTEs, índices con `EXPLAIN ANALYZE`, y
transacciones/aislamiento — el `ROLLBACK` que el runner ya usa por dentro da un buen
punto de partida para explicarlo.

### React — TodoMVC con la trampa propia del framework

`react-05-todo-list` adapta el mismo TodoMVC que `vue-04`, y a propósito: el ejercicio es
el mismo y **la trampa no**. En Vue el error caro es filtrar el array de origen; en React
es el `useState` de más.

El paso 2 es el que sostiene la lección: el contador de pendientes **no es estado**, es una
pregunta que se le hace al array. Guardarlo en `useState` crea dos fuentes para el mismo
hecho y basta olvidar un `setPendientes` para que la interfaz mienta sin error ni traza. Y
el parche habitual —un `useEffect` que lo sincroniza— provoca un render de más y deja el
bug latente: sigue habiendo dos fuentes, ahora con un vigilante.

Comparar las dos lecciones lado a lado es, de hecho, la mejor forma de ver qué es del
problema y qué es del framework.

### HTML y CSS — engordando la puerta de entrada

Eran los dos módulos más flacos (2 lecciones cada uno) y son lo primero que ve alguien que
empieza de cero, así que iban antes que abrir nada nuevo.

| Lección | Lo que enseña de verdad |
|---|---|
| `css-01-selectors` | Por qué tu CSS «no se aplica»: especificidad por columnas, y que un `id` no se vence — se retira |
| `html-03-forms` | Que un `placeholder` no es una etiqueta y un `<div onclick>` no es un botón |

`css-01` va deliberadamente **antes** del modelo de caja: la primera frustración de quien
aprende CSS no es que la caja mida de más, es que su regla correcta no hace nada. El paso 1
pide escribir la regla y **comprobar que no funciona**, que es el descubrimiento entero.

`html-03` es la lección más cargada de accesibilidad del temario, y ninguno de sus tres
arreglos añade JavaScript: los tres consisten en usar la etiqueta y el atributo que ya
existían. Cierra con la advertencia que importa — la validación del navegador es comodidad,
y el servidor tiene que repetirla entera (OWASP A04).

Los colores computados y el DOM que prometen se comprueban en el navegador contra las
soluciones reales del JSON, paso a paso.

### C# — módulo cerrado con evaluador simulado (ADR-14)

| Lección | Origen | Lo que enseña de verdad |
|---|---|---|
| `csharp-01-leap-year` | **Leap** (Exercism) | Una regla con excepciones anidadas falla un año de cada cien |
| `csharp-02-fizzbuzz` | **FizzBuzz** | Que un encadenamiento se lee de arriba abajo: lo específico va delante |
| `csharp-03-triangle` | **Triangle** (Exercism) | Seis condiciones para lo que casi todos resuelven con tres, y el `>` que decide el caso degenerado |

Las tres viven dentro del subconjunto que el simulador declara —métodos que devuelven una
expresión— y las tres eligen ejercicios donde ese estilo **es** el idiomático en C#
moderno, no una limitación disfrazada.

Cada paso promete un avance concreto del marcador de pruebas, y eso se comprueba en el
navegador ejecutando las soluciones reales del JSON: si dejan de producir ese avance, el
enunciado del paso pasa a ser mentira y el E2E lo dice.

**Pendiente del módulo:** todo lo que necesite bucles, estado o E/S. Ahí el simulador se
planta y lo dice — estirarlo para fingir que ejecuta C# sería justo lo que el ADR-14
prohíbe.

### Ejercicios canónicos adaptados al formato (Vue)

Las lecciones nuevas no se inventan: se adaptan de los compendios donde ya están probadas
como ejercicios, y se les añade lo que un compendio no da — el porqué, la trampa y la
comprobación automática.

| Lección | Origen | Lo que de verdad enseña |
|---|---|---|
| `vue-04-todo-list` | **TodoMVC** | Por qué el índice es una `key` mentirosa, y por qué filtrar el array de origen es perder datos |
| `vue-05-word-count` | **Word Count** (Exercism) | Que el enunciado está incompleto: mayúsculas, puntuación, vacíos y orden no se mencionan y cambian el resultado |

`vue-05` es el patrón a seguir para adaptar un ejercicio de algoritmo: el paso 1 implementa
**literalmente lo que se pidió** —y sale mal, con nueve entradas para diez palabras—, y los
dos siguientes son las decisiones que el enunciado se calló. La versión ingenua no da error;
da una respuesta equivocada, que es exactamente lo que la hace buena pregunta de entrevista.

Las cuentas que promete cada paso (9 → 6 → `y: 3`) se comprueban en el navegador contra las
soluciones reales del JSON, no contra una copia en el test.

### Todo paso se practica, y nada se bloquea (ADR-12)

Dos cambios transversales a las 24 lecciones:

**Los 15 pasos que no pedían escribir nada ahora piden.** Eran pasos de solo lectura —«lee
el diagrama», «anota cuántas veces se renderiza», «explica en voz alta»— repartidos por 10
lecciones. `validate-content.ts` los rechaza desde ahora: todo paso declara al menos una
regla, y una lección con un paso pasivo no pasa CI.

**Ninguna lección tiene candado.** El mapa avisa —`Recomendado antes: …`, con los títulos,
no con un número— y deja entrar. Quien quiere practicar React entra por React.

Ambos trajeron cambios de motor: `steps[].solution` (para poder verificar cada ejercicio
por separado) y el estado `locked` fuera de `progression.ts`.

### Backlog del currículo — vacío

`validate-content.ts` construye el grafo de prerequisitos y lista lo que no existe.
No bloquea el build —durante la construcción del temario es normal referenciar lo que
viene después— pero lo mantiene visible en lugar de dejarlo como deuda silenciosa.
Los **ciclos sí son error**: un track sin punto de entrada no se puede empezar.

Hoy no queda ninguna referencia rota: **toda lección citada como prerequisito existe**.

**Sin empezar: solo Python.** Ningún runner actual lo ejecuta, y esa decisión sigue
abierta — runtime remoto con base efímera por petición, o Pyodide.

**Next.js ya tiene módulo y motor** (ADR-27): tres lecciones —el árbol de archivos como
router, dónde corre cada componente y qué arrastra `'use client'`, y una carpeta entre
corchetes que pasa de ƒ a ○— sobre un `next build` simulado que reproduce con su texto los
errores que se lleva todo el que empieza. Trajo además una herramienta que faltaba desde la
Fase 1: crear archivos desde la interfaz, sin la cual `allowCreate` no significaba nada.

**NestJS ya tiene módulo y motor** (ADR-28): tres lecciones —decorar no basta si el módulo
no lo declara, el error de dependencias provocado a propósito, y parámetros, cuerpo y
excepciones— sobre un `@nestjs/common` de mentira montado encima del Node simulado. El
compilador es el del editor, con decoradores y metadatos, así que la inyección por tipo es
la de verdad: el contenedor lee lo que TypeScript emite.

**Observabilidad ya es un capítulo, no solo instrumentación** (ADR-22 para lo nuestro):
tres lecciones en DevOps —de la prosa al evento estructurado, el identificador que une las
líneas de una misma petición, y por qué la media miente frente a los percentiles—.
Corrigen por salida, y `tests/observabilidad-lecciones.test.ts` ejecuta cada solución
publicada para que las cifras del enunciado sean las que salen de verdad.

**Node ya tiene módulo y motor** (ADR-26): tres lecciones —módulos y caché, el orden del
bucle de eventos, y un servidor HTTP sin framework— sobre un subconjunto simulado que se
compara con el Node real en los tests. WebContainers sigue bloqueado por licencia.

**TypeScript ya tiene módulo y motor** (ADR-25): tres lecciones —el error que llega antes
de ejecutar, uniones con estrechamiento, y genéricos hasta `Resultado<T>`— sobre el
compilador que Monaco ya carga para subrayar el editor. Comprueba tipos primero y solo
ejecuta si compila.

**PHP sí tiene motor** desde el ADR-20: un intérprete escrito en JavaScript (1,1 MB, MIT)
en lugar de PHP compilado a WebAssembly (10 MB y GPL). Cubre un subconjunto —sintaxis de
PHP 5.x y una biblioteca estándar que se completa con un prelude escrito en PHP— y las
tres primeras lecciones se escriben dentro de él. El límite no es una promesa: cada
solución se ejecuta con ese mismo motor en `tests/php-lessons.test.ts`.

**Módulos cerrados: 6 de 11** (JavaScript, React, Vue, HTML, CSS y Docker). Todos con
cadena completa desde su primera lección; React y Docker además con boss de entrevista.
SQL, TypeScript, Node, PHP, Next, Nest y observabilidad quedan abiertos a propósito: tienen
cadena completa y tema por delante.

---

## Riesgo que conviene tener presente

El esfuerzo de autoría bilingüe supera al de desarrollo a partir de la Fase 8. Un módulo
de 12 lecciones son ~12 000 palabras × 2 idiomas más código de partida, solución y reglas.
Merece la pena decidir pronto si v1 lanza con **un track completo** (recomendado: Frontend,
el de runners más simples) o con tres tracks a medias.

# Guía de autoría de lecciones

Cómo escribir una lección que pase los controles y que además enseñe algo.

---

## Flujo de trabajo

```bash
cp content/lessons/<track>/<módulo>/<plantilla>.lesson.json \
   content/lessons/<track>/<módulo>/<id>.lesson.json

npm run content:check   # schema, prerequisitos, spoilers, ciclos
npm test                # incluye el test de oro contra tu solución
npm run dev             # jugarla de verdad
```

El nombre del archivo **es** el id de la lección: `js-03-array-map.lesson.json` →
`js-03-array-map`. Reorganizar carpetas no rompe URLs, pero renombrar el archivo sí.

---

## Lo que el CI te va a exigir

| Control | Qué comprueba |
|---|---|
| Schema Zod | Estructura, y que **ambos idiomas** estén presentes en cada texto |
| Ids únicos | Ninguna lección repite id |
| Grafo de prerequisitos | Sin ciclos (error) · los que faltan se listan (aviso) |
| Anti-spoiler | De `adept` en adelante, el enunciado no contiene la solución |
| Paridad i18n | `messages/es.json` y `en.json` con las mismas claves y placeholders |
| **Test de oro** | Tus reglas **pasan** con tu solución y **fallan** con el código de partida |

El último es el que más problemas encuentra. Si tu regla falla contra tu propia
solución, la regla está mal — no la solución.

---

## Elegir el arquetipo

| `kind` | Cuándo | Forma |
|---|---|---|
| `concept` | Idea nueva que hay que entender antes de aplicar | 2-3 pasos, sin drills |
| `drill` | Sintaxis que debe salir sin pensar | 1 paso + **≥3 drills** (lo exige el schema) |
| `challenge` | Aplicar varias piezas ya vistas a un problema | 2-4 pasos, reglas estrictas |
| `interview` | Boss de módulo, problema real de entrevista | 3 pasos + bloque `interview` obligatorio |
| `system-design` | Diseño sin respuesta única | Se evalúa por `rubric`, no por reglas |

---

## Las reglas: elegir el validador correcto

Este es el error más caro y el que más veces hemos cometido.

**Una regex no puede razonar sobre estructura.** Si tu regla dice «dentro de esta
función» o «dentro de este bucle», necesita `ast-query`. Dos reglas `regex-forbid`
reales acabaron marcando como infractora la propia solución de referencia porque el
patrón cruzaba el cierre del bloque — habrían castigado al usuario por hacerlo bien.

| Necesitas comprobar | Usa |
|---|---|
| Que aparezca / no aparezca un texto | `regex-must` / `regex-forbid` |
| Relación estructural (dentro de, cuántas veces) | `ast-query` |
| Que la página renderice algo | `dom-assert` |
| La salida por consola | `stdout-match` |
| Que exista un archivo (o lo generó un comando) | `file-exists` |
| Que se ejecutaran ciertos comandos | `cli-transcript` |
| Buenas prácticas de Dockerfile | `dockerfile-lint` |

Selectores de `ast-query` (sintaxis `esquery`, tipo CSS sobre el AST):

```js
CallExpression[callee.property.name="map"]        // algo.map(...)
CallExpression[callee.name="useState"]            // useState(...)
VariableDeclaration[kind="const"]                 // const ...
ForOfStatement CallExpression[callee.property.name="addEventListener"]
```

Para prohibir con AST: `minMatches: 0, maxMatches: 0`.

### Fases y severidad

| `phase` | Cuándo corre | Coste admisible |
|---|---|---|
| `type` | Al escribir, con 120 ms de debounce | Barato. Solo regex |
| `run` | Tras pulsar ▶ | Ya hay stdout y DOM |
| `submit` | Al validar el paso | Todo |

| `severity` | Efecto |
|---|---|
| `error` | Bloquea el paso |
| `warn` | No bloquea; consejo de estilo |
| `damage` | Sacude la línea y resta energía. **No** es criterio de corrección |

Las `damage` no disparan hasta 800 ms después de la última pulsación: nadie debe
recibir un golpe por estar a medio escribir `func`.

---

## Escribir el contenido

**El enunciado no puede contener la solución** a partir de `adept`. Enseña la *forma*
con un ejemplo ajeno al ejercicio —un build de Go para explicar multi-stage en una
lección de Node— y deja que el usuario la traslade. El CI lo comprueba.

**Las pistas sí pueden serlo.** La de `tier: 3` puede ser la respuesta literal: cuesta
XP y solo se sirve desde `/api/hint` cuando el usuario decide gastarla. Nunca viaja en
el HTML.

**Escalona las pistas:** tier 1 conceptual, tier 2 el camino, tier 3 el código. Una
pista de tier N se bloquea hasta usar las anteriores.

**`bestPractice` es donde vive el estándar de industria** — Clean Code, OWASP, SOLID.
Es lo que separa «funciona» de «se hace así en un equipo».

### Los dos idiomas

Ambos son obligatorios y el schema no deja mergear sin ellos. No traduzcas literalmente:
adapta. Si `es` y `en` son idénticos en una descripción, el test de logros lo detecta.

---

## Prerequisitos

Referencia solo lo que de verdad hace falta haber visto. Los prerequisitos **que existen
y no están completados bloquean** la lección en el mapa; los que aún no se han escrito
no bloquean nada, pero salen listados en `content:check` como backlog.

Antes de dar por buena una cadena: `tests/progression.test.ts` comprueba que avanzando
siempre por la recomendada se llega a **todas** las lecciones del track. Si dejas una
inalcanzable, ese test falla.

---

## Recompensas

```jsonc
"reward": {
  "baseXp": 120,              // el combo multiplica ESTO
  "flawlessBonus": 60,        // sin daño
  "noHintBonus": 30,          // sin pistas
  "comboMultiplierCap": 3,    // techo del multiplicador
  "achievements": ["array-alchemist"]
}
```

Referencias orientativas: `novice` 90-110 · `apprentice` 130-180 · `adept` 250 ·
`interview` 400+.

El XP lo calcula **el servidor** leyendo estos campos. El cliente nunca envía cifras.

Si citas un logro en `achievements`, tiene que existir en
`content/achievements/achievements.json` — hay un test que lo comprueba.

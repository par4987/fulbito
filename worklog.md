# Worklog — Fútbol Pro 3D (juego de fútbol estilo PES en navegador)

Proyecto: Next.js 16 + TypeScript + Three.js (3D) + Prisma/SQLite.
Ruta visible única: `/` (src/app/page.tsx). Dev server en puerto 3000.

## Arquitectura acordada (Task 1 — planificador)

- **Motor del juego** en `src/game/` (TypeScript puro, client-side):
  - `constants.ts` dimensiones/tuning · `types.ts` contratos · `teams.ts` 12 equipos ficticios + plantillas generadas
  - `audio.ts` WebAudio sintetizado (silbato, golpes, multitud, rugido de gol)
  - `input.ts` teclado + táctil · `ball.ts` física (fricción, gravedad, rebotes)
  - `player.ts` entidad + rig 3D procedural (cápsulas) + animación de carrera
  - `ai.ts` IA 11v11 (persecución, apoyo, marcaje, portero con atajadas)
  - `match.ts` máquina de estados (saque inicial, gol, laterales/córner/saque de puerta, mediempo, final) + estadísticas
  - `stadium.ts` estadio (césped con textura canvas, tribunas con público instanciado, torres de luz, vallas)
  - `renderer3d.ts` escena/luz/cámaras (broadcast, aérea, tras arco) · `engine.ts` orquestador + radar + emisor de estado HUD
- **UI React** en `src/components/game/`: menú, selección de equipos, HUD broadcast, radar (canvas 2D), overlays (pausa/gol/mediempo/final), controles táctiles.
- **Backend**: `MatchResult` (Prisma/SQLite) + `POST/GET /api/matches` para historial de partidos.
- **API contract**: POST {homeTeam, awayTeam, homeGoals, awayGoals, difficulty, durationSec, possessionHome, shotsHome, shotsAway, shotsOnTargetHome, shotsOnTargetAway, events: string} → 201 {ok, match}. GET /api/matches?limit=20 → {matches:[...]}. Sin auth. Validación con zod. NO tocar src/game/**, src/components/**, src/app/page.tsx.
- Restricciones de estilo: sin azul/índigo; paleta verde estadio + ámbar/dorado; UI en español; responsive + controles táctiles.

---
Task ID: 2-a
Agent: full-stack-developer
Task: Backend historial de partidos (Prisma + /api/matches)

Work Log:
- Añadido modelo `MatchResult` a `prisma/schema.prisma` (User y Post intactos): id cuid, homeTeam, awayTeam, homeGoals, awayGoals, difficulty (default "profesional"), durationSec, possessionHome, shotsHome/Away, shotsOnTargetHome/Away, events (string JSON), createdAt @default(now()).
- Ejecutado `bun run db:push` → OK (SQLite db/custom.db sincronizada, Prisma Client v6.19.2 regenerado).
- Creado `src/lib/matches.ts` (tipos compartidos API): `MATCH_DIFFICULTIES`, `MatchDifficulty`, `MatchResultInput`, `MatchResultRecord`, `MatchPostResponse`/`MatchesGetResponse` (uniones discriminadas por `ok`), constantes `MATCHES_DEFAULT_LIMIT=20` / `MATCHES_MAX_LIMIT=50` y helper `serializeMatch()` (convierte fila Prisma a DTO JSON-safe con createdAt ISO).
- Creado `src/app/api/matches/route.ts` (NextRequest/NextResponse, `export const dynamic = 'force-dynamic'`, `import { db } from '@/lib/db'`):
  - POST: zod valida tipos (numéricos enteros ≥ 0, homeTeam/awayTeam 1-40 chars con trim, difficulty ∈ amateur|profesional|leyenda con default "profesional", possessionHome 0-100, events 1-20000 chars). JSON malformado → 400. Error de validación → 400 {ok:false, error:"Campo \"x\": ..."} (mensaje del primer issue, en español). Guarda con db.matchResult.create → 201 {ok:true, match}. Excepción → 500 {ok:false, error:"Error al guardar el partido"} + console.error.
  - GET: `?limit` opcional (default 20, clamp a 50; inválido/no numérico/<1 → 400). findMany orderBy createdAt desc, take limit → 200 {ok:true, matches:[...]}. Excepción → 500.
- Tests curl (dev server puerto 3000, verificado en dev.log):
  - POST válido → 201 {ok:true, match:{id:"cmvea...", ..., createdAt:"2026-10-18T20:30:33.608Z"}} (2 partidos de prueba insertados: Cóndor 3-1 Puma, Real Cumbre 0-2 Volcán; y uno sin difficulty → default "profesional").
  - POST inválidos → todos 400: homeTeam vacío, homeGoals:-1, difficulty:"imposible", possessionHome:150, homeGoals:1.5 (no entero), JSON malformado.
  - GET → 200 con 3 matches ordenados createdAt desc; GET ?limit=1 → 200 (1 match); GET ?limit=999 → 200 (clamp 50); GET ?limit=abc → 400.
- `bun run lint` → sin errores. dev.log sin errores de compilación ni runtime.

Stage Summary:
- Backend del historial operativo y probado: modelo `MatchResult` en SQLite + `POST /api/matches` (201/400/500 con validación zod estricta) + `GET /api/matches?limit=N` (default 20, max 50, orden createdAt desc), sin caching (`force-dynamic`).
- Contrato exacto del worklog respetado; sin tocar src/game/**, src/components/**, page.tsx ni layout.tsx.
- Para el agente de UI (Task 2-b): importar tipos/constantes desde `@/lib/matches` (`MatchResultRecord`, `MatchesGetResponse`, `MATCHES_DEFAULT_LIMIT`); los partidos devueltos traen `events` como string JSON de array de strings y `createdAt` ISO; errores siempre {ok:false, error:string}.

---
Task ID: 2-b, 2-c, 2-d, 2-e, 3, 5, 6
Agent: Z.ai Code (principal)
Task: Motor 3D completo, IA, estadio, renderizador, UI React y verificación E2E

Work Log:
- Instalé three@0.186 + @types/three
- Escribí src/game/: constants.ts (dimensiones FIFA, tuning, formación 4-3-3), types.ts, teams.ts (12 equipos ficticios + plantillas deterministas), audio.ts (WebAudio: silbato, golpes, multitud con excitación, rugido de gol), input.ts (teclado + virtual táctil con edges), ball.ts (física 2.5D con rebotes, palos/travesaño, predicción IA), player.ts (rig procedural de cápsulas con animación de carrera/patada/barrida/estirada), ai.ts (persecución, cobertura, marcaje, apoyos, decisiones del portador, portero con predicción de tiro y atajadas), match.ts (máquina de estados: kickoff/play/goal/restart/half/full; saques de banda, córners, saques de puerta, autogoles, posesión, tiros, narración), stadium.ts (textura de césped con líneas por canvas, tribunas inclinadas, ~3000 espectadores instanciados, torres de luz, vallas LED), renderer3d.ts (3 cámaras: broadcast/aérea/tras el arco, sombras PCF, tone mapping ACES), engine.ts (paso fijo hasta 30 sub-pasos, radar 2D, emisor HUD)
- UI React en src/components/game/: SoccerGame (router de pantallas + settings persistidos), MenuScreen, TeamSelect, HistoryScreen, MatchScreen (HUD broadcast, radar, ticker, barra de potencia rAF, overlays gol/mediempo/pausa/final con stats), TouchControls (joystick + 6 botones)
- page.tsx y layout.tsx actualizados (es-ES, metadatos del juego); globals.css con animaciones propias
- Backend previo (Task 2-a) integrado: POST /api/matches al terminar partido + HistoryScreen con GET
- Correcciones de E2E con Agent Browser: (1) rig hundido → body.position.y=0.95; (2) público generado dentro del campo → z fuera de las líneas; (3) gradas flotantes → rampas inclinadas + muro; (4) rigs nunca añadidos a la escena → scene.add(p.root) en startMatch; (5) simulación lenta con fps bajos → acumulador real + 30 sub-pasos; (6) detección táctil ampliada (maxTouchPoints/innerWidth); (7) etiquetas de dificultad recortadas
- Verificación E2E completa con capturas: menú, selección, partido 3D (22 jugadores visibles, sombras, marcador broadcast, radar, posesión), movimiento por teclado, pausa, 3 cámaras, atajada del portero + saque de puerta, gol con marcador 0-1 y reinicio, mediempo, final 90' con panel de stats, guardado en API confirmado vía curl, revancha, historial con datos, responsive móvil con joystick y botones táctiles
- bun run lint sin errores; dev.log sin errores de runtime

Stage Summary:
- Juego de fútbol 3D profesional completo y funcional en / con historial persistente
- 14/14 flujos E2E verificados en navegador (desktop + móvil)
- Decisión: se descartó el pulido con subagente de styling (Task 4) porque la UI ya pasó verificación visual iterativa en desktop y móvil
- Nota: existe ?demo=1 (partido de 40s) y window.__fp3d (ref de debug) para pruebas E2E

---
Task ID: 7
Agent: Z.ai Code (principal)
Task: Cámara "Cable" (más cerca de los jugadores) + fix de faltas vs saques

Work Log:
- Bug reportado por el usuario: un saque lateral se pitaba como tiro libre. Causa raíz en match.ts: updatePlay() corría checkFouls() ANTES que checkOutOfBounds(), así que si el balón salía por la banda en el mismo frame con contacto de una barrida, ganaba la falta. Fix: (1) reordenado updatePlay → updateBallPossession → checkOutOfBounds → si la fase sigue 'play' recién entonces checkFouls (el balón fuera mata la jugada); (2) guardas nuevas en checkFouls() y awardFoul() que anulan faltas si el balón está fuera del campo (z≤0/z≥W/x≤0/x≥L); (3) corregido código muerto en la barrida limpia: el owner se capturaba después de loseControl() (siempre null) → ahora se captura antes y la barrida limpia puede derribar al rival sin ser falta; (4) el despeje automático sin receptor ahora apunta sesgado al centro ((W/2−z)·0.55 + ruido ±4.5) para no regalar la banda y provocar laterales en cadena.
- Nueva cámara 'cable' (guaya, estilo FIFA clásico): types.ts agrega 'cable' a CameraMode; renderer3d.ts nueva rama que flota sobre el campo siguiendo el balón en X y en Z (cz = bz + 7.8·zoom, clamp a [4, W+3.5]; altura 11.5·zoom con vaivén sinusoidal de guaya ±0.8m), mira con anticipación de velocidad del balón (0.24s) para mantener la jugada centrada; smoothing propio: posición más lenta/pesada (k=2.5) y look más rápido (k2=5.2); respeta el zoom (+/−/rueda: 0.55 = pegadísimo, 1.45 = amplio).
- engine.ts: cycleCamera ahora ciclása broadcast → cable → cerca → aerea → arco; pasa vx/vz del balón a scene3d.update (nuevo campo opcional) para la anticipación.
- MatchScreen.tsx: cameraLabel('cable') = "Cable (muy cerca)" (aparece en el HUD y en el menú de pausa).
- MenuScreen.tsx: ayuda "CÓMO JUGAR" actualizada (menciona la cámara Cable y que el zoom aplica; nueva regla documentada: balón fuera = saque, nunca falta).
- teams.ts: comentario desactualizado corregido (banco de 12 suplentes, no 5).
- Verificación E2E con Agent Browser: menú → partido → V a Cable: encuadre muy cercano de jugadores (toma de lateral vista de cerca con evento "Saque de banda" correcto), seguimiento por todo el campo (esquina, bandas opuestas), zoom + / − funcional en Cable, menú de pausa muestra "Cámara: Cable (muy cerca)", faltas siguen pitándose ("Falta de T. Castro (RCU)" → banner "TIRO LIBRE PARA VOS" con controles de ejecución), sin errores de consola ni runtime.
- bun run lint sin errores; dev.log limpio.

Stage Summary:
- La cámara Cable (V) muestra a los jugadores mucho más cerca que la TV broadcast, siguiendo la jugada en ambos ejes con vaivén de guaya; zoom operativo en todos los modos.
- El arbitraje ya respeta la precedencia reglamentaria: balón fuera → lateral/córner/saque de puerta; las faltas solo se pitan con el balón en juego.
- Banquillo de 12 suplentes y hasta 5 cambios por equipo (confirmado en código y ayuda).

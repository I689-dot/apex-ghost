/**
 * Interface language: English (the source strings) or Spanish. `t()` looks the English text up in the Spanish
 * table and falls back to English, so a missing entry never breaks the UI. `{name}` placeholders are filled from
 * `vars`. Data labels (weather, compounds, controls…) stay English in the data and are translated where shown,
 * so switching language applies to the next thing drawn without a reload.
 */
export type Lang = 'en' | 'es';

export const LANGUAGES: [Lang, string][] = [
  ['en', 'English'],
  ['es', 'Español'],
];

let lang: Lang = 'en';
const missing = new Set<string>();

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** Browser language as the first-run default. */
export function defaultLang(): Lang {
  const n = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? 'en') : 'en';
  return n.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function t(en: string, vars?: Record<string, string | number>): string {
  let s = en;
  if (lang === 'es') {
    const tr = ES[en];
    if (tr !== undefined) s = tr;
    else if (import.meta.env.DEV && !missing.has(en)) {
      missing.add(en);
      console.debug(`[i18n] no Spanish for: ${en}`);
    }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

const ES: Record<string, string> = {
  // main menu
  'Desktop only': 'Solo para ordenador',
  'This is a keyboard sim racer. Open it on a desktop or laptop with Chrome, Edge or Firefox.':
    'Es un simulador de carreras para teclado. Ábrelo en un ordenador de sobremesa o portátil con Chrome, Edge o Firefox.',
  'Cannot start': 'No se puede iniciar',
  'Graphics restored': 'Gráficos restaurados',
  'Your nickname': 'Tu apodo',
  'ROOM CODE': 'CÓDIGO DE SALA',
  'Enter the 5-character room code.': 'Introduce el código de sala de 5 caracteres.',
  Nickname: 'Apodo',
  'Create room': 'Crear sala',
  'Play solo (offline)': 'Jugar solo (sin conexión)',
  'Alone or with AI cars, in this browser: nothing goes through the online server': 'Solo o con coches IA, en este navegador: nada pasa por el servidor online',
  'Solo · offline': 'Solo · sin conexión',
  'or join friends': 'o únete a tus amigos',
  Join: 'Unirse',
  'Online sim racing for friends · Nürburgring · Zandvoort': 'Simulador de carreras online con amigos · Nürburgring · Zandvoort',
  Settings: 'Ajustes',
  'Keyboard: W/S throttle & brake · A/D steer · Space handbrake · Esc menu':
    'Teclado: W/S acelerador y freno · A/D dirección · Espacio freno de mano · Esc menú',
  'Room not found. Check the code with your friend.': 'Sala no encontrada. Comprueba el código con tu amigo.',
  'Room is full ({n} players).': 'La sala está llena ({n} jugadores).',
  'That nickname is already used in this room. Pick another one.': 'Ese apodo ya se usa en esta sala. Elige otro.',
  'A race is in progress. You will join the next one.': 'Hay una carrera en curso. Entrarás en la siguiente.',
  '{owner} already has that car.': '{owner} ya tiene ese coche.',
  'That car is not available.': 'Ese coche no está disponible.',
  'Nickname is required.': 'El apodo es obligatorio.',
  'Nickname must be at least 2 characters.': 'El apodo debe tener al menos 2 caracteres.',
  'Nickname must be at most 16 characters.': 'El apodo debe tener como máximo 16 caracteres.',
  // server messages
  'Room is full (12 players).': 'La sala está llena (12 jugadores).',
  'No free car left for a bot.': 'No queda ningún coche libre para un bot.',
  'Only the host can start the race.': 'Solo el anfitrión puede iniciar la carrera.',
  'Everyone needs a car and must be ready.': 'Todos necesitan un coche y estar listos.',
  'Invalid room code.': 'Código de sala no válido.',

  // lobby: session setup
  'Nürburgring GP': 'Nürburgring GP',
  'Nürburgring GP · Short (no Müllenbachschleife)': 'Nürburgring GP · Corto (sin Müllenbachschleife)',
  'Circuit Zandvoort': 'Circuito de Zandvoort',
  '{weather} from about minute {min}': '{weather} desde el minuto {min} aprox.',
  'Stable conditions': 'Condiciones estables',
  '{name}: grip {dry} % dry / {wet} % wet, wear ×{wear}': '{name}: agarre {dry} % seco / {wet} % mojado, desgaste ×{wear}',
  '{pct} % front': '{pct} % delante',
  'Session · you are the host': 'Sesión · eres el anfitrión',
  Session: 'Sesión',
  Track: 'Circuito',
  Weather: 'Clima',
  Random: 'Aleatorio',
  'Time of day': 'Hora del día',
  'Weather changes': 'Cambios de clima',
  Possible: 'Posibles',
  Stable: 'Estable',
  Changing: 'Cambiante',
  Length: 'Duración',
  '{m} min qualifying': 'Clasificación de {m} min',
  'Forecast: {weather} · {hour} · {state}': 'Previsión: {weather} · {hour} · {state}',
  'wet track': 'pista mojada',
  'damp track': 'pista húmeda',
  'dry track': 'pista seca',
  'New forecast': 'Nueva previsión',
  'Your car': 'Tu coche',
  Tyres: 'Neumáticos',
  'Rear wing': 'Alerón trasero',
  'Brake balance': 'Reparto de frenada',
  'Engineer: {note}.': 'Ingeniero: {note}.',
  'Use {tyre} + {wing} wing': 'Usar {tyre} + alerón {wing}',
  'Low (top speed)': 'Bajo (velocidad punta)',
  'High (cornering grip)': 'Alto (agarre en curva)',
  'Wet start, drying later: wets now, slicks at a pit stop': 'Salida en mojado que se secará: lluvia ahora, slicks en una parada',
  'Wet track: wets and maximum downforce': 'Pista mojada: neumáticos de lluvia y máxima carga aerodinámica',
  'Rain on the way: mediums now, be ready to pit for wets': 'Se acerca la lluvia: medios ahora, prepárate para entrar a por lluvia',
  'Cool air: softs warm up quickly': 'Aire fresco: los blandos se calientan rápido',
  'Dry: mediums for a long run, softs for one fast lap': 'Seco: medios para una tanda larga, blandos para una vuelta rápida',
  // compounds
  Soft: 'Blando',
  Medium: 'Medio',
  Hard: 'Duro',
  Wet: 'Lluvia',
  '{name} tyres': 'Neumáticos {name}',
  'Which tyre?': '¿Qué neumático?',
  'Dry grip': 'Agarre en seco',
  'Wet grip': 'Agarre en mojado',
  Life: 'Duración',
  'Warm-up': 'Calentamiento',
  'Fastest over one lap and warms up quickly, but wears about twice as fast as the Medium.':
    'El más rápido a una vuelta y se calienta enseguida, pero se gasta casi el doble que el Medio.',
  'The all-rounder: good grip that lasts a long run.': 'El polivalente: buen agarre que aguanta una tanda larga.',
  'Lasts the longest, but has the least grip and needs more time to warm up.': 'El que más dura, pero tiene menos agarre y tarda más en calentarse.',
  'For a wet track: the grooves clear the water. On a drying track it overheats and wears fast.':
    'Para pista mojada: los surcos evacuan el agua. Si la pista se seca, se sobrecalienta y se gasta rápido.',
  'Rain or a drying track can change the best choice during the session: you can change tyres in the pit box (pit lane next to the start).':
    'La lluvia o una pista que se seca pueden cambiar la mejor elección durante la sesión: puedes cambiar de neumáticos en el box (pit lane junto a la salida).',
  // weather and time of day
  Clear: 'Despejado',
  Cloudy: 'Nublado',
  Overcast: 'Cubierto',
  'Light rain': 'Lluvia ligera',
  'Heavy rain': 'Lluvia intensa',
  Fog: 'Niebla',
  'Dawn 06:30': 'Amanecer 06:30',
  'Morning 09:30': 'Mañana 09:30',
  'Midday 13:00': 'Mediodía 13:00',
  'Afternoon 16:30': 'Tarde 16:30',
  'Evening 19:45': 'Atardecer 19:45',
  'Night 22:30': 'Noche 22:30',

  // lobby: drivers and cars
  'Room code copied': 'Código de sala copiado',
  HOST: 'ANFITRIÓN',
  BOT: 'BOT',
  'next race': 'próxima carrera',
  READY: 'LISTO',
  OFFLINE: 'DESCONECTADO',
  'Remove this bot': 'Quitar este bot',
  'Taken by {name}': 'Elegido por {name}',
  Power: 'Potencia',
  '{n} hp': '{n} CV',
  Weight: 'Peso',
  Drivetrain: 'Tracción',
  'Top speed': 'Velocidad punta',
  Gears: 'Marchas',
  'Pick a car': 'Elige un coche',
  'Ready ✓': 'Listo ✓',
  Ready: 'Listo',
  'Start race': 'Iniciar carrera',
  'Everyone needs a car and must be ready': 'Todos necesitan un coche y estar listos',
  'Waiting for the host to start': 'Esperando a que el anfitrión inicie',
  'Waiting for everyone to be ready': 'Esperando a que todos estén listos',
  Copy: 'Copiar',
  'Drivers {n}/{max}': 'Pilotos {n}/{max}',
  '+ Add bot': '+ Añadir bot',
  'An AI driver simulated on your computer (they race as ghosts too)': 'Un piloto IA simulado en tu ordenador (también corre como fantasma)',
  Leave: 'Salir',
  BRIEFING: 'BRIEFING',
  Drivers: 'Pilotos',
  'Ready to go': 'Listo para salir',
  'The conditions are final. Set up your car for them; the session loads when everyone is ready.':
    'Las condiciones son definitivas. Prepara tu coche para ellas; la sesión carga cuando todos estén listos.',
  'Tyres, rear wing and brakes are chosen in the briefing, once the host starts: everyone sees the final conditions first.':
    'Neumáticos, alerón y frenos se eligen en el briefing, cuando el anfitrión inicia: todos ven antes las condiciones definitivas.',

  // loading
  'Preparing…': 'Preparando…',
  '{weather} → {later} later': '{weather} → {later} más tarde',
  '{track} · {min}-minute qualifying': '{track} · clasificación de {min} minutos',
  Grid: 'Parrilla',
  'P{slot} of {n}': 'P{slot} de {n}',
  Time: 'Hora',
  Damp: 'Húmeda',
  Dry: 'Seca',
  'Could not load the race: {msg}': 'No se pudo cargar la carrera: {msg}',
  'Starting physics': 'Iniciando la física',
  'Your car is not available.': 'Tu coche no está disponible.',
  'Loading track and cars': 'Cargando circuito y coches',
  'Building the world': 'Construyendo el mundo',
  'Compiling shaders': 'Compilando shaders',
  'Could not load the track ({file}).': 'No se pudo cargar el circuito ({file}).',
  'WebGL 2 is not available. Please use an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.':
    'WebGL 2 no está disponible. Usa Chrome, Edge o Firefox actualizados con la aceleración por hardware activada.',

  // pause, results, errors
  Paused: 'En pausa',
  'The race keeps running.': 'La carrera sigue en marcha.',
  Resume: 'Continuar',
  'Reset to track (+5 s penalty)': 'Volver a la pista (+5 s de penalización)',
  'Leave race': 'Abandonar carrera',
  'no time': 'sin tiempo',
  Classification: 'Clasificación',
  'Ranked by best lap. Penalties are added to the lap: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more).':
    'Ordenado por la mejor vuelta. Las penalizaciones se suman a la vuelta: límites de pista tras 3 avisos (0,5–3 s), volver a la pista (5 s), atajo (5 s o más).',
  Pos: 'Pos',
  Driver: 'Piloto',
  Car: 'Coche',
  'Best lap': 'Mejor vuelta',
  Gap: 'Dif.',
  'Timed laps': 'Vueltas cronometradas',
  'Fastest lap: {nick} · {time}': 'Vuelta rápida: {nick} · {time}',
  'Back to lobby': 'Volver a la sala',
  'Graphics reset': 'Reinicio de gráficos',
  'The graphics driver reset the WebGL context. Trying to recover…': 'El controlador gráfico reinició el contexto WebGL. Intentando recuperarlo…',
  'Reload page': 'Recargar página',
  'Something went wrong': 'Algo salió mal',
  'Back to menu': 'Volver al menú',

  // timing screen
  Timing: 'Tiempos',
  'Best lap counts (penalties included) · release Tab to close': 'Cuenta la mejor vuelta (con penalizaciones) · suelta Tab para cerrar',
  Penalties: 'Penalizaciones',
  PEN: 'PEN',
  PENALTY: 'PENALIZACIÓN',
  'Track limits: +{s} s': 'Límites de pista: +{s} s',
  'Track limits: warning {n} of {max}': 'Límites de pista: aviso {n} de {max}',
  'Off track: no advantage, no penalty': 'Fuera de pista: sin ventaja, sin penalización',
  'Reset: +{s} s penalty': 'Vuelta a la pista: +{s} s de penalización',
  'Shortcut: +{s} s penalty': 'Atajo: +{s} s de penalización',
  '  ·  incl. +{s} s penalties': '  ·  incl. +{s} s de penalización',
  'Last lap': 'Última vuelta',
  Laps: 'Vueltas',
  Status: 'Estado',
  DNF: 'ABANDONO',
  FINISHED: 'TERMINADO',
  'IN PITS': 'EN BOXES',
  'OUT LAP': 'VUELTA DE SALIDA',
  'INVALID LAP': 'VUELTA INVÁLIDA',
  'ON TIMED LAP': 'VUELTA CRONOMETRADA',

  // HUD
  'Tyres and damage': 'Neumáticos y daños',
  'Tyre temperatures (°C; blue cold, green 75–105, red hot), tread worn (dark bar), brake discs (hub dot: blue cold, green ok, orange hot, red fading), fitted compound and damage':
    'Temperatura de neumáticos (°C; azul frío, verde 75–105, rojo caliente), desgaste de la banda (barra oscura), discos de freno (punto: azul frío, verde bien, naranja caliente, rojo fatiga), compuesto montado y daños',
  'TYRES °C · DAMAGE': 'NEUMÁTICOS °C · DAÑOS',
  SLIPSTREAM: 'REBUFO',
  LAP: 'VUELTA',
  OUT: 'SALIDA',
  'WRONG WAY': 'DIRECCIÓN CONTRARIA',
  'Press R to reset to the track': 'Pulsa R para volver a la pista',
  POS: 'POS',
  BEST: 'MEJOR',
  LAST: 'ÚLTIMA',
  INVALID: 'INVÁLIDA',
  PIT: 'BOX',
  'ON LAP': 'EN VUELTA',
  FIN: 'FIN',
  '  ·  YOU': '  ·  TÚ',
  '  ·  AI': '  ·  IA',
  'LIVE · QUALIFYING SESSION': 'EN DIRECTO · SESIÓN DE CLASIFICACIÓN',
  'Enter: skip': 'Enter: saltar',

  // race messages
  '{n} turns': '{n} curvas',
  'Wet track': 'Pista mojada',
  'Damp track': 'Pista húmeda',
  'Dry track': 'Pista seca',
  '{n} drivers': '{n} pilotos',
  '{min}-minute qualifying · best valid lap wins · pit lane open': 'Clasificación de {min} minutos · gana la mejor vuelta válida · pit lane abierto',
  'In the pit lane: stop in the service box or drive to the pit exit': 'En el pit lane: para en el box de servicio o sigue hasta la salida',
  'Reset available again in a moment': 'Podrás volver a la pista en un momento',
  'Reset to the track': 'De vuelta en la pista',
  'Out lap {time} (not timed) · timed lap starts now · Tab: timing':
    'Vuelta de salida {time} (sin cronometrar) · empieza la vuelta cronometrada · Tab: tiempos',
  '  ·  INVALID': '  ·  INVÁLIDA',
  '  ·  FASTEST LAP': '  ·  VUELTA RÁPIDA',
  '  ·  personal best': '  ·  mejor personal',
  'Lap {n}: {time}': 'Vuelta {n}: {time}',
  'CHEQUERED FLAG: session over': 'BANDERA A CUADROS: sesión terminada',
  'CHEQUERED FLAG: finish your lap, it still counts': 'BANDERA A CUADROS: termina tu vuelta, todavía cuenta',
  'SESSION COMPLETE': 'SESIÓN COMPLETADA',
  '{name} has completed the session': '{name} ha completado la sesión',
  'A driver': 'Un piloto',
  'Out lap: bring the tyres up to temperature. Timing starts at the line.': 'Vuelta de salida: calienta los neumáticos. El cronómetro empieza en la línea.',
  'Manual gearbox': 'Cambio manual',
  'Automatic gearbox': 'Cambio automático',
  'Waiting for drivers': 'Esperando a los pilotos',
  'Everyone is loading the race…': 'Todos están cargando la carrera…',
  GO: 'YA',
  'TIME LEFT {clock}': 'TIEMPO RESTANTE {clock}',
  'Qualifying: {min} minutes to set your best lap (clock at the top). Out lap first: warm the tyres, timing starts at the line.':
    'Clasificación: {min} minutos para marcar tu mejor vuelta (reloj arriba). Primero la vuelta de salida: calienta los neumáticos, el cronómetro empieza en la línea.',
  'CHEQUERED FLAG · LAST LAP': 'BANDERA A CUADROS · ÚLTIMA VUELTA',
  'Pit lane · limiter {n} km/h · stop in the yellow box for service': 'Pit lane · limitador {n} km/h · para en el box amarillo para el servicio',
  'Session over': 'Sesión terminada',
  'Out lap: bring the tyres up to temperature': 'Vuelta de salida: calienta los neumáticos',
  'Service complete · GO!': 'Servicio completado · ¡YA!',
  'PIT BOX': 'BOX',
  'PIT LANE · LIMITER {n}': 'PIT LANE · LIMITADOR {n}',
  'PIT SERVICE': 'SERVICIO EN BOXES',
  'STOP HERE · TYRES · REPAIRS': 'PARA AQUÍ · NEUMÁTICOS · REPARACIONES',

  // pit menu
  'Keep the current set': 'Mantener el juego actual',
  Keep: 'Mantener',
  '{pct} % tread': '{pct} % de banda',
  '{pct} damaged': '{pct} dañado',
  'no damage': 'sin daños',
  'Wet track: wet tyres recommended': 'Pista mojada: se recomiendan neumáticos de lluvia',
  'Dry track: wets will overheat and wear fast': 'Pista seca: los de lluvia se sobrecalentarán y gastarán rápido',
  'Track wet': 'Pista mojada',
  'Track damp': 'Pista húmeda',
  'Track dry': 'Pista seca',
  'The session clock keeps running. Your next lap after the pit exit is an out lap.':
    'El reloj de la sesión sigue corriendo. La siguiente vuelta tras la salida de boxes es de salida.',
  'Tyres · fitted: {name}, {pct} tread': 'Neumáticos · montados: {name}, {pct} de banda',
  Repairs: 'Reparaciones',
  'Bodywork & aero': 'Carrocería y aerodinámica',
  Suspension: 'Suspensión',
  Engine: 'Motor',
  'Start service (Enter)': 'Iniciar servicio (Enter)',
  'Leave the box (Esc)': 'Salir del box (Esc)',
  'Stop: {s} s (tyres change while the mechanics repair)': 'Parada: {s} s (se cambian los neumáticos mientras se repara)',
  'Nothing to do: drive on': 'Nada que hacer: sigue',
  SERVICE: 'SERVICIO',
  'GO GO GO!': '¡YA, YA, YA!',

  // settings
  Language: 'Idioma',
  Graphics: 'Gráficos',
  'Quality preset': 'Calidad',
  Low: 'Baja',
  High: 'Alta',
  Ultra: 'Ultra',
  'Resolution scale': 'Escala de resolución',
  'Dynamic resolution': 'Resolución dinámica',
  'Lowers resolution briefly to stay above 45 fps': 'Baja la resolución un momento para mantener más de 45 fps',
  'Field of view': 'Campo de visión',
  'Seat height': 'Altura del asiento',
  'Raise the cockpit camera to see more road': 'Sube la cámara del cockpit para ver más carretera',
  'Seat position': 'Posición del asiento',
  'Forward / back': 'Adelante / atrás',
  'Performance overlay': 'Datos de rendimiento',
  Driving: 'Conducción',
  ABS: 'ABS',
  'Traction control': 'Control de tracción',
  Off: 'Desactivado',
  'Stability control': 'Control de estabilidad',
  'Steering assist': 'Asistencia de dirección',
  'Automatic counter-steer': 'Contravolante automático',
  'Racing line': 'Trazada ideal',
  'Braking zones': 'Zonas de frenada',
  'Full lap': 'Vuelta completa',
  'Red: brake · yellow: lift · green: throttle': 'Rojo: frena · amarillo: levanta · verde: acelera',
  'Best-lap ghost': 'Fantasma de la mejor vuelta',
  'Your best valid lap replayed as a ghost car': 'Tu mejor vuelta válida repetida como coche fantasma',
  'Speed units': 'Unidades de velocidad',
  Sound: 'Sonido',
  'Master volume': 'Volumen general',
  Engines: 'Motores',
  'Your car and the cars around you': 'Tu coche y los coches a tu alrededor',
  Effects: 'Efectos',
  'Tyres, kerbs, wind, impacts, beeps': 'Neumáticos, pianos, viento, golpes, pitidos',
  Ambience: 'Ambiente',
  'Crowd, birds, wind in the trees, thunder': 'Público, pájaros, viento en los árboles, truenos',
  Controls: 'Controles',
  'Click a key to rebind it, then press the new key. Esc cancels.': 'Haz clic en una tecla para cambiarla y pulsa la nueva. Esc cancela.',
  'Reset controls': 'Restablecer controles',
  Close: 'Cerrar',
  Space: 'Espacio',
  // control actions
  Throttle: 'Acelerador',
  'Brake / reverse': 'Freno / marcha atrás',
  'Steer left': 'Girar a la izquierda',
  'Steer right': 'Girar a la derecha',
  Handbrake: 'Freno de mano',
  'Shift up': 'Subir marcha',
  'Shift down': 'Bajar marcha',
  'Reset to track': 'Volver a la pista',
  'Manual / automatic': 'Manual / automático',
  'Look left': 'Mirar a la izquierda',
  'Look right': 'Mirar a la derecha',
  'Look back': 'Mirar atrás',
  'Timing screen (hold)': 'Pantalla de tiempos (mantener)',
  'Pause menu': 'Menú de pausa',
};

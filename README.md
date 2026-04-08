# Visualizador de Topología de Memoria Multiprocesador

Simulador experimental para visualizar el impacto de las arquitecturas de memoria **UMA** y **NUMA** en latencia, tiempo de ejecución y coherencia de caché, con protocolo MSI en tiempo real.

Proyecto Final — Arquitectura de Computadores · UNET

---

## Arquitecturas simuladas

### UMA — Uniform Memory Access
Todos los cores comparten un único bus plano. La latencia es uniforme para cualquier acceso.

```
  [C0]    [C1]    [C2]    [C3]
    |       |       |       |
  ════════════════════════════  SHARED BUS (~100ms)
                  |
            [SHARED MEMORY]
               1 KB total
```

### NUMA — Non-Uniform Memory Access
Los cores se agrupan en nodos con memoria local. Acceder a la memoria de otro nodo es más costoso.

```
┌─────── NODO 0 ───────┐   ←── 200ms ──→   ┌─────── NODO 1 ───────┐
│      [C0]   [C1]     │      (REMOTO)      │      [C2]   [C3]     │
│         LOCAL BUS    │                   │         LOCAL BUS    │
│       [MEM 0] 512B   │                   │       [MEM 1] 512B   │
│        ~20ms local   │                   │        ~20ms local   │
└──────────────────────┘                   └──────────────────────┘
```

---

## Stack tecnológico

| Capa      | Tecnología                          |
|-----------|-------------------------------------|
| Backend   | Python 3.10+ · FastAPI · WebSocket  |
| Frontend  | React 18 · TypeScript · Vite        |
| UI        | Tailwind CSS · Recharts · Lucide    |
| Protocolo | MSI (Modified / Shared / Invalid)   |
| Transporte| WebSocket (20 fps) + REST           |

---

## Estructura del proyecto

```
Multiprocessor-Memory-Viewer/
├── simulator/                  # Backend FastAPI
│   ├── main.py                 # Loop de simulación y WebSocket
│   ├── models.py               # Modelos Pydantic (estado, eventos, stats)
│   ├── requirements.txt
│   └── logic/
│       ├── coherence.py        # Protocolo MSI
│       └── latency.py          # Simulación de latencia acelerada
├── dashboard/                  # Frontend React
│   └── src/
│       └── App.tsx             # Componentes y lógica de visualización
├── SETUP.md                    # Guía de ejecución offline
├── CAMBIOS.md                  # Historial de cambios implementados
└── requirement.md              # Enunciado original del proyecto
```

---

## Funcionalidades

- **Conmutación UMA / NUMA en caliente** — cambia la arquitectura sin detener la simulación; el backend reinicia el estado y ajusta topología, latencias y semántica de nodos automáticamente
- **Protocolo MSI de coherencia de caché** — cada escritura invalida las copias remotas; cada lectura comparte el bloque; el estado de todos los cores se muestra evento a evento
- **Dataset compartido visible** — 16 bloques de los 1024 bytes del dataset, con dirección, valor actual, último core que accedió y tipo de operación (R/W)
- **Log de eventos en tiempo real** — hasta 20 eventos recientes con snapshot completo del estado de caché tras cada operación
- **Estadísticas agregadas** — operaciones totales, lecturas/escrituras, latencia promedio; en NUMA también accesos locales vs. remotos
- **Topología visual diferenciada** — UMA muestra bus único y memoria compartida; NUMA muestra 2 nodos con buses locales, memorias locales y enlace inter-nodo etiquetado
- **Resaltado del core activo** — el último core en operar se resalta en amarillo con animación de escala

---

## Instalación

> Realizar **antes** de la defensa mientras haya internet disponible.

### Backend

```bash
cd simulator
pip install -r requirements.txt
```

### Frontend

```bash
cd dashboard
npm install
```

---

## Ejecución

Abrir **dos terminales** en la raíz del proyecto.

**Terminal 1 — Backend**
```bash
cd simulator
uvicorn main:app --reload
```
Servidor disponible en `http://localhost:8000`

**Terminal 2 — Frontend**
```bash
cd dashboard
npm run dev
```
Interfaz disponible en `http://localhost:5173`

---

## API REST

| Método | Ruta              | Descripción                                      |
|--------|-------------------|--------------------------------------------------|
| GET    | `/state`          | Estado completo de la simulación                 |
| POST   | `/config?arch=`   | Cambia la arquitectura (`UMA` o `NUMA`) y resetea|
| POST   | `/start`          | Inicia el loop de simulación                     |
| POST   | `/stop`           | Detiene el loop de simulación                    |
| WS     | `/ws`             | Stream en tiempo real (20 actualizaciones/seg)   |

---

## Comportamiento de la simulación

En cada ciclo (cada 50ms) el backend:

1. Selecciona un core al azar
2. Selecciona una entrada del dataset al azar
3. Determina el nodo destino según la arquitectura:
   - **UMA** → siempre el nodo compartido (sin remoto, `is_remote = False`)
   - **NUMA** → nodo aleatorio (puede ser local o remoto)
4. Determina el tipo de operación (70% lectura / 30% escritura)
5. Simula la latencia correspondiente y la devuelve para mostrar en UI
6. Aplica el protocolo MSI (`on_read` / `on_write`)
7. Propaga los estados de caché a todos los cores
8. Actualiza métricas del core y el dataset
9. Registra el evento y emite el estado por WebSocket

### Latencias simuladas

| Arquitectura  | Latencia mostrada | Sleep real (×10 acelerado) |
|---------------|-------------------|----------------------------|
| UMA           | ~100ms            | ~10ms                      |
| NUMA local    | ~20ms             | ~2ms                       |
| NUMA remoto   | ~200ms            | ~20ms                      |

---

## Protocolo MSI

| Estado | Nombre   | Descripción                                                  |
|--------|----------|--------------------------------------------------------------|
| M      | Modified | Solo este core tiene la línea; está modificada. Resto en I.  |
| S      | Shared   | Múltiples cores tienen la línea en modo lectura.             |
| I      | Invalid  | El core no tiene la línea; debe buscarla en memoria.         |

**En escritura (`WRITE`):** el core activo pasa a `M`; todos los demás pasan a `I`.  
**En lectura (`READ`):** si algún core tenía `M`, baja a `S`. El core activo pasa a `S`.

---

## Verificación rápida

1. Abrir `http://localhost:5173`
2. El indicador superior debe mostrar **En línea** (verde)
3. Presionar **Iniciar** → los cores muestran latencias en tiempo real
4. Cambiar a **NUMA** → la topología cambia a jerarquía de 2 nodos; el log muestra LOCAL / REMOTO
5. Cambiar de vuelta a **UMA** → topología plana, bus único, sin distinción local/remoto

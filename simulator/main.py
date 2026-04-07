import asyncio
import random
from collections import deque
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ArchType, CacheState, CoreState, MemoryNode, SimulationState,
    DatasetEntry, CoherenceEvent, SimStats
)
from logic.latency import LatencyManager
from logic.coherence import CoherenceManager

app = FastAPI(title="NUMA vs UMA Visualizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constantes de simulación
CORE_COUNT = 4
NODE_COUNT = 2
SHARED_DATASET_SIZE = 1024
DATASET_VISIBLE = 16   # Entradas del dataset mostradas en la UI
MAX_EVENTS = 20        # Historial de eventos de coherencia


class SimulationManager:
    def __init__(self):
        self.arch = ArchType.UMA
        self.is_running = False
        self.cores: List[CoreState] = []
        self.nodes: List[MemoryNode] = []
        self.coherence = CoherenceManager(CORE_COUNT)
        self.dataset: List[DatasetEntry] = []
        self.events: deque = deque(maxlen=MAX_EVENTS)
        self.stats = self._empty_stats()
        self._latency_sum = 0.0
        self._event_counter = 0
        self.reset()

    # ------------------------------------------------------------------
    # Inicialización / Reset
    # ------------------------------------------------------------------

    def reset(self):
        self.is_running = False

        if self.arch == ArchType.UMA:
            # UMA: todos los cores comparten un único bus plano — sin jerarquía de nodos
            self.cores = [
                CoreState(
                    id=i,
                    node_id=0,
                    cache_state=CacheState.INVALID,
                    last_latency=0.0,
                    total_time=0.0,
                )
                for i in range(CORE_COUNT)
            ]
            self.nodes = [
                MemoryNode(
                    id=0,
                    local_cores=list(range(CORE_COUNT)),
                    total_memory=SHARED_DATASET_SIZE,
                )
            ]
        else:
            # NUMA: cores divididos en nodos, cada nodo con su memoria local
            self.cores = [
                CoreState(
                    id=i,
                    node_id=i // (CORE_COUNT // NODE_COUNT),
                    cache_state=CacheState.INVALID,
                    last_latency=0.0,
                    total_time=0.0,
                )
                for i in range(CORE_COUNT)
            ]
            self.nodes = [
                MemoryNode(
                    id=i,
                    local_cores=[
                        j for j in range(CORE_COUNT)
                        if j // (CORE_COUNT // NODE_COUNT) == i
                    ],
                    total_memory=SHARED_DATASET_SIZE // NODE_COUNT,
                )
                for i in range(NODE_COUNT)
            ]

        self.coherence = CoherenceManager(CORE_COUNT)

        # Dataset compartido: 16 direcciones de memoria con valores aleatorios
        self.dataset = [
            DatasetEntry(
                address=i * 64,
                value=random.randint(0, 255),
                last_core=-1,
                access_type="-",
            )
            for i in range(DATASET_VISIBLE)
        ]

        self.events.clear()
        self.stats = self._empty_stats()
        self._latency_sum = 0.0
        self._event_counter = 0

    @staticmethod
    def _empty_stats() -> SimStats:
        return SimStats(
            total_reads=0,
            total_writes=0,
            avg_latency_ms=0.0,
            local_accesses=0,
            remote_accesses=0,
        )

    # ------------------------------------------------------------------
    # Estado serializable
    # ------------------------------------------------------------------

    def get_state(self) -> SimulationState:
        return SimulationState(
            arch=self.arch,
            cores=self.cores,
            nodes=self.nodes,
            shared_dataset_size=SHARED_DATASET_SIZE,
            is_running=self.is_running,
            dataset=list(self.dataset),
            events=list(self.events),   # newest first (appendleft)
            stats=self.stats,
        )

    # ------------------------------------------------------------------
    # Lógica de simulación
    # ------------------------------------------------------------------

    def _update_dataset(self, ds_idx: int, core_id: int, is_write: bool):
        """Actualiza el valor del dataset si es escritura, marca el acceso."""
        entry = self.dataset[ds_idx]
        new_value = random.randint(0, 255) if is_write else entry.value
        self.dataset[ds_idx] = DatasetEntry(
            address=entry.address,
            value=new_value,
            last_core=core_id,
            access_type="W" if is_write else "R",
        )

    def _record_event(
        self, core_id: int, op: str, address: int,
        source_node: int, target_node: int,
        latency_ms: float, is_remote: bool,
    ):
        """Registra un evento MSI con snapshot del estado de caché actual."""
        self._event_counter += 1
        snapshot = {
            str(i): s.value
            for i, s in enumerate(self.coherence.get_states())
        }
        event = CoherenceEvent(
            event_id=self._event_counter,
            core_id=core_id,
            op=op,
            address=address,
            source_node=source_node,
            target_node=target_node,
            latency_ms=round(latency_ms, 2),
            is_remote=is_remote,
            cache_snapshot=snapshot,
        )
        self.events.appendleft(event)   # más reciente al frente

    def _update_stats(self, is_write: bool, latency_ms: float, is_remote: bool):
        if is_write:
            self.stats.total_writes += 1
        else:
            self.stats.total_reads += 1

        self._latency_sum += latency_ms
        total_ops = self.stats.total_reads + self.stats.total_writes
        self.stats.avg_latency_ms = round(self._latency_sum / total_ops, 2)

        if is_remote:
            self.stats.remote_accesses += 1
        else:
            self.stats.local_accesses += 1


manager = SimulationManager()


# ------------------------------------------------------------------
# REST endpoints
# ------------------------------------------------------------------

@app.get("/state")
async def get_state():
    return manager.get_state()


@app.post("/config")
async def set_config(arch: ArchType):
    manager.arch = arch
    manager.reset()
    return manager.get_state()


@app.post("/start")
async def start_sim():
    manager.is_running = True
    return {"status": "started"}


@app.post("/stop")
async def stop_sim():
    manager.is_running = False
    return {"status": "stopped"}


# ------------------------------------------------------------------
# WebSocket — loop de simulación en tiempo real
# ------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            if manager.is_running:
                # 1. Seleccionar core y entrada del dataset al azar
                core_id = random.randint(0, CORE_COUNT - 1)
                core = manager.cores[core_id]
                ds_idx = random.randint(0, DATASET_VISIBLE - 1)
                address = manager.dataset[ds_idx].address

                # 2. Nodo destino:
                #    UMA → siempre el mismo nodo compartido (sin concepto de remoto)
                #    NUMA → puede ser local o remoto según el nodo elegido
                if manager.arch == ArchType.UMA:
                    target_node_id = core.node_id  # siempre 0 en UMA
                else:
                    target_node_id = random.randint(0, NODE_COUNT - 1)
                is_remote = (core.node_id != target_node_id)

                # 3. Tipo de operación: 30% escritura, 70% lectura
                is_write = random.random() < 0.3

                # 4. Simular latencia (sleep acelerado, valor correcto para UI)
                actual_latency = await LatencyManager.simulate_access(
                    manager.arch, core.node_id, target_node_id
                )
                latency_ms = actual_latency * 1000

                # 5. Actualizar protocolo MSI de coherencia
                if is_write:
                    manager.coherence.on_write(core_id)
                    op = "WRITE"
                else:
                    manager.coherence.on_read(core_id)
                    op = "READ"

                # 6. Propagar estados de caché a todos los cores
                states = manager.coherence.get_states()
                for i, s in enumerate(states):
                    manager.cores[i].cache_state = s

                # 7. Actualizar métricas del core activo
                core.last_latency = actual_latency
                core.total_time += actual_latency

                # 8. Actualizar dataset compartido
                manager._update_dataset(ds_idx, core_id, is_write)

                # 9. Registrar evento y estadísticas globales
                manager._record_event(
                    core_id, op, address,
                    core.node_id, target_node_id,
                    latency_ms, is_remote,
                )
                manager._update_stats(is_write, latency_ms, is_remote)

                # 10. Broadcast al cliente conectado
                await websocket.send_json(manager.get_state().dict())

            await asyncio.sleep(0.05)   # 20 actualizaciones/segundo

    except WebSocketDisconnect:
        print("Cliente desconectado")

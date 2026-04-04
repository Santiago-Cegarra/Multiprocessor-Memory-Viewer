import asyncio
import random
from typing import List, Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from models import ArchType, CacheState, CoreState, MemoryNode, SimulationState
from logic.latency import LatencyManager
from logic.coherence import CoherenceManager

app = FastAPI(title="NUMA vs UMA Visualizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simulation state
CORE_COUNT = 4
NODE_COUNT = 2
SHARED_DATASET_SIZE = 1024

class SimulationManager:
    def __init__(self):
        self.arch = ArchType.UMA
        self.is_running = False
        self.cores = []
        self.nodes = []
        self.coherence = CoherenceManager(CORE_COUNT)
        self.reset()

    def reset(self):
        self.is_running = False
        self.cores = [
            CoreState(
                id=i,
                node_id=i // (CORE_COUNT // NODE_COUNT),
                cache_state=CacheState.INVALID,
                last_latency=0.0,
                total_time=0.0
            ) for i in range(CORE_COUNT)
        ]
        self.nodes = [
            MemoryNode(
                id=i,
                local_cores=[j for j in range(CORE_COUNT) if j // (CORE_COUNT // NODE_COUNT) == i],
                total_memory=SHARED_DATASET_SIZE // NODE_COUNT
            ) for i in range(NODE_COUNT)
        ]
        self.coherence = CoherenceManager(CORE_COUNT)

    def get_state(self):
        return SimulationState(
            arch=self.arch,
            cores=self.cores,
            nodes=self.nodes,
            shared_dataset_size=SHARED_DATASET_SIZE,
            is_running=self.is_running
        )

manager = SimulationManager()

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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            if manager.is_running:
                # Pick a random core to do a memory operation
                core_id = random.randint(0, CORE_COUNT - 1)
                core = manager.cores[core_id]
                
                # Pick a target node (randomly, to simulate local vs remote)
                target_node_id = random.randint(0, NODE_COUNT - 1)
                
                # Memory operation: Read (70%) or Write (30%)
                is_write = random.random() < 0.3
                
                # Simulate latency
                actual_latency = await LatencyManager.simulate_access(
                    manager.arch, core.node_id, target_node_id
                )
                
                # Update coherence
                if is_write:
                    new_state = manager.coherence.on_write(core_id)
                else:
                    new_state = manager.coherence.on_read(core_id)
                
                # Update core state
                core.last_latency = actual_latency
                core.total_time += actual_latency
                
                # Update all cores with their current cache state from the coherence manager
                states = manager.coherence.get_states()
                for i, s in enumerate(states):
                    manager.cores[i].cache_state = s

                # Send update to client
                await websocket.send_json(manager.get_state().dict())
            
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        print("Client disconnected")

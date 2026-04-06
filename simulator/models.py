from enum import Enum
from typing import List, Dict, Optional
from pydantic import BaseModel


class ArchType(str, Enum):
    UMA = "UMA"
    NUMA = "NUMA"


class CacheState(str, Enum):
    MODIFIED = "M"
    SHARED = "S"
    INVALID = "I"


class MemoryNode(BaseModel):
    id: int
    local_cores: List[int]
    total_memory: int


class CoreState(BaseModel):
    id: int
    node_id: int
    cache_state: CacheState
    last_latency: float
    total_time: float


class DatasetEntry(BaseModel):
    address: int          # Dirección de memoria (múltiplo de 64)
    value: int            # Valor actual en esa dirección (0-255)
    last_core: int        # Último core que accedió (-1 = nunca)
    access_type: str      # 'R' = lectura, 'W' = escritura, '-' = sin acceso


class CoherenceEvent(BaseModel):
    event_id: int
    core_id: int
    op: str               # 'READ' o 'WRITE'
    address: int
    source_node: int
    target_node: int
    latency_ms: float
    is_remote: bool
    cache_snapshot: Dict[str, str]  # {"0": "M", "1": "I", ...}


class SimStats(BaseModel):
    total_reads: int
    total_writes: int
    avg_latency_ms: float
    local_accesses: int
    remote_accesses: int


class SimulationState(BaseModel):
    arch: ArchType
    cores: List[CoreState]
    nodes: List[MemoryNode]
    shared_dataset_size: int
    is_running: bool
    dataset: List[DatasetEntry]
    events: List[CoherenceEvent]
    stats: SimStats

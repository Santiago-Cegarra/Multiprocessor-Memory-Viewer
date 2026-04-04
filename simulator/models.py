from enum import Enum
from typing import List, Optional
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

class SimulationState(BaseModel):
    arch: ArchType
    cores: List[CoreState]
    nodes: List[MemoryNode]
    shared_dataset_size: int
    is_running: bool

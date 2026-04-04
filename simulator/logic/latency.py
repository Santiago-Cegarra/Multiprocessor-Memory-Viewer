import asyncio
import random
from models import ArchType

class LatencyManager:
    UMA_LATENCY = 0.1  # 100ms
    NUMA_LOCAL_LATENCY = 0.02  # 20ms
    NUMA_REMOTE_LATENCY = 0.2  # 200ms
    JITTER = 0.01

    @classmethod
    async def simulate_access(cls, arch: ArchType, core_node: int, target_node: int):
        """
        Simulates memory access and returns the latency in seconds.
        """
        if arch == ArchType.UMA:
            latency = cls.UMA_LATENCY
        else:
            if core_node == target_node:
                latency = cls.NUMA_LOCAL_LATENCY
            else:
                latency = cls.NUMA_REMOTE_LATENCY
        
        # Add some jitter to make it look realistic
        actual_latency = latency + random.uniform(-cls.JITTER, cls.JITTER)
        await asyncio.sleep(actual_latency)
        return actual_latency

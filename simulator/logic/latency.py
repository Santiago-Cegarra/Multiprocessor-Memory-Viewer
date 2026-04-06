import asyncio
import random
from models import ArchType


class LatencyManager:
    # Valores de latencia SIMULADA en segundos (para mostrar en UI)
    UMA_LATENCY = 0.100       # 100ms uniforme
    NUMA_LOCAL_LATENCY = 0.020  # 20ms acceso local
    NUMA_REMOTE_LATENCY = 0.200  # 200ms acceso remoto
    JITTER = 0.010            # ±10ms de variación

    # Factor de velocidad: la simulación "duerme" N veces menos que la
    # latencia real, para que la visualización sea fluida sin perder
    # los valores correctos en pantalla.
    SPEED_FACTOR = 10

    @classmethod
    async def simulate_access(cls, arch: ArchType, core_node: int, target_node: int) -> float:
        """
        Simula un acceso a memoria. Retorna la latencia en segundos
        (valor correcto para mostrar en la UI). El sleep real es
        SPEED_FACTOR veces menor para que la demo sea ágil.
        """
        if arch == ArchType.UMA:
            latency = cls.UMA_LATENCY
        else:
            if core_node == target_node:
                latency = cls.NUMA_LOCAL_LATENCY
            else:
                latency = cls.NUMA_REMOTE_LATENCY

        actual_latency = latency + random.uniform(-cls.JITTER, cls.JITTER)

        # Sleep acelerado para no bloquear la visualización
        await asyncio.sleep(actual_latency / cls.SPEED_FACTOR)

        return actual_latency

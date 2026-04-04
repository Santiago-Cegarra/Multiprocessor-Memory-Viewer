from typing import Dict, List
from models import CacheState

class CoherenceManager:
    """
    Simulates a basic MSI (Modified, Shared, Invalid) protocol.
    For simplicity, we track state for a 'shared dataset' conceptually as a single block.
    """
    def __init__(self, core_count: int):
        self.states: List[CacheState] = [CacheState.INVALID] * core_count
    
    def on_read(self, core_id: int) -> CacheState:
        """
        If some core has it as Modified, they downgrade to Shared.
        Current core becomes Shared.
        """
        current_state = self.states[core_id]
        if current_state == CacheState.INVALID:
            # Check if any other core has it as Modified
            for i, state in enumerate(self.states):
                if state == CacheState.MODIFIED:
                    self.states[i] = CacheState.SHARED
            self.states[core_id] = CacheState.SHARED
        return self.states[core_id]

    def on_write(self, core_id: int) -> CacheState:
        """
        Current core becomes Modified.
        All other cores become Invalid.
        """
        for i in range(len(self.states)):
            if i == core_id:
                self.states[i] = CacheState.MODIFIED
            else:
                self.states[i] = CacheState.INVALID
        return self.states[core_id]

    def get_states(self) -> List[CacheState]:
        return self.states

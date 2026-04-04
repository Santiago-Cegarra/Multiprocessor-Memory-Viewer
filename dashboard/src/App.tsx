import React, { useState, useEffect, useRef } from 'react';
import { 
  Cpu, 
  Database, 
  Play, 
  Square, 
  Settings2, 
  Activity,
  ArrowRightLeft,
  Circle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';

// Types from our backend models
type CacheState = 'M' | 'S' | 'I';
type ArchType = 'UMA' | 'NUMA';

interface CoreState {
  id: number;
  node_id: number;
  cache_state: CacheState;
  last_latency: number;
  total_time: number;
}

interface MemoryNode {
  id: number;
  local_cores: number[];
  total_memory: number;
}

interface SimulationState {
  arch: ArchType;
  cores: CoreState[];
  nodes: MemoryNode[];
  shared_dataset_size: number;
  is_running: boolean;
}

const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000/ws";

function App() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [arch, setArch] = useState<ArchType>('UMA');
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchState();
    connectWS();
    return () => ws.current?.close();
  }, []);

  const connectWS = () => {
    ws.current = new WebSocket(WS_BASE);
    ws.current.onmessage = (event) => {
      setState(JSON.parse(event.data));
    };
    ws.current.onclose = () => {
      setTimeout(connectWS, 1000); // Reconnect
    };
  };

  const fetchState = async () => {
    const res = await fetch(`${API_BASE}/state`);
    const data = await res.json();
    setState(data);
    setArch(data.arch);
  };

  const toggleArch = async () => {
    const nextArch = arch === 'UMA' ? 'NUMA' : 'UMA';
    const res = await fetch(`${API_BASE}/config?arch=${nextArch}`, { method: 'POST' });
    const data = await res.json();
    setState(data);
    setArch(nextArch);
  };

  const startSim = () => fetch(`${API_BASE}/start`, { method: 'POST' });
  const stopSim = () => fetch(`${API_BASE}/stop`, { method: 'POST' });

  if (!state) return <div className="flex items-center justify-center h-screen bg-slate-900 text-white">Cargando simulador...</div>;

  const getCacheColor = (cache_state: CacheState) => {
    switch (cache_state) {
      case 'M': return 'text-red-500 fill-red-500';
      case 'S': return 'text-blue-500 fill-blue-500';
      case 'I': return 'text-slate-500 fill-slate-500';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <header className="flex justify-between items-center mb-12 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            Visualizador de Topología Memoria
          </h1>
          <p className="text-slate-400 mt-1">Simulación Experimental: UMA vs NUMA</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={toggleArch}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 border transition-all ${
              arch === 'NUMA' ? 'bg-indigo-900/30 border-indigo-500 text-indigo-300' : 'bg-emerald-900/30 border-emerald-500 text-emerald-300'
            }`}
          >
            <Settings2 size={18} />
            Arquitectura: {arch}
          </button>
          {!state.is_running ? (
            <button onClick={startSim} className="bg-emerald-600 hover:bg-emerald-500 px-6 py-2 rounded-lg flex items-center gap-2 font-bold transition-all shadow-lg shadow-emerald-900/20">
              <Play size={18} /> Iniciar
            </button>
          ) : (
            <button onClick={stopSim} className="bg-red-600 hover:bg-red-500 px-6 py-2 rounded-lg flex items-center gap-2 font-bold transition-all shadow-lg shadow-red-900/20">
              <Square size={18} /> Detener
            </button>
          )}
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Topology Map */}
        <section className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl">
          <h2 className="text-xl font-semibold mb-8 flex items-center gap-2">
            <Activity className="text-blue-400" size={20} />
            Mapa de Topología
          </h2>
          
          <div className="flex flex-col gap-12">
            {state.nodes.map((node, nodeIdx) => (
              <div key={node.id} className="relative p-6 border-2 border-dashed border-slate-700 rounded-2xl bg-slate-900/30">
                <div className="absolute -top-3 left-6 bg-slate-950 px-3 text-sm font-mono text-slate-400 flex items-center gap-2">
                  <Database size={14} /> NODO {node.id} (Memoria)
                </div>
                
                <div className="grid grid-cols-2 gap-8">
                  {node.local_cores.map(coreId => {
                    const core = state.cores[coreId];
                    return (
                      <div key={coreId} className="bg-slate-800/80 border border-slate-700 p-4 rounded-xl flex flex-col items-center gap-3 transition-transform hover:scale-105">
                        <Cpu className={getCacheColor(core.cache_state)} size={32} />
                        <div className="text-center">
                          <div className="text-xs text-slate-500 font-mono">CORE {core.id}</div>
                          <div className="text-sm font-bold flex items-center gap-1 justify-center">
                            Cache: <span className={getCacheColor(core.cache_state)}>{core.cache_state}</span>
                          </div>
                        </div>
                        <div className="w-full h-1 bg-slate-700 rounded-full mt-2 overflow-hidden">
                           <div 
                            className="h-full bg-blue-500 transition-all duration-300" 
                            style={{ width: `${Math.min((core.last_latency / 0.2) * 100, 100)}%` }}
                           />
                        </div>
                        <div className="text-[10px] text-slate-500">Lat: {(core.last_latency * 1000).toFixed(1)}ms</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-8 flex justify-center items-center gap-6 text-xs text-slate-500 border-t border-slate-800 pt-6">
             <div className="flex items-center gap-2"><Circle size={10} className="fill-red-500 text-red-500" /> Modified</div>
             <div className="flex items-center gap-2"><Circle size={10} className="fill-blue-500 text-blue-500" /> Shared</div>
             <div className="flex items-center gap-2"><Circle size={10} className="fill-slate-500 text-slate-500" /> Invalid</div>
          </div>
        </section>

        {/* Metrics Panel */}
        <section className="flex flex-col gap-8">
          <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl flex-1">
            <h2 className="text-xl font-semibold mb-8 flex items-center gap-2">
              <BarChart size={20} className="text-emerald-400" />
              Latencia por Core (ms)
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={state.cores}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis 
                    dataKey="id" 
                    stroke="#94a3b8" 
                    tickFormatter={(val) => `C${val}`}
                  />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                    itemStyle={{ color: '#f8fafc' }}
                    formatter={(val: number) => (val * 1000).toFixed(2) + 'ms'}
                  />
                  <Bar dataKey="last_latency">
                    {state.cores.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.last_latency > 0.15 ? '#f43f5e' : '#10b981'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl flex-1">
            <h2 className="text-xl font-semibold mb-8 flex items-center gap-2">
              <ArrowRightLeft size={20} className="text-purple-400" />
              Impacto Total (Tiempo Ejecución)
            </h2>
            <div className="h-64">
               <ResponsiveContainer width="100%" height="100%">
                <BarChart data={state.cores} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={true} horizontal={false}/>
                  <XAxis type="number" stroke="#94a3b8" />
                  <YAxis 
                    dataKey="id" 
                    type="category" 
                    stroke="#94a3b8" 
                    tickFormatter={(val) => `C${val}`}
                  />
                  <Tooltip 
                     contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                     formatter={(val: number) => val.toFixed(2) + 's'}
                  />
                  <Bar dataKey="total_time" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </main>
      
      <footer className="mt-12 text-center text-slate-500 text-sm">
        Simulador de Jerarquía de Memoria | Arquitectura de Computadores
      </footer>
    </div>
  );
}

export default App;

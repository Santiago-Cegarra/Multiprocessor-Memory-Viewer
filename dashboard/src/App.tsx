import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  Database,
  Play,
  Square,
  Settings2,
  Activity,
  ArrowRightLeft,
  Circle,
  BookOpen,
  BarChart2,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// ─── Tipos que reflejan los modelos del backend ───────────────────────────────

type CacheState = 'M' | 'S' | 'I';
type ArchType = 'UMA' | 'NUMA';

interface CoreState {
  id: number;
  node_id: number;
  cache_state: CacheState;
  last_latency: number;   // segundos
  total_time: number;     // segundos acumulados
}

interface MemoryNode {
  id: number;
  local_cores: number[];
  total_memory: number;
}

interface DatasetEntry {
  address: number;
  value: number;
  last_core: number;   // -1 = nunca accedido
  access_type: string; // 'R', 'W', '-'
}

interface CoherenceEvent {
  event_id: number;
  core_id: number;
  op: string;
  address: number;
  source_node: number;
  target_node: number;
  latency_ms: number;
  is_remote: boolean;
  cache_snapshot: Record<string, string>;
}

interface SimStats {
  total_reads: number;
  total_writes: number;
  avg_latency_ms: number;
  local_accesses: number;
  remote_accesses: number;
}

interface SimulationState {
  arch: ArchType;
  cores: CoreState[];
  nodes: MemoryNode[];
  shared_dataset_size: number;
  is_running: boolean;
  dataset: DatasetEntry[];
  events: CoherenceEvent[];
  stats: SimStats;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8000';
const WS_BASE = 'ws://localhost:8000/ws';

const CACHE_COLOR: Record<CacheState, { text: string; bg: string; dot: string }> = {
  M: { text: 'text-red-400', bg: 'bg-red-900/40', dot: 'fill-red-400 text-red-400' },
  S: { text: 'text-blue-400', bg: 'bg-blue-900/40', dot: 'fill-blue-400 text-blue-400' },
  I: { text: 'text-slate-500', bg: 'bg-slate-800/60', dot: 'fill-slate-500 text-slate-500' },
};

const CACHE_LABEL: Record<CacheState, string> = {
  M: 'Modified',
  S: 'Shared',
  I: 'Invalid',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtMs = (s: number) => (s * 1000).toFixed(1) + 'ms';
const fmtAddr = (addr: number) => '0x' + addr.toString(16).padStart(4, '0').toUpperCase();
const fmtHex = (v: number) => '0x' + v.toString(16).padStart(2, '0').toUpperCase();

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function CoreCard({ core, active }: { core: CoreState; active: boolean }) {
  const c = CACHE_COLOR[core.cache_state];
  return (
    <div
      className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300
        ${active
          ? 'border-yellow-400 bg-yellow-900/20 shadow-lg shadow-yellow-900/30 scale-105'
          : `border-slate-700 ${c.bg}`
        }`}
    >
      <Cpu className={c.text} size={26} />
      <div className="text-center leading-tight">
        <div className="text-xs text-slate-400 font-mono">C{core.id}</div>
        <div className={`text-xs font-bold ${c.text}`}>{core.cache_state}</div>
      </div>
      {/* Barra de latencia */}
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${core.last_latency * 1000 > 150 ? 'bg-red-400' : 'bg-emerald-400'
            }`}
          style={{ width: `${Math.min((core.last_latency / 0.2) * 100, 100)}%` }}
        />
      </div>
      <div className="text-[10px] text-slate-500 font-mono">{fmtMs(core.last_latency)}</div>
    </div>
  );
}

// ─── Topología UMA (bus compartido plano) ────────────────────────────────────

function UMATopology({ cores, lastCoreId }: { cores: CoreState[]; lastCoreId: number }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-xs text-slate-400 font-mono uppercase tracking-widest mb-1">
        Latencia Uniforme — 100ms
      </div>

      {/* Cores en fila */}
      <div className="grid grid-cols-4 gap-3 w-full">
        {cores.map(core => (
          <CoreCard key={core.id} core={core} active={core.id === lastCoreId} />
        ))}
      </div>

      {/* Bus compartido */}
      <div className="flex flex-col items-center w-full gap-0">
        <div className="flex w-full justify-around">
          {cores.map(c => (
            <div key={c.id} className="flex flex-col items-center">
              <div className="w-px h-5 bg-slate-500" />
            </div>
          ))}
        </div>
        <div className="w-full h-3 bg-gradient-to-r from-emerald-800 via-emerald-600 to-emerald-800
          border border-emerald-500 rounded flex items-center justify-center">
          <span className="text-[9px] text-emerald-200 font-bold tracking-widest">SHARED BUS</span>
        </div>
        <div className="w-px h-5 bg-slate-500" />
      </div>

      {/* Memoria compartida */}
      <div className="flex flex-col items-center gap-1 p-3 border border-emerald-700 rounded-xl
        bg-emerald-900/20 w-40">
        <Database className="text-emerald-400" size={20} />
        <div className="text-xs text-emerald-300 font-mono text-center">MEMORIA</div>
        <div className="text-[10px] text-slate-400">512 KB × 2 Nodos</div>
      </div>
    </div>
  );
}

// ─── Topología NUMA (jerarquía con enlace inter-nodo) ────────────────────────

function NUMATopology({
  cores, nodes, lastCoreId,
}: {
  cores: CoreState[];
  nodes: MemoryNode[];
  lastCoreId: number;
}) {
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="text-xs text-slate-400 font-mono uppercase tracking-widest mb-1">
        Local: 20ms — Remoto: 200ms
      </div>

      {/* Dos nodos en fila */}
      <div className="flex items-center gap-0 w-full">
        {nodes.map((node, ni) => (
          <React.Fragment key={node.id}>
            {/* Nodo */}
            <div className={`flex-1 p-3 rounded-2xl border-2 border-dashed
              ${ni === 0 ? 'border-indigo-600 bg-indigo-950/30' : 'border-purple-600 bg-purple-950/30'}`}>

              <div className={`text-[10px] font-bold font-mono mb-2 text-center
                ${ni === 0 ? 'text-indigo-400' : 'text-purple-400'}`}>
                NODO {node.id}
              </div>

              {/* Cores del nodo */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {node.local_cores.map(cid => (
                  <CoreCard key={cid} core={cores[cid]} active={cid === lastCoreId} />
                ))}
              </div>

              {/* Línea vertical al bus local */}
              <div className="flex justify-center">
                <div className="w-px h-4 bg-slate-500" />
              </div>

              {/* Bus local */}
              <div className={`h-2 w-full rounded
                ${ni === 0 ? 'bg-indigo-700' : 'bg-purple-700'}
                flex items-center justify-center mb-1`}>
                <span className="text-[8px] text-white font-bold">LOCAL BUS</span>
              </div>
              <div className="flex justify-center">
                <div className="w-px h-3 bg-slate-500" />
              </div>

              {/* Memoria local del nodo */}
              <div className={`flex items-center gap-2 p-2 rounded-lg border justify-center
                ${ni === 0
                  ? 'border-indigo-700 bg-indigo-900/30'
                  : 'border-purple-700 bg-purple-900/30'}`}>
                <Database className={ni === 0 ? 'text-indigo-400' : 'text-purple-400'} size={14} />
                <div>
                  <div className={`text-[9px] font-mono font-bold
                    ${ni === 0 ? 'text-indigo-300' : 'text-purple-300'}`}>
                    MEM {node.id}
                  </div>
                  <div className="text-[9px] text-slate-400">{node.total_memory / 1024}KB</div>
                </div>
              </div>
            </div>

            {/* Enlace inter-nodo (entre los dos nodos) */}
            {ni === 0 && (
              <div className="flex flex-col items-center px-1 shrink-0">
                <div className="text-[9px] text-orange-400 font-mono text-center whitespace-nowrap mb-1">
                  200ms
                </div>
                <div className="flex items-center gap-0.5">
                  <div className="w-5 h-px bg-orange-500" />
                  <ArrowRightLeft size={14} className="text-orange-400 shrink-0" />
                  <div className="w-5 h-px bg-orange-500" />
                </div>
                <div className="text-[9px] text-orange-400 font-mono text-center whitespace-nowrap mt-1">
                  REMOTO
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── Panel Dataset Compartido ─────────────────────────────────────────────────

function DatasetPanel({
  dataset,
  lastAddress,
}: {
  dataset: DatasetEntry[];
  lastAddress: number;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <Database className="text-cyan-400" size={17} />
        Dataset Compartido
        <span className="ml-auto text-xs text-slate-500 font-mono">1024 bytes · 16 bloques visibles</span>
      </h2>

      <div className="overflow-auto max-h-52">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left pb-1 pr-3">Dirección</th>
              <th className="text-left pb-1 pr-3">Valor</th>
              <th className="text-left pb-1 pr-3">Core</th>
              <th className="text-left pb-1 pr-3">Op</th>
            </tr>
          </thead>
          <tbody>
            {dataset.map((entry) => {
              const isActive = entry.address === lastAddress;
              return (
                <tr
                  key={entry.address}
                  className={`border-b border-slate-800/60 transition-colors duration-300 ${isActive ? 'bg-yellow-900/30' : 'hover:bg-slate-800/30'
                    }`}
                >
                  <td className={`py-0.5 pr-3 ${isActive ? 'text-yellow-300' : 'text-slate-300'}`}>
                    {fmtAddr(entry.address)}
                  </td>
                  <td className="pr-3 text-cyan-300">{fmtHex(entry.value)}</td>
                  <td className="pr-3 text-slate-300">
                    {entry.last_core === -1 ? '—' : `C${entry.last_core}`}
                  </td>
                  <td className="pr-3">
                    {entry.access_type === 'W' ? (
                      <span className="text-orange-400 font-bold">W</span>
                    ) : entry.access_type === 'R' ? (
                      <span className="text-emerald-400">R</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Log de Eventos de Coherencia ────────────────────────────────────────────

function EventLog({ events }: { events: CoherenceEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <BookOpen className="text-violet-400" size={17} />
          Log de Eventos MSI
        </h2>
        <p className="text-slate-600 text-sm text-center py-4">
          Inicia la simulación para ver eventos de coherencia...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <BookOpen className="text-violet-400" size={17} />
        Log de Eventos MSI
        <span className="ml-auto text-xs text-slate-500 font-mono">últimos {events.length} eventos</span>
      </h2>

      <div className="overflow-auto max-h-52">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800 text-left">
              <th className="pb-1 pr-2">#</th>
              <th className="pb-1 pr-2">Core</th>
              <th className="pb-1 pr-2">Op</th>
              <th className="pb-1 pr-2">Dirección</th>
              <th className="pb-1 pr-2">Nodo</th>
              <th className="pb-1 pr-2">Latencia</th>
              <th className="pb-1 pr-2">Tipo</th>
              <th className="pb-1">Estado Caché</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, idx) => (
              <tr
                key={ev.event_id}
                className={`border-b border-slate-800/40 ${idx === 0 ? 'bg-violet-900/20' : ''
                  }`}
              >
                <td className="py-0.5 pr-2 text-slate-600">{ev.event_id}</td>
                <td className="pr-2 text-yellow-300">C{ev.core_id}</td>
                <td className="pr-2">
                  {ev.op === 'WRITE'
                    ? <span className="text-orange-400 font-bold">WRITE</span>
                    : <span className="text-emerald-400">READ </span>}
                </td>
                <td className="pr-2 text-slate-300">{fmtAddr(ev.address)}</td>
                <td className="pr-2 text-slate-400">
                  N{ev.source_node}→N{ev.target_node}
                </td>
                <td className={`pr-2 font-bold ${ev.latency_ms > 150 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {ev.latency_ms.toFixed(1)}ms
                </td>
                <td className="pr-2">
                  {ev.is_remote
                    ? <span className="text-orange-400">REMOTO</span>
                    : <span className="text-emerald-500">LOCAL </span>}
                </td>
                <td className="text-slate-400">
                  {Object.entries(ev.cache_snapshot)
                    .map(([cid, st]) => (
                      <span
                        key={cid}
                        className={
                          st === 'M' ? 'text-red-400' :
                            st === 'S' ? 'text-blue-400' :
                              'text-slate-600'
                        }
                      >
                        C{cid}:{st}{' '}
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Barra de Estadísticas ────────────────────────────────────────────────────

function StatsBar({ stats, arch }: { stats: SimStats; arch: ArchType }) {
  const totalOps = stats.total_reads + stats.total_writes;
  const readPct = totalOps > 0 ? Math.round((stats.total_reads / totalOps) * 100) : 0;
  const writePct = totalOps > 0 ? Math.round((stats.total_writes / totalOps) * 100) : 0;

  const cards = [
    {
      label: 'Operaciones',
      value: totalOps.toString(),
      sub: `${readPct}% R / ${writePct}% W`,
      color: 'text-slate-200',
      border: 'border-slate-700',
    },
    {
      label: 'Lecturas',
      value: stats.total_reads.toString(),
      sub: 'total reads',
      color: 'text-emerald-400',
      border: 'border-emerald-800',
    },
    {
      label: 'Escrituras',
      value: stats.total_writes.toString(),
      sub: 'total writes',
      color: 'text-orange-400',
      border: 'border-orange-800',
    },
    {
      label: 'Lat. Promedio',
      value: stats.avg_latency_ms.toFixed(1) + 'ms',
      sub: arch === 'UMA' ? '~100ms esperado' : 'local 20 / rem 200',
      color: stats.avg_latency_ms > 100 ? 'text-red-400' : 'text-blue-400',
      border: 'border-blue-800',
    },
    {
      label: 'Accesos Locales',
      value: stats.local_accesses.toString(),
      sub: arch === 'NUMA' ? '20ms por acceso' : 'N/A en UMA',
      color: 'text-indigo-400',
      border: 'border-indigo-800',
    },
    {
      label: 'Accesos Remotos',
      value: stats.remote_accesses.toString(),
      sub: arch === 'NUMA' ? '200ms por acceso' : 'N/A en UMA',
      color: 'text-rose-400',
      border: 'border-rose-800',
    },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 px-6 pb-4">
      {cards.map(c => (
        <div key={c.label}
          className={`bg-slate-900/60 border ${c.border} rounded-xl p-3 text-center`}>
          <div className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</div>
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{c.label}</div>
          <div className="text-[9px] text-slate-600 mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── App principal ────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [arch, setArch] = useState<ArchType>('UMA');
  const [connected, setConnected] = useState(false);
  const [lastCoreId, setLastCoreId] = useState<number>(-1);
  const [lastAddress, setLastAddress] = useState<number>(-1);
  const ws = useRef<WebSocket | null>(null);

  const connectWS = () => {
    ws.current = new WebSocket(WS_BASE);

    ws.current.onopen = () => setConnected(true);

    ws.current.onmessage = (event) => {
      const data: SimulationState = JSON.parse(event.data);
      setState(data);
      // Rastrear el último core y dirección activos para resaltar
      if (data.events.length > 0) {
        const latest = data.events[0];
        setLastCoreId(latest.core_id);
        setLastAddress(latest.address);
      }
    };

    ws.current.onclose = () => {
      setConnected(false);
      setTimeout(connectWS, 1000);
    };

    ws.current.onerror = () => {
      ws.current?.close();
    };
  };

  const fetchState = async () => {
    try {
      const res = await fetch(`${API_BASE}/state`);
      const data = await res.json();
      setState(data);
      setArch(data.arch);
    } catch {
      // Backend no disponible todavía
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchState();
    connectWS();
    return () => ws.current?.close();
  }, []);



  const toggleArch = async () => {
    const nextArch: ArchType = arch === 'UMA' ? 'NUMA' : 'UMA';
    try {
      const res = await fetch(`${API_BASE}/config?arch=${nextArch}`, { method: 'POST' });
      const data = await res.json();
      setState(data);
      setArch(nextArch);
      setLastCoreId(-1);
      setLastAddress(-1);
    } catch { /* ignorar */ }
  };

  const startSim = () => fetch(`${API_BASE}/start`, { method: 'POST' }).catch(() => { });
  const stopSim = () => fetch(`${API_BASE}/stop`, { method: 'POST' }).catch(() => { });

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-white gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-400" />
        <div className="text-slate-400">Conectando al simulador en localhost:8000...</div>
      </div>
    );
  }

  // Datos para los gráficos de barras
  const latencyChartData = state.cores.map(c => ({
    name: `C${c.id}`,
    latency: parseFloat((c.last_latency * 1000).toFixed(2)),
  }));
  const totalTimeChartData = state.cores.map(c => ({
    name: `C${c.id}`,
    total: parseFloat(c.total_time.toFixed(3)),
  }));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">

      {/* ── Header ── */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            Visualizador Memoria Multiprocesador
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Simulación Experimental: UMA vs NUMA · Protocolo MSI</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Indicador de conexión */}
          <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
            {connected
              ? <><Wifi size={14} /> En línea</>
              : <><WifiOff size={14} /> Reconectando...</>}
          </div>

          {/* Toggle de arquitectura */}
          <button
            onClick={toggleArch}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 border transition-all text-sm font-semibold ${arch === 'NUMA'
              ? 'bg-indigo-900/40 border-indigo-500 text-indigo-300'
              : 'bg-emerald-900/40 border-emerald-500 text-emerald-300'
              }`}
          >
            <Settings2 size={16} />
            {arch}
          </button>

          {/* Start / Stop */}
          {!state.is_running ? (
            <button
              onClick={startSim}
              className="bg-emerald-600 hover:bg-emerald-500 px-5 py-2 rounded-lg flex items-center gap-2 font-bold transition-all shadow-lg shadow-emerald-900/30 text-sm"
            >
              <Play size={16} /> Iniciar
            </button>
          ) : (
            <button
              onClick={stopSim}
              className="bg-red-600 hover:bg-red-500 px-5 py-2 rounded-lg flex items-center gap-2 font-bold transition-all shadow-lg shadow-red-900/30 text-sm"
            >
              <Square size={16} /> Detener
            </button>
          )}
        </div>
      </header>

      {/* ── Barra de estadísticas ── */}
      <div className="pt-4">
        <StatsBar stats={state.stats} arch={arch} />
      </div>

      {/* ── Contenido principal ── */}
      <main className="grid grid-cols-1 xl:grid-cols-5 gap-5 px-6 pb-5">

        {/* Topología (col-span-2) */}
        <section className="xl:col-span-2 bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Activity className="text-blue-400" size={17} />
            Topología — {arch}
          </h2>

          {arch === 'UMA' ? (
            <UMATopology cores={state.cores} lastCoreId={lastCoreId} />
          ) : (
            <NUMATopology cores={state.cores} nodes={state.nodes} lastCoreId={lastCoreId} />
          )}

          {/* Leyenda MSI */}
          <div className="mt-5 pt-4 border-t border-slate-800 flex justify-center gap-5 text-xs text-slate-400">
            {(['M', 'S', 'I'] as CacheState[]).map(s => (
              <div key={s} className="flex items-center gap-1.5">
                <Circle size={9} className={CACHE_COLOR[s].dot} />
                <span className={CACHE_COLOR[s].text}>{s}</span>
                <span>— {CACHE_LABEL[s]}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Columna derecha (col-span-3): Dataset + Charts */}
        <div className="xl:col-span-3 flex flex-col gap-5">

          {/* Dataset compartido */}
          <DatasetPanel dataset={state.dataset} lastAddress={lastAddress} />

          {/* Gráficos de métricas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Latencia por Core */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart2 className="text-emerald-400" size={15} />
                Latencia por Core
              </h2>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={latencyChartData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} unit="ms" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                      itemStyle={{ color: '#f8fafc' }}
                      formatter={(v) => [Number(v).toFixed(1) + 'ms', 'Latencia']}
                    />
                    <Bar dataKey="latency" radius={[4, 4, 0, 0]}>
                      {latencyChartData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.latency > 150 ? '#f43f5e' : '#10b981'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tiempo total acumulado */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="text-purple-400" size={15} />
                Tiempo Total Acumulado
              </h2>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={totalTimeChartData} layout="vertical" barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 10 }} unit="s" />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 11 }} width={24} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                      formatter={(v) => [Number(v).toFixed(3) + 's', 'Total']}
                    />
                    <Bar dataKey="total" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Log de Eventos MSI (ancho completo) ── */}
      <div className="px-6 pb-8">
        <EventLog events={state.events} />
      </div>

      <footer className="text-center text-slate-600 text-xs pb-4">
        Simulador Jerarquía de Memoria · Arquitectura de Computadores · UNET
      </footer>
    </div>
  );
}

export default App;

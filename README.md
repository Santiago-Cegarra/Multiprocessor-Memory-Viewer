# Visualizador de Topología Memoria (UMA vs NUMA)

Este proyecto es un simulador experimental para visualizar el impacto de las arquitecturas de memoria en la latencia, el tiempo de ejecución y la coherencia de caché.

## Requisitos
- Python 3.10+
- Node.js & npm

## Estructura
- `/simulator`: Backend en FastAPI que gestiona la lógica de latencia y coherencia MSI.
- `/dashboard`: Frontend en React que visualiza la topología y métricas en tiempo real.

## Cómo ejecutar

### 1. Iniciar el Simulador (Backend)
Desde la raíz del proyecto:
```powershell
cd simulator
.\venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload
```
El servidor correrá en `http://localhost:8000`.

### 2. Iniciar el Dashboard (Frontend)
Desde la raíz del proyecto en otra terminal:
```powershell
cd dashboard
npm run dev
```
La interfaz estará disponible en `http://localhost:5173`.

## Funcionalidades
- **Conmutación UMA/NUMA:** Observa cómo la latencia cambia de uniforme (UMA) a diferenciada (Local vs Remoto en NUMA).
- **Protocolo MSI:** Visualiza los estados de caché (Modified, Shared, Invalid) mientras los cores acceden al dataset.
- **Métricas en Tiempo Real:** Gráficos de latencia instantánea e impacto acumulado en el tiempo de ejecución.

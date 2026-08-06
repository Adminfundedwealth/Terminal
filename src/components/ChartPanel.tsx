import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode } from 'lightweight-charts';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getHistoricalData } from '@/services/api';
import { cn, timeframeToLabel, formatPrice } from '@/utils/helpers';
import type { ChartType, Timeframe, OHLC } from '@/types';
import { Maximize2 } from 'lucide-react';
import { IndicatorPanel, DEFAULT_INDICATORS, type IndicatorConfig, type IndicatorType } from './IndicatorPanel';
import { type DrawingMode } from './DrawingTools';
import { ChartDrawingToolbar, DrawingToolbarToggle } from './ChartDrawingToolbar';
import { DrawingLayersPanel } from './DrawingLayersPanel';
import { EmojiMarkerPicker } from './EmojiMarkerPicker';
import {
  calculateSMA, calculateEMA, calculateRSI, calculateMACD, calculateBollinger,
  calculateVWAP, extractVolume, calculateATR, calculateStochastic, calculateStochRSI,
  calculateSuperTrend, calculateParabolicSAR, calculateADX, calculateCCI, calculateIchimoku,
  calculatePivots, calculateWilliamsR, calculateStdDev, calculateDEMA, calculateTEMA,
  calculateAO, calculateMomentum, calculateROC, calculateKeltner, calculateDonchian,
  calculateEnvelopes, calculateHMA, calculateTRIX, calculateUltimateOscillator,
  calculatePriceOscillator, calculateHistoricalVolatility, calculateMassIndex, calculateVortex,
  calculateAroon, calculateCMO, calculateChoppiness, calculateDPO, calculateFisher,
  calculateConnorsRSI, calculateCoppock, calculateLinearRegression, calculateMcGinley,
  calculateBOP, calculateTypicalPrice, calculateMedianPrice, calculateAveragePrice,
  calculateRVI, calculateLSMA,
} from '@/utils/indicators';

const TIMEFRAMES: Timeframe[] = ['1', '3', '5', '15', '30', '60', '240', 'D', 'W'];
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'candlestick', label: 'Candle' },
  { value: 'hollow', label: 'Hollow' },
  { value: 'heikin-ashi', label: 'HA' },
  { value: 'area', label: 'Area' },
  { value: 'line', label: 'Line' },
];

// Drawing storage helper
function getDrawingsKey(token: string) { return `fw_drawings_${token}`; }
function loadDrawings(token: string): any[] {
  try { return JSON.parse(localStorage.getItem(getDrawingsKey(token)) || '[]'); } catch { return []; }
}
function saveDrawings(token: string, drawings: any[]) {
  localStorage.setItem(getDrawingsKey(token), JSON.stringify(drawings));
}

export function ChartPanel() {
  const { activeSymbol, timeframe, setTimeframe, chartType, setChartType } = useAppStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());
  // Generic sub-chart map: indicatorId → IChartApi
  const subChartsRef = useRef<Map<string, IChartApi>>(new Map());
  // Container refs for sub-charts — keyed by indicatorId
  const subChartContainersRef = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Permanent in-chart volume histogram (always visible, like TradingView)
  const volumeSeriesRef = useRef<any>(null);

  // Legacy fixed refs kept for layout (RSI, MACD sub-chart containers)
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const rawDataRef = useRef<OHLC[]>([]);
  const liveBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number; volume: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [noData, setNoData] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(DEFAULT_INDICATORS);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('none');
  const [drawings, setDrawings] = useState<any[]>([]);
  const drawClicksRef = useRef<{ time: number; price: number }[]>([]);
  const priceLineSeriesRef = useRef<any[]>([]);

  // New toggle states for tools 5-8
  const [magnetActive, setMagnetActive] = useState(false);
  const [lockActive, setLockActive] = useState(false);
  const [eyeHidden, setEyeHidden] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);

  // Brush / Measure SVG overlay state
  const [brushPaths, setBrushPaths] = useState<{ id: number; points: string; color: string; hidden?: boolean }[]>([]);
  const [measureLabel, setMeasureLabel] = useState<{ x: number; y: number; text: string } | null>(null);

  // Emoji picker state
  const [emojiPicker, setEmojiPicker] = useState<{ screenX: number; screenY: number; chartPoint: { time: number; price: number } } | null>(null);

  // Highlighted drawing id (from Layers panel)
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  // Right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; drawingId: number } | null>(null);

  // Stable ref for clearLastDrawing — needed by keyboard handler registered at mount
  const clearLastDrawingRef = useRef<() => void>(() => {});

  // Refs that mirror state so chart click handler always reads current values (no stale closure)
  const drawingModeRef = useRef<DrawingMode>('none');
  const drawingsRef = useRef<any[]>([]);
  const activeSymbolRef = useRef(activeSymbol);
  const trendlineSeriesRef = useRef<Map<string, any>>(new Map());

  // Keep refs in sync with state/props
  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);

  const setDrawingModeSync = (mode: DrawingMode) => {
    // Lock mode: allow switching to 'none' (pointer) or 'crosshair' (view-only) but block drawing modes
    if (lockActive && mode !== 'none' && mode !== 'crosshair') return;
    drawingModeRef.current = mode;
    drawClicksRef.current = [];
    setDrawingMode(mode);
  };

  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);

  // Load drawings for active symbol
  useEffect(() => {
    if (activeSymbol) {
      const loaded = loadDrawings(activeSymbol.token);
      setDrawings(loaded);
      // Rehydrate brush SVG paths from persisted drawings
      setBrushPaths(
        loaded
          .filter((d: any) => d.type === 'brush' && d.svgPath)
          .map((d: any) => ({ id: d.id, points: d.svgPath, color: '#f59e0b' }))
      );
    }
  }, [activeSymbol?.token]);

  // Eye toggle: show or hide all drawings without deleting them
  useEffect(() => {
    if (eyeHidden) {
      // Remove all rendered drawings temporarily
      priceLineSeriesRef.current.forEach(pl => {
        try { (seriesRef.current as any).removePriceLine(pl); } catch {}
      });
      priceLineSeriesRef.current = [];
      trendlineSeriesRef.current.forEach(s => {
        try { chartRef.current?.removeSeries(s); } catch {}
      });
      trendlineSeriesRef.current.clear();
      if (seriesRef.current) (seriesRef.current as any).setMarkers([]);
    } else {
      // Re-apply all drawings
      applyOverlayDrawings(drawingsRef.current);
    }
  }, [eyeHidden]);

  // Create main chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#6b7280', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(38, 42, 54, 0.4)' }, horzLines: { color: 'rgba(38, 42, 54, 0.4)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#6b7280', width: 1, style: 3 }, horzLine: { color: '#6b7280', width: 1, style: 3 } },
      rightPriceScale: { borderColor: '#262a36', scaleMargins: { top: 0.06, bottom: 0.22 } },
      timeScale: { borderColor: '#262a36', timeVisible: true, secondsVisible: false },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(chartContainerRef.current);

    // Drawing click handler — uses refs so it always reads current mode/drawings
    chart.subscribeClick((param) => {
      if (drawingModeRef.current === 'none' || drawingModeRef.current === 'crosshair' || !param.point || !param.time) return;
      const price = seriesRef.current ? (seriesRef.current as any).coordinateToPrice(param.point.y) : 0;
      if (price == null || price === 0) return;

      // Magnet snap: find nearest candle and snap to closest OHLC
      let snappedPrice = price;
      if (magnetActiveRef.current && rawDataRef.current.length > 0) {
        const clickTime = param.time as number;
        const raw = rawDataRef.current;
        let closest = raw[0];
        let minDist = Math.abs(raw[0].time - clickTime);
        for (const bar of raw) {
          const d = Math.abs(bar.time - clickTime);
          if (d < minDist) { minDist = d; closest = bar; }
        }
        const ohlc = [closest.open, closest.high, closest.low, closest.close];
        snappedPrice = ohlc.reduce((prev, cur) => Math.abs(cur - price) < Math.abs(prev - price) ? cur : prev, ohlc[0]);
      }

      // Emoji mode: show picker at screen position, store chart point for later placement
      if (drawingModeRef.current === 'emoji') {
        const rect = chartContainerRef.current?.getBoundingClientRect();
        if (rect) {
          setEmojiPicker({
            screenX: rect.left + param.point.x + 8,
            screenY: rect.top + param.point.y + 8,
            chartPoint: { time: param.time as number, price: snappedPrice },
          });
        }
        return;
      }
      handleDrawingClickRef.current({ time: param.time as number, price: snappedPrice });
    });

    // Keyboard shortcuts
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case 'escape': setDrawingModeSync('none'); break;
        case 'c': setDrawingModeSync('crosshair'); break;
        case 't': setDrawingModeSync('trendline'); break;
        case 'a': setDrawingModeSync('arrow'); break;
        case 'y': setDrawingModeSync('ray'); break;
        case 'h': setDrawingModeSync('hline'); break;
        case 'v': setDrawingModeSync('vline'); break;
        case 'f': setDrawingModeSync('fibonacci'); break;
        case 'r': setDrawingModeSync('rectangle'); break;
        case 'n': setDrawingModeSync('text'); break;
        // New shortcuts — B=Brush, E=Emoji, M=Measure, Z=Zoom
        case 'b': setDrawingModeSync('brush'); break;
        case 'e': setDrawingModeSync('emoji'); break;
        case 'm': setDrawingModeSync('measure'); break;
        case 'z': setDrawingModeSync('zoom'); break;
        // Toggles — G=Magnet, L=Lock
        case 'g': setMagnetActive(prev => !prev); break;
        case 'l': setLockActive(prev => !prev); break;
        // Delete / Backspace — remove last drawing
        case 'delete':
        case 'backspace': clearLastDrawingRef.current(); break;
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  // Stable ref so the chart click handler (registered once at mount) always calls latest version
  const handleDrawingClickRef = useRef<(point: { time: number; price: number }) => void>(() => {});

  // Handle drawing tool clicks — reads from refs to avoid stale closures
  const handleDrawingClick = useCallback((point: { time: number; price: number }) => {
    const mode = drawingModeRef.current;
    const sym = activeSymbolRef.current;
    if (!chartRef.current || !seriesRef.current || !sym) return;
    const clicks = drawClicksRef.current;

    if (mode === 'hline') {
      const priceLine = (seriesRef.current as any).createPriceLine({
        price: point.price,
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `H ${point.price.toFixed(2)}`,
      });
      priceLineSeriesRef.current.push(priceLine);
      const newDrawing = { type: 'hline', price: point.price, id: Date.now() };
      const updated = [...drawingsRef.current, newDrawing];
      drawingsRef.current = updated;
      setDrawings(updated);
      saveDrawings(sym.token, updated);
      setDrawingModeSync('none');

    } else if (mode === 'vline') {
      const newDrawing = { type: 'vline', time: point.time, id: Date.now() };
      const updated = [...drawingsRef.current, newDrawing];
      drawingsRef.current = updated;
      setDrawings(updated);
      saveDrawings(sym.token, updated);
      applyVlineDrawings(updated);
      setDrawingModeSync('none');

    } else if (mode === 'text') {
      const text = prompt('Enter text annotation:');
      if (text) {
        const marker = { time: point.time, position: 'aboveBar' as const, color: '#f59e0b', shape: 'circle' as const, text };
        const newDrawing = { type: 'text', marker, id: Date.now() };
        const updated = [...drawingsRef.current, newDrawing];
        drawingsRef.current = updated;
        setDrawings(updated);
        saveDrawings(sym.token, updated);
        applyTextMarkers(updated);
      }
      setDrawingModeSync('none');

    } else if (mode === 'trendline' || mode === 'fibonacci' || mode === 'rectangle' || mode === 'arrow' || mode === 'ray') {
      clicks.push(point);
      if (clicks.length === 2) {
        const newDrawing = { type: mode, points: [...clicks], id: Date.now() };
        const updated = [...drawingsRef.current, newDrawing];
        drawingsRef.current = updated;
        setDrawings(updated);
        saveDrawings(sym.token, updated);
        applyOverlayDrawings(updated);
        drawClicksRef.current = [];
        setDrawingModeSync('none');
      }

    } else if (mode === 'measure') {
      clicks.push(point);
      if (clicks.length === 2) {
        const [p1, p2] = clicks;
        const priceDiff = p2.price - p1.price;
        const pricePct = ((priceDiff / p1.price) * 100).toFixed(2);
        const sign = priceDiff >= 0 ? '+' : '';
        // Bar count: approximate by dividing time difference by candle interval seconds
        const rawData = rawDataRef.current;
        let barCount = 0;
        if (rawData.length >= 2) {
          const interval = rawData[1].time - rawData[0].time;
          barCount = Math.round(Math.abs(p2.time - p1.time) / interval);
        }
        const timeDiffMins = Math.abs(p2.time - p1.time) / 60;
        const timeStr = timeDiffMins < 60
          ? `${Math.round(timeDiffMins)}m`
          : timeDiffMins < 1440
            ? `${(timeDiffMins / 60).toFixed(1)}h`
            : `${(timeDiffMins / 1440).toFixed(1)}d`;

        const labelText = `${sign}${priceDiff.toFixed(2)} (${sign}${pricePct}%) · ${barCount} bars · ${timeStr}`;
        const newDrawing = { type: 'measure', points: [...clicks], label: labelText, id: Date.now() };
        const updated = [...drawingsRef.current, newDrawing];
        drawingsRef.current = updated;
        setDrawings(updated);
        saveDrawings(sym.token, updated);
        applyOverlayDrawings(updated);
        drawClicksRef.current = [];
        setDrawingModeSync('none');
      }
    }
  }, []);

  // ── Magnet snap: given a raw point, snap to nearest candle OHLC if magnet is on ──
  const magnetActiveRef = useRef(false);
  useEffect(() => { magnetActiveRef.current = magnetActive; }, [magnetActive]);

  // ── Brush tool: track active stroke in progress ──────────────────────────
  const brushActiveRef = useRef(false);
  const brushCurrentPoints = useRef<string>('');
  const brushCurrentId = useRef<number>(0);

  // Zoom tool: track drag selection rect
  const zoomDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [zoomRect, setZoomRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Brush/Zoom SVG overlay mouse handlers ────────────────────────────────
  const overlayMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const mode = drawingModeRef.current;
    if (mode === 'brush') {
      brushActiveRef.current = true;
      brushCurrentId.current = Date.now();
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      brushCurrentPoints.current = `M${x},${y}`;
      setBrushPaths(prev => [...prev, { id: brushCurrentId.current, points: brushCurrentPoints.current, color: '#f59e0b' }]);
      e.stopPropagation();
    } else if (mode === 'zoom') {
      const rect = e.currentTarget.getBoundingClientRect();
      zoomDragRef.current = { startX: e.clientX - rect.left, startY: e.clientY - rect.top };
      e.stopPropagation();
    }
  }, []);

  const overlayMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const mode = drawingModeRef.current;
    if (mode === 'brush' && brushActiveRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      brushCurrentPoints.current += ` L${x},${y}`;
      setBrushPaths(prev => prev.map(p =>
        p.id === brushCurrentId.current ? { ...p, points: brushCurrentPoints.current } : p
      ));
    } else if (mode === 'zoom' && zoomDragRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { startX, startY } = zoomDragRef.current;
      setZoomRect({
        x: Math.min(startX, cx),
        y: Math.min(startY, cy),
        w: Math.abs(cx - startX),
        h: Math.abs(cy - startY),
      });
    }
  }, []);

  const overlayMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const mode = drawingModeRef.current;
    if (mode === 'brush' && brushActiveRef.current) {
      brushActiveRef.current = false;
      // Persist brush stroke as a drawing object
      const sym = activeSymbolRef.current;
      if (sym && brushCurrentPoints.current.length > 2) {
        const newDrawing = { type: 'brush', svgPath: brushCurrentPoints.current, id: brushCurrentId.current };
        const updated = [...drawingsRef.current, newDrawing];
        drawingsRef.current = updated;
        setDrawings(updated);
        saveDrawings(sym.token, updated);
        // brushPaths state already has the rendered path; sync id mapping
      }
      brushCurrentPoints.current = '';
      setDrawingModeSync('none');
    } else if (mode === 'zoom' && zoomDragRef.current && zoomRect) {
      // Apply zoom: convert pixel rect to time range via chart API
      if (chartRef.current) {
        const ts = chartRef.current.timeScale();
        const t1 = ts.coordinateToTime(zoomRect.x);
        const t2 = ts.coordinateToTime(zoomRect.x + zoomRect.w);
        if (t1 && t2) {
          ts.setVisibleRange({ from: t1 as any, to: t2 as any });
        }
      }
      zoomDragRef.current = null;
      setZoomRect(null);
      setDrawingModeSync('none');
    }
  }, [zoomRect]);

  // Keep the ref updated with the latest callback
  useEffect(() => { handleDrawingClickRef.current = handleDrawingClick; }, [handleDrawingClick]);

  function applyTextMarkers(drawingsList: any[]) {
    if (!seriesRef.current) return;
    const markers = drawingsList.filter(d => d.type === 'text').map(d => d.marker);
    (seriesRef.current as any).setMarkers(markers.sort((a: any, b: any) => a.time - b.time));
  }

  function applyVlineDrawings(drawingsList: any[]) {
    if (!chartRef.current || !seriesRef.current) return;
    // Vertical lines are shown as markers with a vertical-bar shape on the candle
    const existing = drawingsList.filter(d => d.type === 'text').map(d => d.marker);
    const vlineMarkers = drawingsList
      .filter(d => d.type === 'vline')
      .map(d => ({ time: d.time, position: 'belowBar' as const, color: '#06b6d4', shape: 'arrowUp' as const, text: '|' }));
    const allMarkers = [...existing, ...vlineMarkers].sort((a, b) => a.time - b.time);
    (seriesRef.current as any).setMarkers(allMarkers);
  }

  function applyOverlayDrawings(drawingsList: any[]) {
    if (!chartRef.current || !seriesRef.current) return;

    // Remove old price lines
    priceLineSeriesRef.current.forEach(pl => {
      try { (seriesRef.current as any).removePriceLine(pl); } catch {}
    });
    priceLineSeriesRef.current = [];

    // Remove old trendline series
    trendlineSeriesRef.current.forEach(s => {
      try { chartRef.current!.removeSeries(s); } catch {}
    });
    trendlineSeriesRef.current.clear();

    // Horizontal lines
    drawingsList.filter(d => d.type === 'hline').forEach(d => {
      const pl = (seriesRef.current as any).createPriceLine({
        price: d.price, color: '#f59e0b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `H ${d.price.toFixed(2)}`,
      });
      priceLineSeriesRef.current.push(pl);
    });

    // True diagonal trendlines via LineSeries with 2 points
    drawingsList.filter(d => d.type === 'trendline').forEach(d => {
      if (!chartRef.current) return;
      const [p1, p2] = d.points;
      const sorted = [p1, p2].sort((a: any, b: any) => a.time - b.time);
      const series = chartRef.current.addLineSeries({
        color: '#06b6d4',
        lineWidth: 2 as any,
        lineStyle: 0,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData([
        { time: sorted[0].time as any, value: sorted[0].price },
        { time: sorted[1].time as any, value: sorted[1].price },
      ]);
      trendlineSeriesRef.current.set(String(d.id), series);
    });

    // Arrow — rendered like a trendline but with a distinct colour (orange)
    drawingsList.filter(d => d.type === 'arrow').forEach(d => {
      if (!chartRef.current) return;
      const [p1, p2] = d.points;
      const sorted = [p1, p2].sort((a: any, b: any) => a.time - b.time);
      const series = chartRef.current.addLineSeries({
        color: '#f97316',
        lineWidth: 2 as any,
        lineStyle: 0,
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
      });
      series.setData([
        { time: sorted[0].time as any, value: sorted[0].price },
        { time: sorted[1].time as any, value: sorted[1].price },
      ]);
      trendlineSeriesRef.current.set(String(d.id), series);
    });

    // Ray — extends the line from p1 through p2 to the last visible bar
    drawingsList.filter(d => d.type === 'ray').forEach(d => {
      if (!chartRef.current) return;
      const [p1, p2] = d.points;
      const raw = rawDataRef.current;
      if (raw.length < 2) return;
      const lastTime = raw[raw.length - 1].time;
      // Extrapolate: slope = (p2.price - p1.price) / (p2.time - p1.time)
      const slope = p1.time !== p2.time ? (p2.price - p1.price) / (p2.time - p1.time) : 0;
      const extPrice = p2.price + slope * (lastTime - p2.time);
      const sorted = [p1, p2, { time: lastTime, price: extPrice }].sort((a: any, b: any) => a.time - b.time);
      const series = chartRef.current.addLineSeries({
        color: '#a78bfa',
        lineWidth: 1 as any,
        lineStyle: 1, // dashed
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(sorted.map((pt: any) => ({ time: pt.time as any, value: pt.price })));
      trendlineSeriesRef.current.set(String(d.id), series);
    });

    // Fibonacci levels
    drawingsList.filter(d => d.type === 'fibonacci').forEach(d => {
      const [p1, p2] = d.points;
      const high = Math.max(p1.price, p2.price);
      const low = Math.min(p1.price, p2.price);
      const diff = high - low;
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444'];
      levels.forEach((lvl, i) => {
        const price = high - diff * lvl;
        const pl = (seriesRef.current as any).createPriceLine({
          price, color: colors[i], lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: `${(lvl * 100).toFixed(1)}%`,
        });
        priceLineSeriesRef.current.push(pl);
      });
    });

    // Rectangle as top + bottom horizontal lines
    drawingsList.filter(d => d.type === 'rectangle').forEach(d => {
      const [p1, p2] = d.points;
      [p1.price, p2.price].forEach(price => {
        const pl = (seriesRef.current as any).createPriceLine({
          price, color: '#8b5cf6', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: '',
        });
        priceLineSeriesRef.current.push(pl);
      });
    });

    // Measure — rendered as a trendline (LineSeries) between the two points
    drawingsList.filter(d => d.type === 'measure').forEach(d => {
      if (!chartRef.current) return;
      const [p1, p2] = d.points;
      const sorted = [p1, p2].sort((a: any, b: any) => a.time - b.time);
      const color = (p2.price >= p1.price) ? '#22c55e' : '#ef4444';
      const series = chartRef.current.addLineSeries({
        color,
        lineWidth: 2 as any,
        lineStyle: 1, // dashed
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        title: d.label ?? '',
      });
      series.setData([
        { time: sorted[0].time as any, value: sorted[0].price },
        { time: sorted[1].time as any, value: sorted[1].price },
      ]);
      trendlineSeriesRef.current.set(String(d.id), series);
    });

    // Re-apply markers (text + vlines + emoji)
    applyAllMarkers(drawingsList);
  }

  function applyAllMarkers(drawingsList: any[]) {
    if (!seriesRef.current) return;
    const textMarkers = drawingsList
      .filter(d => d.type === 'text')
      .map(d => d.marker);
    const vlineMarkers = drawingsList
      .filter(d => d.type === 'vline')
      .map(d => ({ time: d.time, position: 'belowBar' as const, color: '#06b6d4', shape: 'arrowUp' as const, text: '|' }));
    const emojiMarkers = drawingsList
      .filter(d => d.type === 'emoji')
      .map(d => ({ time: d.time, position: 'aboveBar' as const, color: '#f59e0b', shape: 'circle' as const, text: d.emoji }));
    const all = [...textMarkers, ...vlineMarkers, ...emojiMarkers].sort((a: any, b: any) => a.time - b.time);
    (seriesRef.current as any).setMarkers(all);
  }

  // ── Layers panel helpers ────────────────────────────────────────────────
  function handleLayersDelete(id: number) {
    if (!activeSymbol) return;
    const updated = drawingsRef.current.filter(d => d.id !== id);
    drawingsRef.current = updated;
    setDrawings(updated);
    saveDrawings(activeSymbol.token, updated);
    applyOverlayDrawings(updated);
    // Also remove from brush paths if it was a brush drawing
    setBrushPaths(prev => prev.filter(p => p.id !== id));
  }

  function handleLayersToggleVisibility(id: number) {
    const updated = drawingsRef.current.map(d => d.id === id ? { ...d, hidden: !d.hidden } : d);
    drawingsRef.current = updated;
    setDrawings(updated);
    if (activeSymbol) saveDrawings(activeSymbol.token, updated);
    // Re-apply only visible drawings
    applyOverlayDrawings(updated.filter(d => !d.hidden));
    // Also toggle brush path visibility
    setBrushPaths(prev => prev.map(p => p.id === id ? { ...p, hidden: !p.hidden } : p));
  }

  function handleLayersHighlight(id: number) {
    setHighlightedId(id);
    setTimeout(() => setHighlightedId(null), 1500);
  }

  function clearAllDrawings() {
    if (!activeSymbol) return;
    priceLineSeriesRef.current.forEach(pl => {
      try { (seriesRef.current as any).removePriceLine(pl); } catch {}
    });
    priceLineSeriesRef.current = [];
    trendlineSeriesRef.current.forEach(s => {
      try { chartRef.current!.removeSeries(s); } catch {}
    });
    trendlineSeriesRef.current.clear();
    if (seriesRef.current) (seriesRef.current as any).setMarkers([]);
    drawingsRef.current = [];
    setDrawings([]);
    saveDrawings(activeSymbol.token, []);
    // Clear brush SVG paths too
    setBrushPaths([]);
    setMeasureLabel(null);
  }

  function clearLastDrawing() {
    if (!activeSymbol || drawingsRef.current.length === 0) return;
    const updated = drawingsRef.current.slice(0, -1);
    drawingsRef.current = updated;
    setDrawings(updated);
    saveDrawings(activeSymbol.token, updated);
    applyOverlayDrawings(updated);
    // Also clean up brush paths if last drawing was a brush
    setBrushPaths(prev => prev.filter(p => updated.some((d: any) => d.id === p.id)));
  }

  // Keep clearLastDrawing ref in sync so keyboard handler (registered once at mount) always calls latest version
  useEffect(() => { clearLastDrawingRef.current = clearLastDrawing; });

  // Load chart data when symbol/timeframe/chartType changes
  useEffect(() => {
    if (!chartRef.current || !activeSymbol) return;
    liveBarRef.current = null; // reset live candle tracking on symbol/tf change
    loadChartData();
  }, [activeSymbol?.token, activeSymbol?.exchange, timeframe, chartType]);

  // Apply indicators whenever data or indicator config changes.
  // Overlay indicators can be applied immediately; sub-pane indicators need
  // their container <div>s to be in the DOM first (they are conditionally
  // rendered based on the same `indicators` state, so they won't exist yet
  // during this effect).  We schedule the sub-pane pass with useLayoutEffect
  // (runs after DOM commit but before paint) via the flag below.
  const pendingSubPaneApply = useRef(false);

  useEffect(() => {
    if (!chartRef.current) return;
    const data = rawDataRef.current;
    if (data.length === 0) return;

    // Remove old indicator series from main chart
    indicatorSeriesRef.current.forEach((s) => {
      try { chartRef.current!.removeSeries(s); } catch {}
    });
    indicatorSeriesRef.current.clear();

    // Remove all sub-charts (generic map)
    subChartsRef.current.forEach((sc) => { try { sc.remove(); } catch {} });
    subChartsRef.current.clear();

    // Legacy fixed sub-charts
    if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
    if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }
    if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; }

    // Apply overlay indicators immediately (no DOM containers needed)
    for (const ind of indicators) {
      if (!ind.enabled || ind.pane !== 'main') continue;
      applyMainIndicator(ind, data);
    }

    // Mark that sub-pane indicators need to be applied once containers are mounted
    pendingSubPaneApply.current = true;
  }, [indicators]);

  // After React commits the DOM (sub-pane divs are now mounted), apply sub-pane indicators
  useLayoutEffect(() => {
    if (!pendingSubPaneApply.current) return;
    pendingSubPaneApply.current = false;
    const data = rawDataRef.current;
    if (!chartRef.current || data.length === 0) return;
    for (const ind of indicators) {
      if (!ind.enabled || ind.pane !== 'separate') continue;
      applySubPaneIndicator(ind, data);
    }
  });

  const loadChartData = async () => {
    if (!chartRef.current || !activeSymbol) return;
    setIsLoading(true);
    setNoData(false);
    try {
      const data = await getHistoricalData(activeSymbol.token, timeframe, activeSymbol.exchange);
      if (data && data.length > 0) {
        rawDataRef.current = data;
        updateChartSeries(data);
        applyIndicators();
        applyOverlayDrawings(drawings);
        applyTextMarkers(drawings);
        setNoData(false);
      } else {
        setNoData(true);
      }
    } catch (err) {
      console.error('[ChartPanel] loadChartData failed:', err);
      setNoData(true);
    } finally { setIsLoading(false); }
  };

  const updateChartSeries = (data: OHLC[]) => {
    if (!chartRef.current) return;
    if (seriesRef.current) { chartRef.current.removeSeries(seriesRef.current); seriesRef.current = null; }

    // Debug: log first candle to verify volume field is present
    if (data.length > 0) {
      const sample = data[data.length - 5] || data[0];
      console.log(`[ChartPanel] OHLCV sample — volume=${sample.volume}, close=${sample.close}`);
    }
    if (volumeSeriesRef.current) {
      try { chartRef.current.removeSeries(volumeSeriesRef.current); } catch {}
      volumeSeriesRef.current = null;
    }

    if (chartType === 'line') {
      const series = chartRef.current.addLineSeries({ color: '#2962ff', lineWidth: 2 });
      series.setData(data.map(d => ({ time: d.time as any, value: d.close })));
      seriesRef.current = series as any;
    } else if (chartType === 'area') {
      const series = chartRef.current.addAreaSeries({ topColor: 'rgba(41,98,255,0.3)', bottomColor: 'rgba(41,98,255,0.0)', lineColor: '#2962ff', lineWidth: 2 });
      series.setData(data.map(d => ({ time: d.time as any, value: d.close })));
      seriesRef.current = series as any;
    } else {
      let processed = data;
      if (chartType === 'heikin-ashi') processed = convertToHeikinAshi(data);
      const series = chartRef.current.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
      if (chartType === 'hollow') series.applyOptions({ upColor: 'transparent', borderUpColor: '#26a69a' });
      series.setData(processed.map(d => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })));
      seriesRef.current = series as any;
    }

    // ── Permanent volume bars (always visible, bottom 20% of main chart) ──
    // In lightweight-charts v4, use priceScaleId: '' (overlay scale) and
    // set scaleMargins on the series price scale directly.
    const vs = chartRef.current.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol_overlay',
      lastValueVisible: false,
      priceLineVisible: false,
      color: 'rgba(38,166,154,0.4)',
    });
    vs.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      drawTicks: false,
      borderVisible: false,
      entireTextOnly: true,
    });
    const volData = extractVolume(data);
    if (volData.length > 0) {
      console.log(`[Volume] ${volData.length} bars, sample volumes:`, volData.slice(0, 3).map(v => v.value));
      vs.setData(volData as any);
    } else {
      console.warn('[Volume] extractVolume returned empty array');
    }
    volumeSeriesRef.current = vs;

    chartRef.current.timeScale().fitContent();
  };

  const applyIndicators = () => {
    if (!chartRef.current) return;
    const data = rawDataRef.current;
    if (data.length === 0) return;

    // Remove old indicator series from main chart
    indicatorSeriesRef.current.forEach((s) => {
      try { chartRef.current!.removeSeries(s); } catch {}
    });
    indicatorSeriesRef.current.clear();

    // Remove all sub-charts (generic map)
    subChartsRef.current.forEach((sc) => { try { sc.remove(); } catch {} });
    subChartsRef.current.clear();

    // Legacy fixed sub-charts
    if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
    if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }
    if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; }

    // Apply overlay indicators immediately (no DOM containers needed)
    for (const ind of indicators) {
      if (!ind.enabled || ind.pane !== 'main') continue;
      applyMainIndicator(ind, data);
    }

    // Sub-pane indicators require their container <div>s to be mounted.
    // Schedule via requestAnimationFrame so the React render (which creates
    // those divs) has had a chance to commit to the DOM first.
    requestAnimationFrame(() => {
      const latestData = rawDataRef.current;
      if (!chartRef.current || latestData.length === 0) return;
      for (const ind of indicators) {
        if (!ind.enabled || ind.pane !== 'separate') continue;
        applySubPaneIndicator(ind, latestData);
      }
    });
  };

  const applyMainIndicator = (ind: IndicatorConfig, data: OHLC[]) => {
    if (!chartRef.current) return;
    const addLine = (d: { time: number; value: number }[], color: string, key: string, lineWidth = 1, lineStyle = 0) => {
      if (!d.length) return;
      const s = chartRef.current!.addLineSeries({ color, lineWidth: lineWidth as any, lineStyle, lastValueVisible: false, priceLineVisible: false });
      s.setData(d as any);
      indicatorSeriesRef.current.set(key, s);
    };

    switch (ind.type) {
      case 'sma': addLine(calculateSMA(data, ind.period || 20), ind.color || '#fff', ind.id, 1); break;
      case 'ema': addLine(calculateEMA(data, ind.period || 20), ind.color || '#fff', ind.id, 1); break;
      case 'dema': addLine(calculateDEMA(data, ind.period || 14), ind.color || '#f97316', ind.id, 1); break;
      case 'tema': addLine(calculateTEMA(data, ind.period || 14), ind.color || '#84cc16', ind.id, 1); break;
      case 'hma': addLine(calculateHMA(data, ind.period || 9), ind.color || '#14b8a6', ind.id, 1); break;
      case 'mcginley': addLine(calculateMcGinley(data, ind.period || 14), ind.color || '#a855f7', ind.id, 1); break;
      case 'lsma': addLine(calculateLSMA(data, ind.period || 14), ind.color || '#0ea5e9', ind.id, 1); break;
      case 'linearreg': addLine(calculateLinearRegression(data, ind.period || 14), ind.color || '#fb923c', ind.id, 1); break;
      case 'vwap': addLine(calculateVWAP(data), ind.color || '#a855f7', ind.id, 1); break;
      case 'typicalprice': addLine(calculateTypicalPrice(data), ind.color || '#67e8f9', ind.id, 1); break;
      case 'medianprice': addLine(calculateMedianPrice(data), ind.color || '#fde68a', ind.id, 1); break;
      case 'avgprice': addLine(calculateAveragePrice(data), ind.color || '#bbf7d0', ind.id, 1); break;

      case 'bollinger': {
        const bb = calculateBollinger(data, ind.period || 20, 2);
        addLine(bb.map(b => ({ time: b.time, value: b.upper })), 'rgba(139,92,246,0.5)', ind.id + '_upper', 1);
        addLine(bb.map(b => ({ time: b.time, value: b.lower })), 'rgba(139,92,246,0.5)', ind.id + '_lower', 1);
        addLine(bb.map(b => ({ time: b.time, value: b.middle })), 'rgba(139,92,246,0.3)', ind.id + '_middle', 1, 2);
        break;
      }
      case 'keltner': {
        const kc = calculateKeltner(data, ind.period || 20, 10, 2);
        addLine(kc.map(b => ({ time: b.time, value: b.upper })), 'rgba(20,184,166,0.5)', ind.id + '_upper', 1);
        addLine(kc.map(b => ({ time: b.time, value: b.lower })), 'rgba(20,184,166,0.5)', ind.id + '_lower', 1);
        addLine(kc.map(b => ({ time: b.time, value: b.middle })), 'rgba(20,184,166,0.3)', ind.id + '_middle', 1, 2);
        break;
      }
      case 'donchian': {
        const dc = calculateDonchian(data, ind.period || 20);
        addLine(dc.map(b => ({ time: b.time, value: b.upper })), 'rgba(251,146,60,0.5)', ind.id + '_upper', 1);
        addLine(dc.map(b => ({ time: b.time, value: b.lower })), 'rgba(251,146,60,0.5)', ind.id + '_lower', 1);
        addLine(dc.map(b => ({ time: b.time, value: b.middle })), 'rgba(251,146,60,0.3)', ind.id + '_middle', 1, 2);
        break;
      }
      case 'envelopes': {
        const env = calculateEnvelopes(data, ind.period || 20);
        addLine(env.map(b => ({ time: b.time, value: b.upper })), 'rgba(236,72,153,0.5)', ind.id + '_upper', 1);
        addLine(env.map(b => ({ time: b.time, value: b.lower })), 'rgba(236,72,153,0.5)', ind.id + '_lower', 1);
        addLine(env.map(b => ({ time: b.time, value: b.middle })), 'rgba(236,72,153,0.3)', ind.id + '_middle', 1, 2);
        break;
      }
      case 'supertrend': {
        const st = calculateSuperTrend(data, ind.period || 10, ind.params?.multiplier || 3);
        const bullish = st.filter(s => s.direction === 1).map(s => ({ time: s.time, value: s.value }));
        const bearish = st.filter(s => s.direction === -1).map(s => ({ time: s.time, value: s.value }));
        addLine(bullish, 'rgba(38,166,154,0.8)', ind.id + '_bull', 2);
        addLine(bearish, 'rgba(239,83,80,0.8)', ind.id + '_bear', 2);
        break;
      }
      case 'psar': {
        const sar = calculateParabolicSAR(data);
        const bullSAR = sar.filter(s => s.direction === 1).map(s => ({ time: s.time, value: s.value }));
        const bearSAR = sar.filter(s => s.direction === -1).map(s => ({ time: s.time, value: s.value }));
        // SAR shown as dots — use LineSeries with crosshair markers only
        addLine(bullSAR, 'rgba(38,166,154,0.9)', ind.id + '_bull', 1);
        addLine(bearSAR, 'rgba(239,83,80,0.9)', ind.id + '_bear', 1);
        break;
      }
      case 'ichimoku': {
        const ic = calculateIchimoku(data);
        addLine(ic.filter(x => x.tenkan !== null).map(x => ({ time: x.time, value: x.tenkan! })), '#e53e3e', ind.id + '_tenkan', 1);
        addLine(ic.filter(x => x.kijun !== null).map(x => ({ time: x.time, value: x.kijun! })), '#3182ce', ind.id + '_kijun', 1);
        addLine(ic.filter(x => x.senkouA !== null).map(x => ({ time: x.time, value: x.senkouA! })), 'rgba(38,166,154,0.4)', ind.id + '_senkouA', 1);
        addLine(ic.filter(x => x.senkouB !== null).map(x => ({ time: x.time, value: x.senkouB! })), 'rgba(239,83,80,0.4)', ind.id + '_senkouB', 1);
        addLine(ic.filter(x => x.chikou !== null).map(x => ({ time: x.time, value: x.chikou! })), 'rgba(168,85,247,0.6)', ind.id + '_chikou', 1);
        break;
      }
      case 'pivots': {
        const pv = calculatePivots(data);
        if (!pv.length) break;
        // Show as price lines on the last pivot
        const last = pv[pv.length - 1];
        const pvLines = [
          { price: last.pivot, color: '#fff', title: 'P' },
          { price: last.r1, color: '#ef4444', title: 'R1' }, { price: last.r2, color: '#ef4444', title: 'R2' }, { price: last.r3, color: '#ef4444', title: 'R3' },
          { price: last.s1, color: '#22c55e', title: 'S1' }, { price: last.s2, color: '#22c55e', title: 'S2' }, { price: last.s3, color: '#22c55e', title: 'S3' },
        ];
        pvLines.forEach(pl => {
          if (!seriesRef.current) return;
          const pline = (seriesRef.current as any).createPriceLine({ price: pl.price, color: pl.color, lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: pl.title });
          indicatorSeriesRef.current.set(ind.id + '_' + pl.title, pline);
        });
        break;
      }
    }
  };

  // ── Sub-pane indicator renderer ─────────────────────────────────────────
  const applySubPaneIndicator = (ind: IndicatorConfig, data: OHLC[]) => {
    const container = subChartContainersRef.current.get(ind.id);
    if (!container || !chartRef.current) return;

    const sc = createChart(container, subChartOptions(container));
    subChartsRef.current.set(ind.id, sc);
    const addLine = (d: { time: number; value: number }[], color: string, lw = 1) => {
      if (!d.length) return null;
      const s = sc.addLineSeries({ color, lineWidth: lw as any, lastValueVisible: false, priceLineVisible: false });
      s.setData(d as any);
      return s;
    };

    switch (ind.type) {
      case 'volume': {
        const vs = sc.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
        vs.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
        vs.setData(extractVolume(data) as any);
        break;
      }
      case 'rsi': {
        const rsiData = calculateRSI(data, ind.period || 14);
        const rs = addLine(rsiData, '#a855f7', 2);
        if (rs) {
          rs.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          rs.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'macd': {
        const macdData = calculateMACD(data);
        addLine(macdData.map(d => ({ time: d.time, value: d.macd })), '#3b82f6', 2);
        addLine(macdData.map(d => ({ time: d.time, value: d.signal })), '#f97316', 1);
        const hist = sc.addHistogramSeries({});
        hist.setData(macdData.map(d => ({ time: d.time as any, value: d.histogram, color: d.histogram >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' })));
        break;
      }
      case 'stochastic': {
        const st = calculateStochastic(data, ind.period || 14);
        const kLine = addLine(st.map(s => ({ time: s.time, value: s.k })), '#3b82f6', 2);
        addLine(st.map(s => ({ time: s.time, value: s.d })), '#f97316', 1);
        if (kLine) {
          kLine.createPriceLine({ price: 80, color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          kLine.createPriceLine({ price: 20, color: 'rgba(34,197,94,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'stochrsi': {
        const sr = calculateStochRSI(data, ind.period || 14);
        const kLine = addLine(sr.map(s => ({ time: s.time, value: s.k })), '#3b82f6', 2);
        addLine(sr.map(s => ({ time: s.time, value: s.d })), '#f97316', 1);
        if (kLine) {
          kLine.createPriceLine({ price: 80, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          kLine.createPriceLine({ price: 20, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'adx': {
        const adxData = calculateADX(data, ind.period || 14);
        addLine(adxData.map(d => ({ time: d.time, value: d.adx })), '#f59e0b', 2);
        addLine(adxData.map(d => ({ time: d.time, value: d.diPlus })), '#22c55e', 1);
        addLine(adxData.map(d => ({ time: d.time, value: d.diMinus })), '#ef4444', 1);
        break;
      }
      case 'atr': addLine(calculateATR(data, ind.period || 14), '#f59e0b', 2); break;
      case 'cci': {
        const cciLine = addLine(calculateCCI(data, ind.period || 20), '#06b6d4', 2);
        if (cciLine) {
          cciLine.createPriceLine({ price: 100, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          cciLine.createPriceLine({ price: -100, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'williamsr': {
        const wr = addLine(calculateWilliamsR(data, ind.period || 14), '#ec4899', 2);
        if (wr) {
          wr.createPriceLine({ price: -20, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          wr.createPriceLine({ price: -80, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'stddev': addLine(calculateStdDev(data, ind.period || 20), '#f97316', 2); break;
      case 'ao': {
        const aoData = calculateAO(data);
        const aoHist = sc.addHistogramSeries({});
        aoHist.setData(aoData as any);
        break;
      }
      case 'momentum': addLine(calculateMomentum(data, ind.period || 10), '#10b981', 2); break;
      case 'roc': addLine(calculateROC(data, ind.period || 9), '#3b82f6', 2); break;
      case 'trix': addLine(calculateTRIX(data, ind.period || 14), '#a78bfa', 2); break;
      case 'ultimateosc': {
        const uo = addLine(calculateUltimateOscillator(data), '#f59e0b', 2);
        if (uo) {
          uo.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          uo.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'histvolatility': addLine(calculateHistoricalVolatility(data, ind.period || 20), '#ef4444', 2); break;
      case 'priceoscillator': addLine(calculatePriceOscillator(data, ind.period || 9), '#06b6d4', 2); break;
      case 'massindex': addLine(calculateMassIndex(data), '#f97316', 2); break;
      case 'vortex': {
        const vData = calculateVortex(data, ind.period || 14);
        addLine(vData.map(d => ({ time: d.time, value: d.vip })), '#22c55e', 2);
        addLine(vData.map(d => ({ time: d.time, value: d.vim })), '#ef4444', 1);
        break;
      }
      case 'aroon': {
        const aroonData = calculateAroon(data, ind.period || 14);
        addLine(aroonData.map(d => ({ time: d.time, value: d.up })), '#22c55e', 1);
        addLine(aroonData.map(d => ({ time: d.time, value: d.down })), '#ef4444', 1);
        addLine(aroonData.map(d => ({ time: d.time, value: d.oscillator })), '#f59e0b', 2);
        break;
      }
      case 'cmo': {
        const cmoLine = addLine(calculateCMO(data, ind.period || 9), '#a855f7', 2);
        if (cmoLine) {
          cmoLine.createPriceLine({ price: 50, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          cmoLine.createPriceLine({ price: -50, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'choppiness': {
        const ci = addLine(calculateChoppiness(data, ind.period || 14), '#06b6d4', 2);
        if (ci) {
          ci.createPriceLine({ price: 61.8, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          ci.createPriceLine({ price: 38.2, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'dpo': addLine(calculateDPO(data, ind.period || 20), '#84cc16', 2); break;
      case 'fisher': {
        const fisherData = calculateFisher(data, ind.period || 9);
        addLine(fisherData.map(d => ({ time: d.time, value: d.fisher })), '#f59e0b', 2);
        addLine(fisherData.map(d => ({ time: d.time, value: d.signal })), '#ef4444', 1);
        break;
      }
      case 'connorsrsi': {
        const crsi = addLine(calculateConnorsRSI(data), '#a855f7', 2);
        if (crsi) {
          crsi.createPriceLine({ price: 90, color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          crsi.createPriceLine({ price: 10, color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        }
        break;
      }
      case 'coppock': addLine(calculateCoppock(data), '#f59e0b', 2); break;
      case 'rvi': {
        const rviData = calculateRVI(data, ind.period || 10);
        addLine(rviData.map(d => ({ time: d.time, value: d.rvi })), '#3b82f6', 2);
        addLine(rviData.map(d => ({ time: d.time, value: d.signal })), '#f97316', 1);
        break;
      }
      case 'bop': addLine(calculateBOP(data), '#10b981', 2); break;
    }

    sc.timeScale().fitContent();
    syncTimeScales(chartRef.current!, sc);
  };

  function subChartOptions(container: HTMLElement) {
    return {
      layout: { background: { type: ColorType.Solid as const, color: 'transparent' }, textColor: '#6b7280', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(38,42,54,0.3)' }, horzLines: { color: 'rgba(38,42,54,0.3)' } },
      rightPriceScale: { borderColor: '#262a36' },
      timeScale: { borderColor: '#262a36', visible: false },
      crosshair: { mode: CrosshairMode.Normal },
      watermark: { visible: false },
      width: container.clientWidth,
      height: container.clientHeight,
    };
  }

  function syncTimeScales(main: IChartApi, sub: IChartApi) {
    main.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) sub.timeScale().setVisibleLogicalRange(range);
    });
  }

  // Live tick update — snap time to candle boundary, use LTP-based OHLC not day OHLC
  useEffect(() => {
    if (!seriesRef.current || !quote?.ltp) return;

    // Snap timestamp to the start of the current candle window
    const resMinutes = timeframeToMinutes(timeframe);
    const nowMs = Date.now();
    let candleTime: number;
    if (timeframe === 'D' || timeframe === 'W') {
      const d = new Date(nowMs);
      d.setHours(0, 0, 0, 0);
      candleTime = Math.floor(d.getTime() / 1000);
    } else {
      const totalMinutes = Math.floor(nowMs / 60000); // total minutes since epoch
      const snapped = Math.floor(totalMinutes / resMinutes) * resMinutes;
      candleTime = snapped * 60;
    }

    const ltp = quote.ltp;
    // quote.volume is cumulative day volume from Angel One — use it directly for display
    // The candle volume will be updated by the server-side candle aggregator
    const tickVolume = quote.volume || 0;

    if (chartType === 'line' || chartType === 'area') {
      (seriesRef.current as any).update({ time: candleTime, value: ltp });
    } else {
      const prevLiveCandle = liveBarRef.current;
      let updatedBar: { time: number; open: number; high: number; low: number; close: number; volume: number };

      if (!prevLiveCandle || prevLiveCandle.time !== candleTime) {
        // New candle — open at current LTP
        updatedBar = { time: candleTime, open: ltp, high: ltp, low: ltp, close: ltp, volume: tickVolume };
      } else {
        // Update existing live candle — volume grows as new ticks arrive
        updatedBar = {
          time: candleTime,
          open: prevLiveCandle.open,
          high: Math.max(prevLiveCandle.high, ltp),
          low: Math.min(prevLiveCandle.low, ltp),
          close: ltp,
          volume: Math.max(prevLiveCandle.volume, tickVolume), // cumulative, take max
        };
      }

      liveBarRef.current = updatedBar;
      (seriesRef.current as any).update(updatedBar);

      // Update permanent volume histogram with live candle volume
      if (volumeSeriesRef.current && updatedBar.volume > 0) {
        volumeSeriesRef.current.update({
          time: candleTime,
          value: updatedBar.volume,
          color: ltp >= updatedBar.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        });
      }
    }
  }, [quote?.ltp, quote?.volume]);

  const handleToggleIndicator = useCallback((id: string) => {
    setIndicators(prev => prev.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i));
  }, []);

  const handleUpdatePeriod = useCallback((id: string, period: number) => {
    setIndicators(prev => prev.map(i => i.id === id ? { ...i, period, label: `${i.type.toUpperCase()} ${period}` } : i));
  }, []);

  const handleDisableAllIndicators = useCallback(() => {
    setIndicators(prev => prev.map(i => ({ ...i, enabled: false })));
  }, []);

  // ── Emoji placement callback ─────────────────────────────────────────────
  const handleEmojiSelect = useCallback((emoji: string) => {
    if (!emojiPicker) return;
    const { chartPoint } = emojiPicker;
    const sym = activeSymbolRef.current;
    if (!sym) { setEmojiPicker(null); return; }
    const newDrawing = { type: 'emoji', time: chartPoint.time, price: chartPoint.price, emoji, id: Date.now() };
    const updated = [...drawingsRef.current, newDrawing];
    drawingsRef.current = updated;
    setDrawings(updated);
    saveDrawings(sym.token, updated);
    applyAllMarkers(updated);
    setEmojiPicker(null);
    setDrawingModeSync('none');
  }, [emojiPicker]);

  // ── Right-click context menu: find nearest drawing at cursor position ────
  const handleChartContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!chartRef.current || !seriesRef.current || drawingsRef.current.length === 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Convert pixel coords to chart price+time
    const clickTime = chartRef.current.timeScale().coordinateToTime(px) as number | null;
    const clickPrice = (seriesRef.current as any).coordinateToPrice(py) as number | null;
    if (clickTime == null || clickPrice == null) return;

    // Find the closest drawing by measuring distance in pixel-space
    let bestId: number | null = null;
    let bestDist = 30; // px threshold — must be within 30px to show menu

    for (const d of drawingsRef.current) {
      if (d.hidden) continue;

      if (d.type === 'hline') {
        const lineY = (seriesRef.current as any).priceToCoordinate(d.price);
        if (lineY != null && Math.abs(py - lineY) < bestDist) {
          bestDist = Math.abs(py - lineY);
          bestId = d.id;
        }
      } else if (d.type === 'vline') {
        const lineX = chartRef.current.timeScale().timeToCoordinate(d.time as any);
        if (lineX != null && Math.abs(px - lineX) < bestDist) {
          bestDist = Math.abs(px - lineX);
          bestId = d.id;
        }
      } else if (d.type === 'trendline' || d.type === 'arrow' || d.type === 'ray' || d.type === 'fibonacci' || d.type === 'rectangle' || d.type === 'measure') {
        // Check proximity to either endpoint
        for (const pt of (d.points || [])) {
          const ex = chartRef.current.timeScale().timeToCoordinate(pt.time as any);
          const ey = (seriesRef.current as any).priceToCoordinate(pt.price);
          if (ex != null && ey != null) {
            const dist = Math.hypot(px - ex, py - ey);
            if (dist < bestDist) { bestDist = dist; bestId = d.id; }
          }
        }
      } else if (d.type === 'text' || d.type === 'vline' || d.type === 'emoji') {
        const ex = chartRef.current.timeScale().timeToCoordinate(d.time as any);
        const ey = d.price != null ? (seriesRef.current as any).priceToCoordinate(d.price) : null;
        if (ex != null && ey != null) {
          const dist = Math.hypot(px - ex, py - ey);
          if (dist < bestDist) { bestDist = dist; bestId = d.id; }
        }
      } else if (d.type === 'brush') {
        // Brush: skip proximity check, just offer via Layers panel
      }
    }

    if (bestId !== null) {
      setCtxMenu({ x: e.clientX, y: e.clientY, drawingId: bestId });
    }
  }, []);

  const separatePaneIndicators = indicators.filter(i => i.enabled && i.pane === 'separate');
  const spread = quote ? (quote.high - quote.low) : 0;
  return (
    <div className={cn('h-full flex flex-col bg-[#0d0f15]', isFullscreen && 'fixed inset-0 z-50')}>
      {/* Symbol Context Bar — Enhanced */}
      {activeSymbol && (
        <div className="h-[30px] min-h-[30px] flex items-center px-3 gap-4 border-b border-fw-border/40 bg-[#10121a] text-[13px]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-fw-text text-[13px]">{activeSymbol.symbol}</span>
            <span className="text-[13px] text-fw-text-muted bg-[#141720] px-1.5 py-0.5 rounded font-medium">{activeSymbol.exchange}</span>
          </div>
          {quote && (
            <>
              <span className={cn('font-mono font-black text-[14px] tabular-nums', quote.changePercent >= 0 ? 'text-green' : 'text-red')}>{formatPrice(quote.ltp)}</span>
              <span className={cn('text-[14px] font-mono font-semibold px-1.5 py-0.5 rounded tabular-nums', quote.changePercent >= 0 ? 'text-green bg-green-dim' : 'text-red bg-red-dim')}>
                {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent?.toFixed(2)}%
              </span>
              <div className="w-px h-3.5 bg-fw-border/30" />
              <div className="flex items-center gap-2.5 text-[14px]">
                <span className="text-fw-text-muted">O <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{formatPrice(quote.open || quote.ltp)}</span></span>
                <span className="text-fw-text-muted">H <span className="font-mono tabular-nums text-green font-medium">{formatPrice(quote.high || quote.ltp)}</span></span>
                <span className="text-fw-text-muted">L <span className="font-mono tabular-nums text-red font-medium">{formatPrice(quote.low || quote.ltp)}</span></span>
                <span className="text-fw-text-muted">C <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{formatPrice(quote.close || quote.ltp)}</span></span>
              </div>
              <div className="w-px h-3.5 bg-fw-border/30" />
              <span className="text-fw-text-muted text-[14px]">Vol <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{quote.volume ? (quote.volume / 100000).toFixed(2) + 'L' : '—'}</span></span>
              {spread > 0 && (
                <>
                  <div className="w-px h-3.5 bg-fw-border/30" />
                  <span className="text-fw-text-muted text-[14px]">Spread <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{formatPrice(spread)}</span></span>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="h-[32px] min-h-[32px] flex items-center px-2 gap-0.5 border-b border-fw-border/40 bg-[#10121a]">
        {TIMEFRAMES.map((tf) => (
          <button key={tf} onClick={() => setTimeframe(tf)}
            className={cn('px-1.5 py-0.5 text-[14px] rounded font-medium transition-all', timeframe === tf ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover')}>
            {timeframeToLabel(tf)}
          </button>
        ))}
        <div className="w-px h-4 bg-fw-border/40 mx-1" />
        {CHART_TYPES.map((ct) => (
          <button key={ct.value} onClick={() => setChartType(ct.value as ChartType)} title={ct.label}
            className={cn('px-1.5 py-0.5 text-[13px] rounded font-medium transition-all', chartType === ct.value ? 'bg-fw-hover text-fw-text' : 'text-fw-text-muted hover:text-fw-text')}>
            {ct.label}
          </button>
        ))}
        <div className="w-px h-4 bg-fw-border/40 mx-1" />
        {/* Indicators Dropdown */}
        <IndicatorPanel indicators={indicators} onToggle={handleToggleIndicator} onUpdatePeriod={handleUpdatePeriod} onDisableAll={handleDisableAllIndicators} />
        <div className="flex-1" />
        <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1 rounded text-fw-text-muted hover:text-fw-text hover:bg-fw-hover transition-colors" title="Fullscreen">
          <Maximize2 size={12} />
        </button>
      </div>

      {/* Chart Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Drawing Toolbar — TradingView style */}
        <ChartDrawingToolbar
          activeMode={drawingMode}
          onModeChange={setDrawingModeSync}
          onClearLast={clearLastDrawing}
          onClearAll={clearAllDrawings}
          drawingCount={drawings.length}
          magnetActive={magnetActive}
          lockActive={lockActive}
          eyeHidden={eyeHidden}
          onToggleMagnet={() => setMagnetActive(v => !v)}
          onToggleLock={() => setLockActive(v => !v)}
          onToggleEye={() => setEyeHidden(v => !v)}
          onOpenLayers={() => setLayersOpen(v => !v)}
          collapsed={toolbarCollapsed}
        />
        {/* Collapse toggle tab */}
        <DrawingToolbarToggle
          collapsed={toolbarCollapsed}
          onToggle={() => setToolbarCollapsed(v => !v)}
        />

        {/* Chart + sub-panes */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative" ref={chartContainerRef} onContextMenu={handleChartContextMenu}>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f15]/80 z-10">
                <div className="w-4 h-4 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!activeSymbol && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-[14px] text-fw-text-secondary">Select a symbol</p>
                  <p className="text-[14px] text-fw-text-muted mt-1">Ctrl+K to search</p>
                </div>
              </div>
            )}
            {activeSymbol && noData && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-fw-hover flex items-center justify-center text-fw-text-muted text-lg">📡</div>
                  <p className="text-[14px] text-fw-text-secondary font-medium">Chart data unavailable</p>
                  <p className="text-[14px] text-fw-text-muted">Market feed reconnecting…</p>
                  <button
                    onClick={loadChartData}
                    className="mt-1 px-3 py-1 rounded text-[14px] bg-fw-accent/20 hover:bg-fw-accent/40 text-fw-accent border border-fw-accent/30 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* SVG overlay — brush strokes, measure annotations, zoom rect */}
            <svg
              className={cn(
                'absolute inset-0 w-full h-full z-[15]',
                (drawingMode === 'brush' || drawingMode === 'zoom') ? 'cursor-crosshair' : 'pointer-events-none',
                drawingMode === 'none' && drawings.length > 0 ? 'pointer-events-auto' : '',
              )}
              style={drawingMode === 'crosshair' ? { pointerEvents: 'none', cursor: 'crosshair' } : undefined}
              onMouseDown={overlayMouseDown}
              onMouseMove={overlayMouseMove}
              onMouseUp={overlayMouseUp}
              onMouseLeave={overlayMouseUp}
              onContextMenu={handleChartContextMenu}
            >
              {/* Brush strokes */}
              {!eyeHidden && brushPaths.map(p => (
                <path
                  key={p.id}
                  d={p.points}
                  stroke={highlightedId === p.id ? '#ffffff' : p.color}
                  strokeWidth={highlightedId === p.id ? 3 : 2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
              ))}
              {/* Zoom selection rectangle */}
              {zoomRect && drawingMode === 'zoom' && (
                <rect
                  x={zoomRect.x} y={zoomRect.y}
                  width={zoomRect.w} height={zoomRect.h}
                  fill="rgba(59,130,246,0.1)"
                  stroke="#3b82f6"
                  strokeWidth={1}
                  strokeDasharray="4,3"
                />
              )}
              {/* Measure label floating badge — render near midpoint of measure line */}
              {!eyeHidden && drawings.filter(d => d.type === 'measure').map(d => {
                if (!chartRef.current || !seriesRef.current) return null;
                const [p1, p2] = d.points;
                const midTime = Math.round((p1.time + p2.time) / 2) as any;
                const midPrice = (p1.price + p2.price) / 2;
                const x = chartRef.current.timeScale().timeToCoordinate(midTime);
                const y = (seriesRef.current as any).priceToCoordinate(midPrice);
                if (x == null || y == null) return null;
                return (
                  <g key={d.id}>
                    <rect x={x - 2} y={y - 12} width={d.label?.length * 5.5 + 12 || 80} height={18} rx={4}
                      fill="#1a1d28" stroke={d.points[1].price >= d.points[0].price ? '#22c55e' : '#ef4444'} strokeWidth={1} />
                    <text x={x + 4} y={y} fontSize={9} fill={d.points[1].price >= d.points[0].price ? '#22c55e' : '#ef4444'}
                      fontFamily="monospace">
                      {d.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Status hint bar */}
            {drawingMode !== 'none' && drawingMode !== 'crosshair' && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-fw-accent/90 text-white text-[14px] font-medium pointer-events-none">
                {drawingMode === 'hline'      && 'Click to place horizontal line'}
                {drawingMode === 'vline'      && 'Click to place vertical line'}
                {drawingMode === 'text'       && 'Click to place text note'}
                {drawingMode === 'emoji'      && 'Click chart to choose annotation emoji'}
                {drawingMode === 'brush'      && 'Click & drag to draw freehand'}
                {drawingMode === 'zoom'       && 'Drag to zoom into range'}
                {drawingMode === 'measure'    && `Click point ${drawClicksRef.current.length + 1} of 2`}
                {drawingMode === 'arrow'      && `Click point ${drawClicksRef.current.length + 1} of 2`}
                {drawingMode === 'ray'        && `Click point ${drawClicksRef.current.length + 1} of 2`}
                {(drawingMode === 'trendline' || drawingMode === 'fibonacci' || drawingMode === 'rectangle') && `Click point ${drawClicksRef.current.length + 1} of 2`}
              </div>
            )}
            {/* Pointer mode hint when drawings exist */}
            {drawingMode === 'none' && drawings.length > 0 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 px-2.5 py-0.5 rounded-full bg-[#1a1d28]/80 text-fw-text-muted text-[12px] pointer-events-none border border-fw-border/30">
                Right-click drawing to delete · Del key removes last
              </div>
            )}

            {/* Layers panel — positioned inside chart area, left side */}
            {layersOpen && (
              <DrawingLayersPanel
                items={drawings.map(d => ({ id: d.id, type: d.type, label: d.label ?? '', hidden: d.hidden ?? false }))}
                onClose={() => setLayersOpen(false)}
                onHighlight={handleLayersHighlight}
                onToggleVisibility={handleLayersToggleVisibility}
                onDelete={handleLayersDelete}
              />
            )}
            {/* Right-click context menu for drawings */}
            {ctxMenu && (
              <>
                {/* Backdrop to dismiss on outside click */}
                <div
                  className="fixed inset-0 z-[490]"
                  onClick={() => setCtxMenu(null)}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
                />
                <div
                  className="fixed z-[500] w-[160px] bg-[#14172e] border border-fw-border rounded-lg shadow-2xl overflow-hidden text-[13px]"
                  style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 110) }}
                >
                  <div className="px-3 py-1.5 border-b border-fw-border/50 text-fw-text-muted text-[12px] font-semibold uppercase tracking-wide">
                    Drawing
                  </div>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-fw-text hover:bg-fw-hover transition-colors text-left"
                    onClick={() => {
                      handleLayersHighlight(ctxMenu.drawingId);
                      setLayersOpen(true);
                      setCtxMenu(null);
                    }}
                  >
                    <span className="text-[11px]">🔍</span> Select in Layers
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-fw-text hover:bg-fw-hover transition-colors text-left"
                    onClick={() => {
                      handleLayersToggleVisibility(ctxMenu.drawingId);
                      setCtxMenu(null);
                    }}
                  >
                    <span className="text-[11px]">👁</span>
                    {drawings.find(d => d.id === ctxMenu.drawingId)?.hidden ? 'Show' : 'Hide'}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/10 transition-colors text-left border-t border-fw-border/30"
                    onClick={() => {
                      handleLayersDelete(ctxMenu.drawingId);
                      setCtxMenu(null);
                    }}
                  >
                    <span className="text-[11px]">🗑</span> Delete
                  </button>
                </div>
              </>
            )}
          </div>
          {/* Sub-chart panes — one per enabled separate-pane indicator */}
          {separatePaneIndicators.map(ind => (
            <div
              key={ind.id}
              ref={el => { subChartContainersRef.current.set(ind.id, el); }}
              className={cn(
                'border-t border-fw-border/30',
                ind.type === 'volume' ? 'h-[60px] min-h-[60px]' : 'h-[80px] min-h-[80px]'
              )}
            />
          ))}
        </div>
      </div>

      {/* Emoji Marker Picker — rendered at screen-level to avoid clipping */}
      {emojiPicker && (
        <EmojiMarkerPicker
          x={emojiPicker.screenX}
          y={emojiPicker.screenY}
          onSelect={handleEmojiSelect}
          onClose={() => { setEmojiPicker(null); setDrawingModeSync('none'); }}
        />
      )}
    </div>
  );
}

function timeframeToMinutes(tf: string): number {
  const map: Record<string, number> = { '1': 1, '3': 3, '5': 5, '15': 15, '30': 30, '60': 60, '240': 240, 'D': 1440, 'W': 10080 };
  return map[tf] || parseInt(tf) || 5;
}

function convertToHeikinAshi(data: OHLC[]): OHLC[] {
  const result: OHLC[] = [];
  for (let i = 0; i < data.length; i++) {
    const curr = data[i];
    if (i === 0) {
      result.push({ time: curr.time, open: (curr.open + curr.close) / 2, high: curr.high, low: curr.low, close: (curr.open + curr.high + curr.low + curr.close) / 4, volume: curr.volume });
    } else {
      const prev = result[i - 1];
      const close = (curr.open + curr.high + curr.low + curr.close) / 4;
      const open = (prev.open + prev.close) / 2;
      result.push({ time: curr.time, open, high: Math.max(curr.high, open, close), low: Math.min(curr.low, open, close), close, volume: curr.volume });
    }
  }
  return result;
}

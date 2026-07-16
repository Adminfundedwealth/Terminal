import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode } from 'lightweight-charts';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getHistoricalData } from '@/services/api';
import { cn, timeframeToLabel, formatPrice } from '@/utils/helpers';
import type { ChartType, Timeframe, OHLC } from '@/types';
import { Maximize2, Camera, Crosshair, Layers } from 'lucide-react';
import { IndicatorPanel, DEFAULT_INDICATORS, type IndicatorConfig, type IndicatorType } from './IndicatorPanel';
import { DrawingTools, type DrawingMode } from './DrawingTools';
import { calculateSMA, calculateEMA, calculateRSI, calculateMACD, calculateBollinger, calculateVWAP, extractVolume } from '@/utils/indicators';

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
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const rawDataRef = useRef<OHLC[]>([]);
  const liveBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [noData, setNoData] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(DEFAULT_INDICATORS);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('none');
  const [drawings, setDrawings] = useState<any[]>([]);
  const drawClicksRef = useRef<{ time: number; price: number }[]>([]);
  const priceLineSeriesRef = useRef<any[]>([]);

  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);

  // Load drawings for active symbol
  useEffect(() => {
    if (activeSymbol) {
      setDrawings(loadDrawings(activeSymbol.token));
    }
  }, [activeSymbol?.token]);

  // Create main chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#6b7280', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(38, 42, 54, 0.4)' }, horzLines: { color: 'rgba(38, 42, 54, 0.4)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#6b7280', width: 1, style: 3 }, horzLine: { color: '#6b7280', width: 1, style: 3 } },
      rightPriceScale: { borderColor: '#262a36', scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: { borderColor: '#262a36', timeVisible: true, secondsVisible: false },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(chartContainerRef.current);

    // Drawing click handler
    chart.subscribeClick((param) => {
      if (drawingMode === 'none' || !param.point || !param.time) return;
      const price = seriesRef.current ? (seriesRef.current as any).coordinateToPrice(param.point.y) : 0;
      handleDrawingClick({ time: param.time as number, price });
    });

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  // Handle drawing tool clicks
  const handleDrawingClick = useCallback((point: { time: number; price: number }) => {
    if (!chartRef.current || !seriesRef.current || !activeSymbol) return;
    const clicks = drawClicksRef.current;

    if (drawingMode === 'hline') {
      // Single click — horizontal line
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
      const updated = [...drawings, newDrawing];
      setDrawings(updated);
      saveDrawings(activeSymbol.token, updated);
      setDrawingMode('none');
    } else if (drawingMode === 'text') {
      const text = prompt('Enter text annotation:');
      if (text) {
        const marker = { time: point.time, position: 'aboveBar' as const, color: '#f59e0b', shape: 'circle' as const, text };
        const newDrawing = { type: 'text', marker, id: Date.now() };
        const updated = [...drawings, newDrawing];
        setDrawings(updated);
        saveDrawings(activeSymbol.token, updated);
        applyTextMarkers(updated);
      }
      setDrawingMode('none');
    } else if (drawingMode === 'trendline' || drawingMode === 'fibonacci' || drawingMode === 'rectangle') {
      clicks.push(point);
      if (clicks.length === 2) {
        const newDrawing = { type: drawingMode, points: [...clicks], id: Date.now() };
        const updated = [...drawings, newDrawing];
        setDrawings(updated);
        saveDrawings(activeSymbol.token, updated);
        applyOverlayDrawings(updated);
        drawClicksRef.current = [];
        setDrawingMode('none');
      }
    }
  }, [drawingMode, drawings, activeSymbol]);

  function applyTextMarkers(drawingsList: any[]) {
    if (!seriesRef.current) return;
    const markers = drawingsList.filter(d => d.type === 'text').map(d => d.marker);
    (seriesRef.current as any).setMarkers(markers);
  }

  function applyOverlayDrawings(drawingsList: any[]) {
    // Trendlines and Fibonacci drawn as price lines (simplified for lightweight-charts)
    if (!seriesRef.current) return;
    // Remove old price lines from drawings
    priceLineSeriesRef.current.forEach(pl => {
      try { (seriesRef.current as any).removePriceLine(pl); } catch {}
    });
    priceLineSeriesRef.current = [];
    // Re-apply hlines
    drawingsList.filter(d => d.type === 'hline').forEach(d => {
      const pl = (seriesRef.current as any).createPriceLine({
        price: d.price, color: '#f59e0b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `H ${d.price.toFixed(2)}`,
      });
      priceLineSeriesRef.current.push(pl);
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
    // Trendlines as start/end price lines (simplified)
    drawingsList.filter(d => d.type === 'trendline').forEach(d => {
      const [p1, p2] = d.points;
      [p1, p2].forEach(p => {
        const pl = (seriesRef.current as any).createPriceLine({
          price: p.price, color: '#06b6d4', lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: '',
        });
        priceLineSeriesRef.current.push(pl);
      });
    });
    // Rectangle as two horizontal lines (top/bottom)
    drawingsList.filter(d => d.type === 'rectangle').forEach(d => {
      const [p1, p2] = d.points;
      [p1.price, p2.price].forEach(price => {
        const pl = (seriesRef.current as any).createPriceLine({
          price, color: '#8b5cf6', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: '',
        });
        priceLineSeriesRef.current.push(pl);
      });
    });
  }

  function clearAllDrawings() {
    if (!activeSymbol) return;
    priceLineSeriesRef.current.forEach(pl => {
      try { (seriesRef.current as any).removePriceLine(pl); } catch {}
    });
    priceLineSeriesRef.current = [];
    if (seriesRef.current) (seriesRef.current as any).setMarkers([]);
    setDrawings([]);
    saveDrawings(activeSymbol.token, []);
  }

  // Load chart data when symbol/timeframe/chartType changes
  useEffect(() => {
    if (!chartRef.current || !activeSymbol) return;
    liveBarRef.current = null; // reset live candle tracking on symbol/tf change
    loadChartData();
  }, [activeSymbol?.token, timeframe, chartType]);

  // Apply indicators whenever data or indicator config changes
  useEffect(() => {
    applyIndicators();
  }, [indicators]);

  const loadChartData = async () => {
    if (!chartRef.current || !activeSymbol) return;
    setIsLoading(true);
    setNoData(false);
    try {
      const data = await getHistoricalData(activeSymbol.token, timeframe);
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
    chartRef.current.timeScale().fitContent();
  };

  const applyIndicators = () => {
    if (!chartRef.current) return;
    const data = rawDataRef.current;
    if (data.length === 0) return;

    // Remove old indicator series from main chart
    indicatorSeriesRef.current.forEach((s, key) => {
      try { chartRef.current!.removeSeries(s); } catch {}
    });
    indicatorSeriesRef.current.clear();

    // Remove sub-charts
    if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
    if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }
    if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; }

    // Apply overlay indicators
    for (const ind of indicators) {
      if (!ind.enabled) continue;
      if (ind.pane === 'main') {
        applyMainIndicator(ind, data);
      }
    }

    // Apply separate pane indicators
    const hasRSI = indicators.find(i => i.id === 'rsi' && i.enabled);
    const hasMACD = indicators.find(i => i.id === 'macd' && i.enabled);
    const hasVolume = indicators.find(i => i.id === 'volume' && i.enabled);

    if (hasVolume && volumeContainerRef.current) {
      const vc = createChart(volumeContainerRef.current, subChartOptions(volumeContainerRef.current));
      volumeChartRef.current = vc;
      const vs = vc.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
      vs.setData(extractVolume(data) as any);
      vc.timeScale().fitContent();
      syncTimeScales(chartRef.current, vc);
    }

    if (hasRSI && rsiContainerRef.current) {
      const rc = createChart(rsiContainerRef.current, subChartOptions(rsiContainerRef.current));
      rsiChartRef.current = rc;
      const rsiData = calculateRSI(data, hasRSI.period || 14);
      const rs = rc.addLineSeries({ color: '#a855f7', lineWidth: 2 as any });
      rs.setData(rsiData as any);
      // Overbought/oversold lines
      rs.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      rs.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      rc.timeScale().fitContent();
      syncTimeScales(chartRef.current, rc);
    }

    if (hasMACD && macdContainerRef.current) {
      const mc = createChart(macdContainerRef.current, subChartOptions(macdContainerRef.current));
      macdChartRef.current = mc;
      const macdData = calculateMACD(data);
      const macdLine = mc.addLineSeries({ color: '#3b82f6', lineWidth: 2 as any });
      const signalLine = mc.addLineSeries({ color: '#f97316', lineWidth: 1 });
      const histogram = mc.addHistogramSeries({ });
      macdLine.setData(macdData.map(d => ({ time: d.time as any, value: d.macd })));
      signalLine.setData(macdData.map(d => ({ time: d.time as any, value: d.signal })));
      histogram.setData(macdData.map(d => ({ time: d.time as any, value: d.histogram, color: d.histogram >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' })));
      mc.timeScale().fitContent();
      syncTimeScales(chartRef.current, mc);
    }
  };

  const applyMainIndicator = (ind: IndicatorConfig, data: OHLC[]) => {
    if (!chartRef.current) return;
    let seriesData: { time: number; value: number }[] = [];

    switch (ind.type) {
      case 'sma':
        seriesData = calculateSMA(data, ind.period || 20);
        break;
      case 'ema':
        seriesData = calculateEMA(data, ind.period || 20);
        break;
      case 'vwap':
        seriesData = calculateVWAP(data);
        break;
      case 'bollinger': {
        const bb = calculateBollinger(data, ind.period || 20, 2);
        // Upper band
        const upper = chartRef.current.addLineSeries({ color: 'rgba(139,92,246,0.5)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        upper.setData(bb.map(b => ({ time: b.time as any, value: b.upper })));
        indicatorSeriesRef.current.set(ind.id + '_upper', upper);
        // Lower band
        const lower = chartRef.current.addLineSeries({ color: 'rgba(139,92,246,0.5)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        lower.setData(bb.map(b => ({ time: b.time as any, value: b.lower })));
        indicatorSeriesRef.current.set(ind.id + '_lower', lower);
        // Middle
        const middle = chartRef.current.addLineSeries({ color: 'rgba(139,92,246,0.3)', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        middle.setData(bb.map(b => ({ time: b.time as any, value: b.middle })));
        indicatorSeriesRef.current.set(ind.id + '_middle', middle);
        return;
      }
    }

    if (seriesData.length > 0) {
      const series = chartRef.current.addLineSeries({
        color: ind.color || '#ffffff',
        lineWidth: 2 as any,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(seriesData as any);
      indicatorSeriesRef.current.set(ind.id, series);
    }
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

    if (chartType === 'line' || chartType === 'area') {
      (seriesRef.current as any).update({ time: candleTime, value: ltp });
    } else {
      // Get the last bar from the series to maintain proper candle OHLC
      // We track current live candle state in a ref to avoid using day H/L
      const prevLiveCandle = liveBarRef.current;
      let updatedBar: { time: number; open: number; high: number; low: number; close: number };

      if (!prevLiveCandle || prevLiveCandle.time !== candleTime) {
        // New candle — open at current LTP
        updatedBar = { time: candleTime, open: ltp, high: ltp, low: ltp, close: ltp };
      } else {
        // Update existing live candle
        updatedBar = {
          time: candleTime,
          open: prevLiveCandle.open,
          high: Math.max(prevLiveCandle.high, ltp),
          low: Math.min(prevLiveCandle.low, ltp),
          close: ltp,
        };
      }

      liveBarRef.current = updatedBar;
      (seriesRef.current as any).update(updatedBar);
    }
  }, [quote?.ltp]);

  const handleToggleIndicator = useCallback((id: string) => {
    setIndicators(prev => prev.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i));
  }, []);

  const handleUpdatePeriod = useCallback((id: string, period: number) => {
    setIndicators(prev => prev.map(i => i.id === id ? { ...i, period, label: `${i.type.toUpperCase()} ${period}` } : i));
  }, []);

  const spread = quote ? (quote.high - quote.low) : 0;
  const hasRSI = indicators.find(i => i.id === 'rsi' && i.enabled);
  const hasMACD = indicators.find(i => i.id === 'macd' && i.enabled);
  const hasVolume = indicators.find(i => i.id === 'volume' && i.enabled);

  return (
    <div className={cn('h-full flex flex-col bg-[#0d0f15]', isFullscreen && 'fixed inset-0 z-50')}>
      {/* Symbol Context Bar — Enhanced */}
      {activeSymbol && (
        <div className="h-[30px] min-h-[30px] flex items-center px-3 gap-4 border-b border-fw-border/40 bg-[#10121a] text-[11px]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-fw-text text-[13px]">{activeSymbol.symbol}</span>
            <span className="text-[9px] text-fw-text-muted bg-[#141720] px-1.5 py-0.5 rounded font-medium">{activeSymbol.exchange}</span>
          </div>
          {quote && (
            <>
              <span className={cn('font-mono font-black text-[14px] tabular-nums', quote.changePercent >= 0 ? 'text-green' : 'text-red')}>{formatPrice(quote.ltp)}</span>
              <span className={cn('text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded tabular-nums', quote.changePercent >= 0 ? 'text-green bg-green-dim' : 'text-red bg-red-dim')}>
                {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent?.toFixed(2)}%
              </span>
              <div className="w-px h-3.5 bg-fw-border/30" />
              <div className="flex items-center gap-2.5 text-[10px]">
                <span className="text-fw-text-muted">O <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{formatPrice(quote.open || quote.ltp)}</span></span>
                <span className="text-fw-text-muted">H <span className="font-mono tabular-nums text-green font-medium">{formatPrice(quote.high || quote.ltp)}</span></span>
                <span className="text-fw-text-muted">L <span className="font-mono tabular-nums text-red font-medium">{formatPrice(quote.low || quote.ltp)}</span></span>
                <span className="text-fw-text-muted">C <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{formatPrice(quote.close || quote.ltp)}</span></span>
              </div>
              <div className="w-px h-3.5 bg-fw-border/30" />
              <span className="text-fw-text-muted text-[10px]">Vol <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{quote.volume ? (quote.volume / 100000).toFixed(2) + 'L' : '—'}</span></span>
              {spread > 0 && (
                <>
                  <div className="w-px h-3.5 bg-fw-border/30" />
                  <span className="text-fw-text-muted text-[10px]">Spread <span className="font-mono tabular-nums text-fw-text-secondary font-medium">{formatPrice(spread)}</span></span>
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
            className={cn('px-1.5 py-0.5 text-[10px] rounded font-medium transition-all', timeframe === tf ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover')}>
            {timeframeToLabel(tf)}
          </button>
        ))}
        <div className="w-px h-4 bg-fw-border/40 mx-1" />
        {CHART_TYPES.map((ct) => (
          <button key={ct.value} onClick={() => setChartType(ct.value as ChartType)} title={ct.label}
            className={cn('px-1.5 py-0.5 text-[9px] rounded font-medium transition-all', chartType === ct.value ? 'bg-fw-hover text-fw-text' : 'text-fw-text-muted hover:text-fw-text')}>
            {ct.label}
          </button>
        ))}
        <div className="w-px h-4 bg-fw-border/40 mx-1" />
        {/* Indicators Dropdown */}
        <IndicatorPanel indicators={indicators} onToggle={handleToggleIndicator} onUpdatePeriod={handleUpdatePeriod} />
        {/* Drawing Tools Dropdown */}
        <DrawingTools activeMode={drawingMode} onModeChange={setDrawingMode} onClearAll={clearAllDrawings} drawingCount={drawings.length} />
        <div className="flex-1" />
        <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1 rounded text-fw-text-muted hover:text-fw-text hover:bg-fw-hover transition-colors" title="Fullscreen">
          <Maximize2 size={12} />
        </button>
      </div>

      {/* Chart Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 relative" ref={chartContainerRef}>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f15]/80 z-10">
              <div className="w-4 h-4 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!activeSymbol && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-[12px] text-fw-text-secondary">Select a symbol</p>
                <p className="text-[10px] text-fw-text-muted mt-1">Ctrl+K to search</p>
              </div>
            </div>
          )}
          {activeSymbol && noData && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-fw-hover flex items-center justify-center text-fw-text-muted text-lg">📡</div>
                <p className="text-[12px] text-fw-text-secondary font-medium">Chart data unavailable</p>
                <p className="text-[10px] text-fw-text-muted">Market feed reconnecting…</p>
                <button
                  onClick={loadChartData}
                  className="mt-1 px-3 py-1 rounded text-[10px] bg-fw-accent/20 hover:bg-fw-accent/40 text-fw-accent border border-fw-accent/30 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {drawingMode !== 'none' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-fw-accent/90 text-white text-[10px] font-medium">
              {drawingMode === 'hline' ? 'Click to set price level' : drawingMode === 'text' ? 'Click to place text' : `Click point ${drawClicksRef.current.length + 1} of 2`}
            </div>
          )}
        </div>
        {/* Sub-chart panes */}
        {hasVolume && <div ref={volumeContainerRef} className="h-[60px] min-h-[60px] border-t border-fw-border/30" />}
        {hasRSI && <div ref={rsiContainerRef} className="h-[80px] min-h-[80px] border-t border-fw-border/30" />}
        {hasMACD && <div ref={macdContainerRef} className="h-[80px] min-h-[80px] border-t border-fw-border/30" />}
      </div>
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

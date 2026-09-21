"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type UTCTimestamp,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { bucketSeconds, fetchCandles, type Candle, type MarketId, type Tick, type Timeframe } from "@/lib/marketData";

const toBar = (c: Candle): CandlestickData<UTCTimestamp> => ({ ...c, time: c.time as UTCTimestamp });

export function PriceChart({
  market,
  timeframe,
  tick,
  onLoadingChange,
}: {
  market: MarketId;
  timeframe: Timeframe;
  tick: Tick | null;
  onLoadingChange: (loading: boolean) => void;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Last bar on the chart; null while history for the current market/timeframe loads.
  const lastBarRef = useRef<Candle | null>(null);

  // Create the chart + series once; the data source is swapped separately below.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#888",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)" },
        horzLines: { color: "rgba(255, 255, 255, 0.05)" },
      },
      width: container.clientWidth,
      height: container.clientHeight,
      timeScale: { timeVisible: true, borderVisible: false },
      rightPriceScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal }, // free crosshair — pro-terminal feel
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load history for the market + timeframe. Superseded requests are aborted.
  useEffect(() => {
    const controller = new AbortController();
    lastBarRef.current = null;
    onLoadingChange(true);

    fetchCandles(market, timeframe, controller.signal)
      .then((candles) => {
        if (controller.signal.aborted || !seriesRef.current) return;
        seriesRef.current.setData(candles.map(toBar));
        chartRef.current?.timeScale().fitContent();
        lastBarRef.current = candles.length ? { ...candles[candles.length - 1] } : null;
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error("Coinbase candles fetch failed:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) onLoadingChange(false);
      });

    return () => controller.abort();
  }, [market, timeframe, onLoadingChange]);

  // Roll live ticks into the current candle, or open a new one at the bucket boundary.
  useEffect(() => {
    const last = lastBarRef.current;
    if (!tick || tick.market !== market || !last || !seriesRef.current) return;

    const bucket = bucketSeconds(timeframe);
    const time = Math.floor(tick.time / bucket) * bucket;
    if (time < last.time) return; // never send an older bar — lightweight-charts throws

    const bar: Candle =
      time === last.time
        ? { ...last, high: Math.max(last.high, tick.price), low: Math.min(last.low, tick.price), close: tick.price }
        : { time, open: last.close, high: Math.max(last.close, tick.price), low: Math.min(last.close, tick.price), close: tick.price };

    seriesRef.current.update(toBar(bar));
    lastBarRef.current = bar;
  }, [tick, market, timeframe]);

  return <div ref={chartContainerRef} className="absolute inset-0 h-full w-full min-h-[400px]" />;
}

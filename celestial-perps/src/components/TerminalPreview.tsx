import { TrendingUp, TrendingDown } from 'lucide-react';

/* ============================================================
   MOCK CANDLESTICK DATA
   ============================================================ */
const CANDLES = [
  { o: 40, c: 55, h: 60, l: 35 },
  { o: 55, c: 48, h: 58, l: 44 },
  { o: 48, c: 62, h: 65, l: 46 },
  { o: 62, c: 58, h: 68, l: 55 },
  { o: 58, c: 70, h: 75, l: 56 },
  { o: 70, c: 65, h: 74, l: 60 },
  { o: 65, c: 78, h: 82, l: 63 },
  { o: 78, c: 72, h: 80, l: 68 },
  { o: 72, c: 85, h: 88, l: 70 },
  { o: 85, c: 80, h: 90, l: 77 },
  { o: 80, c: 92, h: 95, l: 78 },
  { o: 92, c: 88, h: 96, l: 85 },
  { o: 88, c: 95, h: 100, l: 86 },
  { o: 95, c: 90, h: 98, l: 87 },
  { o: 90, c: 98, h: 105, l: 88 },
  { o: 98, c: 94, h: 102, l: 90 },
  { o: 94, c: 105, h: 110, l: 92 },
  { o: 105, c: 100, h: 108, l: 96 },
  { o: 100, c: 112, h: 115, l: 98 },
  { o: 112, c: 108, h: 116, l: 104 },
];

const ORDER_BOOK_BIDS = [
  { price: '2,247.82', size: '12.41', total: '27,894.21' },
  { price: '2,247.50', size: '8.22', total: '18,476.55' },
  { price: '2,247.10', size: '15.87', total: '35,644.58' },
  { price: '2,246.80', size: '6.33', total: '14,222.24' },
  { price: '2,246.40', size: '22.15', total: '49,757.76' },
];

const ORDER_BOOK_ASKS = [
  { price: '2,248.20', size: '9.54', total: '21,448.00' },
  { price: '2,248.60', size: '14.08', total: '31,660.29' },
  { price: '2,249.00', size: '5.71', total: '12,841.79' },
  { price: '2,249.50', size: '18.33', total: '41,233.34' },
  { price: '2,250.00', size: '11.29', total: '25,402.50' },
];

// Stable volume values (not regenerated on each render)
const VOLUME_VALUES = CANDLES.map(() => 20 + Math.random() * 80);

/* ============================================================
   CSS CANDLESTICK CHART
   ============================================================ */
function CandlestickChart() {
  const maxH = Math.max(...CANDLES.map((c) => c.h));
  const minL = Math.min(...CANDLES.map((c) => c.l));
  const range = maxH - minL;
  const chartH = 240;

  return (
    <div className="flex items-end gap-[4px] h-[240px] px-2">
      {CANDLES.map((c, i) => {
        const isGreen = c.c >= c.o;
        const bodyTop = ((maxH - Math.max(c.o, c.c)) / range) * chartH;
        const bodyBottom = ((maxH - Math.min(c.o, c.c)) / range) * chartH;
        const wickTop = ((maxH - c.h) / range) * chartH;
        const wickBottom = ((maxH - c.l) / range) * chartH;
        const bodyH = Math.max(bodyBottom - bodyTop, 2);

        return (
          <div key={i} className="relative flex-1 min-w-[8px]" style={{ height: chartH }}>
            {/* Wick */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-[1px]"
              style={{
                top: wickTop,
                height: wickBottom - wickTop,
                backgroundColor: isGreen ? '#22c55e' : '#ef4444',
                opacity: 0.8,
              }}
            />
            {/* Body */}
            <div
              className="absolute rounded-[2px]"
              style={{
                top: bodyTop,
                height: bodyH,
                width: '70%',
                left: '15%',
                backgroundColor: isGreen ? '#22c55e' : '#ef4444',
                opacity: 1,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   ORDER BOOK
   ============================================================ */
function OrderBook() {
  return (
    <div className="flex flex-col gap-1 text-[11px] font-mono tracking-tight">
      {/* Asks (red) */}
      {ORDER_BOOK_ASKS.slice().reverse().map((row, i) => (
        <div key={`ask-${i}`} className="grid grid-cols-3 gap-2 px-3 py-[4px] relative group hover:bg-white/[0.02]">
          <div className="absolute inset-0 bg-red-500/10" style={{ width: `${30 + i * 12}%` }} />
          <span className="text-red-400 relative z-10">{row.price}</span>
          <span className="text-white/60 text-right relative z-10">{row.size}</span>
          <span className="text-white/30 text-right relative z-10">{row.total}</span>
        </div>
      ))}

      {/* Spread */}
      <div className="flex items-center justify-center py-3 border-y border-white/5 my-1">
        <span className="text-emerald-400 font-bold text-sm">2,248.01</span>
        <span className="text-white/40 ml-2 text-[10px] uppercase">Spread 0.38</span>
      </div>

      {/* Bids (green) */}
      {ORDER_BOOK_BIDS.map((row, i) => (
        <div key={`bid-${i}`} className="grid grid-cols-3 gap-2 px-3 py-[4px] relative group hover:bg-white/[0.02]">
          <div className="absolute inset-0 bg-emerald-500/10 right-auto" style={{ width: `${60 - i * 10}%` }} />
          <span className="text-emerald-400 relative z-10">{row.price}</span>
          <span className="text-white/60 text-right relative z-10">{row.size}</span>
          <span className="text-white/30 text-right relative z-10">{row.total}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   LONG/SHORT FORM
   ============================================================ */
function TradeForm() {
  return (
    <div className="flex flex-col gap-5 p-5">
      {/* Long / Short toggle */}
      <div className="flex rounded-xl overflow-hidden bg-black border border-white/10 p-1">
        <button className="flex-1 py-2 text-xs font-bold bg-emerald-500 text-black rounded-lg flex items-center justify-center gap-1.5 shadow-sm">
          <TrendingUp className="w-4 h-4" /> Long
        </button>
        <button className="flex-1 py-2 text-xs font-bold text-white/50 flex items-center justify-center gap-1.5 hover:text-white transition-colors">
          <TrendingDown className="w-4 h-4" /> Short
        </button>
      </div>

      {/* Size input */}
      <div>
        <label className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2 block">Size (USDC)</label>
        <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 hover:border-white/20 transition-colors">
          <input
            type="text"
            defaultValue="10,000.00"
            readOnly
            className="bg-transparent text-white font-bold text-base flex-1 outline-none"
          />
          <span className="text-white/50 text-xs font-bold bg-white/5 px-2 py-1 rounded">USDC</span>
        </div>
      </div>

      {/* Leverage slider */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Leverage</label>
          <span className="text-emerald-400 font-black text-sm">20x</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/10 relative">
          <div className="h-full w-[40%] bg-emerald-500 rounded-full" />
          <div className="absolute top-1/2 -translate-y-1/2 left-[40%] -translate-x-1/2 w-4 h-4 rounded-full bg-white border-[3px] border-emerald-500 shadow-lg" />
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-white/40 font-bold">
          <span>1x</span><span>10x</span><span>25x</span><span>50x</span>
        </div>
      </div>

      {/* Execute button */}
      <button className="w-full py-4 mt-2 rounded-xl bg-white text-black font-black text-sm hover:bg-neutral-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
        Long ETH-PERP
      </button>
    </div>
  );
}

/* ============================================================
   TERMINAL PREVIEW SECTION
   ============================================================ */
export default function TerminalPreview() {
  return (
    <section id="terminal" className="terminal-section relative w-full px-6 lg:px-12 py-32 max-w-[1400px] mx-auto z-10">
      
      {/* Editorial Header */}
      <div className="text-center mb-24 max-w-3xl mx-auto scroll-reveal">
        <h2 className="text-[3rem] md:text-[4.5rem] font-black tracking-tightest text-[#111111] leading-[1]">
          The Terminal.
        </h2>
        <p className="text-xl text-neutral-500 font-medium leading-relaxed mt-6">
          A high-fidelity, zero-latency interface built for professionals.
        </p>
      </div>

      {/* Terminal Mockup - Premium Dark Interface */}
      <div
        data-animate="terminal-mock"
        className="w-full bg-[#0a0a0a] rounded-[2rem] border border-black/10 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.15)] overflow-hidden"
      >
        {/* Top Window Bar */}
        <div className="flex items-center px-6 py-4 border-b border-white/[0.05] bg-white/[0.02]">
          <div className="flex gap-2 mr-6">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
          </div>
          <div className="flex gap-6 text-xs font-bold text-white/40">
            <span className="text-white">Trade</span>
            <span className="hover:text-white cursor-pointer transition-colors">Positions (2)</span>
            <span className="hover:text-white cursor-pointer transition-colors">Orders</span>
          </div>
        </div>

        {/* Main Terminal Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px_300px] divide-x divide-white/[0.05]">
          
          {/* Chart Area */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#627EEA]/10 flex items-center justify-center border border-[#627EEA]/20">
                    <div className="w-4 h-4 rounded-full bg-[#627EEA]" />
                  </div>
                  <span className="text-white font-black text-2xl tracking-tight">ETH-PERP</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-emerald-400 text-xl font-black tracking-tight">$2,248.01</span>
                </div>
              </div>
              <div className="flex gap-2">
                {['1m', '5m', '15m', '1H', '4H', '1D'].map((tf) => (
                  <button
                    key={tf}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      tf === '1H'
                        ? 'bg-white/10 text-white'
                        : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <CandlestickChart />

            <div className="flex items-end gap-[4px] h-[40px] px-2 mt-2">
              {CANDLES.map((c, i) => {
                const isGreen = c.c >= c.o;
                return (
                  <div
                    key={i}
                    className="flex-1 min-w-[8px] rounded-t-[2px]"
                    style={{
                      height: `${VOLUME_VALUES[i]}%`,
                      backgroundColor: isGreen ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Order Book */}
          <div className="hidden lg:flex flex-col">
            <div className="px-4 py-4 border-b border-white/[0.05]">
              <span className="text-xs font-bold text-white/50 tracking-tight">Order Book</span>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 py-2 border-b border-white/[0.05]">
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">Price</span>
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider text-right">Size</span>
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider text-right">Total</span>
            </div>
            <div className="pt-2">
              <OrderBook />
            </div>
          </div>

          {/* Trade Form */}
          <div className="hidden lg:flex flex-col bg-white/[0.01]">
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <span className="text-xs font-bold text-white/50 tracking-tight">Place Order</span>
            </div>
            <TradeForm />
          </div>
        </div>
      </div>
    </section>
  );
}

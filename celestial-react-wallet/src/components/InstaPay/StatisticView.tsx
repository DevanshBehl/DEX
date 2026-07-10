import { useState } from 'react';

export function StatisticView() {
  const [primaryTab, setPrimaryTab] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  const [timeRange, setTimeRange] = useState<'D' | 'W' | 'M' | 'Y'>('M');

  return (
    <div className="flex-1 w-full flex flex-col min-h-0 bg-[#161618] text-white overflow-y-auto pb-[100px] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-6">
        <button className="w-10 h-10 rounded-full bg-[#1B1D22] flex items-center justify-center border border-[#3A3D46]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <h1 className="text-lg font-semibold">Statics</h1>
        <button className="w-10 h-10 rounded-full bg-[#1B1D22] flex items-center justify-center border border-[#3A3D46]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
        </button>
      </div>

      {/* Primary Tabs */}
      <div className="px-6 mb-8">
        <div className="flex bg-[#1B1D22] p-1.5 rounded-full border border-[#282A31]">
          {['Daily', 'Weekly', 'Monthly'].map(tab => (
            <button
              key={tab}
              onClick={() => setPrimaryTab(tab as any)}
              className={`flex-1 py-3 text-sm font-semibold rounded-full transition-colors ${primaryTab === tab ? 'bg-[#D4FF00] text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Total Balance & Chart container */}
      <div className="px-6">
        <div className="bg-[#1B1D22] rounded-3xl p-6 border border-[#282A31]">
          <div className="flex items-start justify-between mb-6">
            <div className="flex flex-col">
              <span className="text-zinc-400 text-sm mb-1">Total</span>
              <span className="text-4xl font-bold tracking-tight">$67,545.23</span>
            </div>
            <button className="w-10 h-10 rounded-full bg-[#282A31] flex items-center justify-center text-[#D4FF00]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
            </button>
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center justify-between mb-8">
            {['D', 'W', 'M', 'Y'].map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range as any)}
                className={`w-14 py-2 rounded-xl text-sm font-medium transition-all ${timeRange === range ? 'bg-[#D4FF00]/10 text-[#D4FF00] border border-[#D4FF00]' : 'bg-[#282A31] text-zinc-400 border border-transparent hover:text-white'}`}
              >
                {range}
              </button>
            ))}
          </div>

          {/* Chart Area */}
          <div className="relative h-40 w-full flex items-end justify-between px-2 pt-4">
            {/* Background Grid Lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-8 pt-4">
              <div className="w-full border-b border-zinc-800/50 border-dashed relative"><span className="absolute -top-3 -left-2 text-[10px] text-zinc-500">$30K</span></div>
              <div className="w-full border-b border-zinc-800/50 border-dashed relative"><span className="absolute -top-3 -left-2 text-[10px] text-zinc-500">$20K</span></div>
              <div className="w-full border-b border-zinc-800/50 border-dashed relative"><span className="absolute -top-3 -left-2 text-[10px] text-zinc-500">$10K</span></div>
              <div className="w-full border-b border-zinc-800/50 border-dashed relative"><span className="absolute -top-3 -left-2 text-[10px] text-zinc-500">$0K</span></div>
            </div>

            {/* Bars */}
            {[
              { label: 'Jan', height: '40%' },
              { label: 'Feb', height: '55%' },
              { label: 'Mar', height: '85%', active: true },
              { label: 'Apr', height: '45%' },
              { label: 'May', height: '60%' },
              { label: 'Jun', height: '35%' },
            ].map((bar, i) => (
              <div key={i} className="flex flex-col items-center z-10 w-8">
                <div 
                  className={`w-full rounded-t-lg transition-all duration-500 ${bar.active ? 'bg-[#D4FF00] shadow-[0_0_15px_rgba(212,255,0,0.5)]' : 'bg-[#282A31]'}`}
                  style={{ height: bar.height }}
                ></div>
                <span className="text-[10px] text-zinc-500 mt-2 font-medium">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Cards */}
      <div className="px-6 mt-6 flex gap-4">
        <div className="flex-1 bg-[#1B1D22] rounded-3xl p-5 border border-[#282A31] flex flex-col">
          <div className="w-8 h-8 rounded-full bg-[#282A31] flex items-center justify-center text-[#D4FF00] mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          </div>
          <span className="text-zinc-400 text-xs mb-1">Total Withdrawal</span>
          <span className="text-lg font-bold">$ 60,500</span>
        </div>

        <div className="flex-1 bg-[#1B1D22] rounded-3xl p-5 border border-[#282A31] flex flex-col">
          <div className="w-8 h-8 rounded-full bg-[#282A31] flex items-center justify-center text-[#D4FF00] mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </div>
          <span className="text-zinc-400 text-xs mb-1">Total Deposit</span>
          <span className="text-lg font-bold">$ 20,500</span>
        </div>
      </div>
      
      {/* Spacer cards just to show there's more content in scroll, matching image partially */}
      <div className="px-6 mt-4 flex gap-4 mb-4">
        <div className="flex-1 bg-[#1B1D22] rounded-3xl p-5 border border-[#282A31] flex flex-col">
          <div className="w-8 h-8 rounded-full bg-[#282A31] flex items-center justify-center text-[#D4FF00] mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
        </div>
        <div className="flex-1 bg-[#1B1D22] rounded-3xl p-5 border border-[#282A31] flex flex-col">
          <div className="w-8 h-8 rounded-full bg-[#282A31] flex items-center justify-center text-[#D4FF00] mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
        </div>
      </div>
    </div>
  );
}

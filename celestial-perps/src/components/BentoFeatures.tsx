import { Wallet, Check, Sparkles, Zap, Smartphone } from 'lucide-react';

export default function BentoFeatures() {
  return (
    <section id="features" className="relative w-full px-6 lg:px-24 py-32 max-w-[1400px] mx-auto z-10">
      
      {/* Editorial Header */}
      <div className="text-center mb-24 max-w-3xl mx-auto scroll-reveal">
        <h2 className="text-[3rem] md:text-[4.5rem] font-black tracking-tightest text-[#111111] leading-[1]">
          Everything you need. <br className="hidden md:block" />
          <span className="text-neutral-400">Nothing you don't.</span>
        </h2>
      </div>

      {/* Feature 1: Seamless Execution */}
      <div className="editorial-card w-full flex flex-col md:flex-row items-center p-8 md:p-16 mb-8 scroll-reveal gap-12 overflow-hidden relative">
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#ab9ff2]/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="flex-1 z-10">
          <div className="w-14 h-14 rounded-2xl bg-[#f5f5f5] flex items-center justify-center mb-8 border border-black/5 shadow-sm">
            <Zap className="w-6 h-6 text-[#111111]" />
          </div>
          <h3 className="text-4xl md:text-5xl font-black tracking-tightest text-[#111111] mb-6">
            Zero friction <br />execution.
          </h3>
          <p className="text-xl text-neutral-500 font-medium leading-relaxed mb-8 max-w-lg">
            Say goodbye to constant signature popups. Our session key architecture lets you trade as seamlessly as a centralized exchange, while retaining 100% custody of your funds.
          </p>
          <ul className="flex flex-col gap-4">
            {['One-click trades', 'No gas fees on execution', 'Instant sub-second finality'].map((item) => (
              <li key={item} className="flex items-center gap-3 text-[#111111] font-bold text-lg">
                <Check className="w-5 h-5 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        
        {/* Abstract Mockup UI */}
        <div className="flex-1 w-full flex justify-center md:justify-end z-10">
          <div className="relative w-full max-w-[400px] h-[450px] bg-[#ffffff] rounded-3xl border border-black/5 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.05)] p-6 overflow-hidden transform rotate-2 hover:rotate-0 transition-transform duration-500">
            {/* Mock Header */}
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#111111]">Session Active</div>
                  <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-widest">Connected</div>
                </div>
              </div>
              <div className="w-8 h-4 bg-emerald-500 rounded-full relative">
                <div className="absolute right-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-sm" />
              </div>
            </div>
            
            {/* Mock Trade Action */}
            <div className="bg-[#fcfcfc] rounded-2xl p-4 border border-black/5 mb-4">
              <div className="text-xs font-bold text-neutral-400 mb-2 uppercase tracking-wide">Market Buy</div>
              <div className="text-3xl font-black text-[#111111] tracking-tight mb-1">5.42 ETH</div>
              <div className="text-sm font-medium text-neutral-500">~ $12,430.50</div>
            </div>
            
            <button className="w-full py-4 bg-[#111111] rounded-xl text-white font-bold text-lg shadow-lg flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5" /> Execute Instantly
            </button>
            
            {/* Subtle overlay blur */}
            <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-white to-transparent" />
          </div>
        </div>
      </div>

      {/* Feature 2: Universal Liquidity */}
      <div className="editorial-card w-full flex flex-col md:flex-row-reverse items-center p-8 md:p-16 scroll-reveal gap-12 overflow-hidden relative bg-[#fafafa]">
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#22c55e]/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="flex-1 z-10">
          <div className="w-14 h-14 rounded-2xl bg-[#ffffff] flex items-center justify-center mb-8 border border-black/5 shadow-sm">
            <Smartphone className="w-6 h-6 text-[#111111]" />
          </div>
          <h3 className="text-4xl md:text-5xl font-black tracking-tightest text-[#111111] mb-6">
            Any wallet. <br />Any chain.
          </h3>
          <p className="text-xl text-neutral-500 font-medium leading-relaxed mb-8 max-w-lg">
            We don't care what you use. Connect via MetaMask, Phantom, Rabby, or WalletConnect. Trade unified liquidity sourced across Solana, Ethereum, and beyond.
          </p>
          
          <div className="flex gap-4 flex-wrap">
            {['MetaMask', 'Phantom', 'Coinbase', 'Rabby'].map((w) => (
              <div key={w} className="px-5 py-2.5 bg-white rounded-full border border-black/5 shadow-sm text-sm font-bold text-[#111111]">
                {w}
              </div>
            ))}
          </div>
        </div>
        
        {/* Abstract Abstract Graphic */}
        <div className="flex-1 w-full flex justify-center md:justify-start z-10">
          <div className="relative w-full max-w-[450px] h-[400px] flex items-center justify-center">
            {/* Floating connecting nodes */}
            <div className="absolute w-[250px] h-[250px] rounded-[3rem] border border-black/10 flex items-center justify-center animate-spin-slow" style={{ animationDuration: '40s' }}>
              <div className="absolute top-[-10px] w-5 h-5 bg-blue-500 rounded-full shadow-lg shadow-blue-500/20" />
              <div className="absolute bottom-[-10px] w-5 h-5 bg-purple-500 rounded-full shadow-lg shadow-purple-500/20" />
              <div className="absolute right-[-10px] w-5 h-5 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/20" />
            </div>
            
            <div className="w-[180px] h-[180px] bg-white rounded-[2rem] border border-black/5 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] z-10 flex items-center justify-center relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-br from-neutral-100 to-white" />
               <h4 className="relative z-10 text-5xl font-black tracking-tighter text-[#111111]">∞</h4>
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}

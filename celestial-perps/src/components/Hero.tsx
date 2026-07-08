import { ArrowRight, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';

function HeroBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Abstract floating elements animation
      gsap.to('.hero-float-1', {
        y: -30,
        x: 20,
        rotation: 15,
        duration: 8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
      gsap.to('.hero-float-2', {
        y: 40,
        x: -30,
        rotation: -10,
        duration: 10,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: -2,
      });
      gsap.to('.hero-float-3', {
        y: -50,
        x: -20,
        scale: 1.1,
        duration: 12,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: -4,
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
      {/* Very subtle static grid */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      
      {/* Grid mask for fading out edges */}
      <div className="absolute inset-0 bg-gradient-to-b from-white via-transparent to-white" />
      <div className="absolute inset-0 bg-gradient-to-r from-white via-transparent to-white" />

      {/* Floating Abstract Celestial Rings (Ultra subtle) */}
      <div className="hero-float-1 absolute w-[800px] h-[800px] rounded-full border border-[#111111]/5 top-[-100px] left-[-200px]" />
      <div className="hero-float-2 absolute w-[600px] h-[600px] rounded-full border border-[#ab9ff2]/10 bottom-[-100px] right-[-100px]" />
      <div className="hero-float-3 absolute w-[1000px] h-[1000px] rounded-full border border-[#22c55e]/5 top-[20%] left-[30%]" />
      
      {/* Glowing connection nodes */}
      <div className="hero-float-1 absolute w-3 h-3 bg-[#111] rounded-full shadow-[0_0_20px_rgba(0,0,0,0.2)] top-[20%] left-[15%]" />
      <div className="hero-float-2 absolute w-2 h-2 bg-[#ab9ff2] rounded-full shadow-[0_0_15px_#ab9ff2] bottom-[30%] right-[20%]" />
      <div className="hero-float-3 absolute w-4 h-4 bg-[#22c55e] rounded-full shadow-[0_0_25px_#22c55e] top-[40%] right-[30%]" />
    </div>
  );
}

export default function Hero() {
  return (
    <section className="relative flex flex-col items-center justify-center text-center px-6 lg:px-24 pt-32 pb-24 min-h-[95vh] w-full max-w-[1400px]">
      
      <HeroBackground />

      {/* Phantom-style badge */}
      <div
        data-animate="hero-badge"
        className="relative z-10 mb-10 inline-flex items-center gap-2 px-5 py-2 rounded-full border border-black/[0.08] bg-white shadow-sm text-sm font-semibold text-[#555] hover:shadow-md transition-all cursor-pointer hover:border-black/20"
      >
        <Sparkles className="w-4 h-4 text-emerald-500" />
        <span className="text-[#111]">Introducing Celestial V1</span> — The new standard
      </div>

      {/* Massive Headline */}
      <h1
        data-animate="hero-headline"
        className="relative z-10 text-[4rem] sm:text-[5.5rem] md:text-[7rem] lg:text-[8rem] font-black tracking-tightest leading-[0.9] mb-8 text-[#111111] max-w-5xl"
      >
        Trade crypto. <br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#111111] to-[#888888]">
          Without the custody.
        </span>
      </h1>

      {/* Elegant Subheadline */}
      <p
        data-animate="hero-sub"
        className="relative z-10 text-xl md:text-[1.35rem] text-[#666666] max-w-[800px] mx-auto leading-relaxed font-medium mb-12 tracking-tight"
      >
        Access institutional-grade liquidity, up to <strong className="font-bold text-[#111]">50x leverage</strong>, and sub-second execution directly from your wallet. No sign-ups. No limits.
      </p>

      {/* Premium Buttons */}
      <div className="relative z-10 flex gap-4 flex-wrap justify-center">
        <a
          data-animate="hero-cta"
          href="https://chromewebstore.google.com"
          className="btn-phantom group text-lg px-8 py-4"
        >
          Download Wallet
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </a>
        <a
          data-animate="hero-cta"
          href="https://app.celestial.exchange"
          className="btn-outline-phantom text-lg px-8 py-4"
        >
          Launch Terminal
        </a>
      </div>

      {/* Floating stats with clean dividers */}
      <div data-animate="hero-stats" className="relative z-10 mt-28 grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-0 max-w-4xl mx-auto w-full pt-12">
        {[
          { value: '$2.4B+', label: 'Volume Traded' },
          { value: '50x', label: 'Max Leverage' },
          { value: '<0.5s', label: 'Execution Time' },
        ].map((stat, i) => (
          <div key={stat.label} className={`flex flex-col items-center ${i !== 2 ? 'md:border-r border-black/5' : ''}`}>
            <span className="text-4xl md:text-5xl font-black text-[#111111] tracking-tighter mb-2">{stat.value}</span>
            <span className="text-sm font-bold text-[#888] tracking-widest uppercase">{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}


import { useNavigate } from 'react-router-dom';

const NETWORK_LOGOS = [
  // 1. Solana (SOL) - Green/Purple
  <svg viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl">
    <defs>
      <linearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#14F195" />
        <stop offset="100%" stopColor="#9945FF" />
      </linearGradient>
    </defs>
    <path d="M64 268l42-42h230l-42 42H64zm0-136l42-42h230l-42 42H64zm42 68l-42-42h230l42 42H106z" fill="url(#solGrad)" />
  </svg>,
  // 2. Bitcoin (BTC) - Orange
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full drop-shadow-xl">
    <circle cx="12" cy="12" r="11" fill="#F7931A" />
    <path fill="#FFF" d="M16.66 10.56c.22-1.46-1.14-2.25-2.85-2.84l.58-2.34-1.42-.35-.57 2.27c-.37-.09-.76-.18-1.14-.27l.58-2.3-1.43-.36-.58 2.33c-.3-.07-.6-.15-.89-.22L7.33 5.9l-.4 1.6s1.07.24 1.05.26c.58.15.69.53.67.83l-1.34 5.37c.05.01.12.03.2.06l-.21-.06-1.87 7.5c-.09.2-.33.32-.82.19.02.01-1.06-.26-1.06-.26l-1.12 1.7 2.05.51c.38.1.75.2 1.12.3l-.59 2.38 1.42.36.58-2.34c.39.1.76.19 1.14.28l-.58 2.34 1.43.35.6-2.39c2.37.45 4.14.27 4.9-1.92.6-1.76-.02-2.78-1.33-3.44.95-.22 1.66-.85 1.83-2.14zm-3.32 4.67c-1.01 4.07-7.85 1.96-10.07 1.4l1.8-7.22c2.22.55 9.3 2.14 8.27 5.82z" />
  </svg>,
  // 3. Ethereum (ETH) - Multi-color gradient
  <svg viewBox="0 0 256 417" fill="none" className="w-full h-full drop-shadow-xl">
    <defs>
      <linearGradient id="ethGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8A2BE2" />
        <stop offset="50%" stopColor="#4169E1" />
        <stop offset="100%" stopColor="#FF1493" />
      </linearGradient>
    </defs>
    <path fill="url(#ethGrad)" d="M127.96 0l-127.96 212.32 127.96 75.64 127.96-75.64z" />
    <path fill="url(#ethGrad)" opacity="0.7" d="M127.96 312.3l-127.96-100 127.96 204.45 127.96-204.45z" />
  </svg>,
  // 4. Arbitrum (ARB) - Blue
  <svg viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl">
    <path d="M200 40L40 340h80l80-150 80 150h80L200 40z" fill="#28A0F0" />
    <circle cx="200" cy="270" r="40" fill="#28A0F0" />
  </svg>,
  // 5. Sui (SUI) - Teal
  <svg viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl">
    <path d="M200 20C100.59 20 20 100.59 20 200s80.59 180 180 180 180-80.59 180-180S299.41 20 200 20zm0 280c-55.23 0-100-44.77-100-100s44.77-100 100-100 100 44.77 100 100-44.77 100-100 100z" fill="#4CA2FF" />
    <path d="M200 120L150 200h100L200 120z" fill="#4CA2FF" />
  </svg>
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="w-full flex-1 flex flex-col items-center">
      {/* Semicircle of Logos (Behind Content) */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] pointer-events-none z-0 blur-[2px] opacity-80">
        {NETWORK_LOGOS.map((logo, i) => {
          // Create a top-facing semi-circle arching over the title (-180 to 0 degrees)
          const angles = [-170, -135, -90, -45, -10];
          const radiusX = 450;
          const radiusY = 250;
          const angleRad = angles[i] * (Math.PI / 180);
          const x = Math.cos(angleRad) * radiusX;
          const y = Math.sin(angleRad) * radiusY;
          
          return (
            <div 
              key={i} 
              className="absolute w-20 h-20 md:w-28 md:h-28 animate-float"
              style={{ 
                left: `calc(50% + ${x}px - 56px)`, 
                top: `calc(40% + ${y}px - 56px)`, 
                animationDelay: `${i * 0.8}s` 
              }}
            >
              {logo}
            </div>
          );
        })}
      </div>

      <div className="relative z-10 flex flex-col items-center w-full pt-32 pb-24 px-6 lg:px-24 text-center">
        {/* Hero Section */}
        <div className="mb-12 w-full max-w-4xl" style={{ animation: 'fade-in-up 0.8s ease-out forwards' }}>
          <h1 className="text-[5rem] md:text-[8rem] font-black tracking-tighter leading-[1.05] mb-8 text-black">
            Meet CELESTIAL.
          </h1>
          <p className="text-xl md:text-2xl text-neutral-500 max-w-2xl mx-auto leading-relaxed font-medium">
            The next-generation non-custodial wallet. <br className="hidden md:block"/> Your keys. Your crypto. Your future.
          </p>
        </div>

        {/* Call to Action */}
        <div className="mb-32" style={{ animation: 'fade-in-up 0.8s ease-out forwards', animationDelay: '0.2s', opacity: 0 }}>
          <button 
            onClick={() => navigate('/onboarding')}
            className="px-10 py-5 bg-black text-white text-xl font-bold rounded-2xl hover:bg-neutral-800 transition-all hover:-translate-y-1 active:scale-95 shadow-2xl shadow-black/20 group relative overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2">
              Create Wallet
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-1 transition-transform"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </span>
            <div className="absolute inset-0 bg-white/20 blur-xl group-hover:scale-150 transition-transform duration-500 rounded-2xl" />
          </button>
        </div>

        {/* Project Details Grid */}
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-8 text-left mb-32" style={{ animation: 'fade-in-up 0.8s ease-out forwards', animationDelay: '0.4s', opacity: 0 }}>
          
          <div className="glass-card p-8 flex flex-col gap-4 group hover:border-black/20 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-black/5 rounded-full blur-3xl group-hover:bg-black/10 transition-colors" />
            <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </div>
            <h3 className="text-2xl font-bold text-black tracking-tight">Fully Non-Custodial</h3>
            <p className="text-neutral-500 leading-relaxed font-medium">
              We never have access to your funds or private keys. You are in complete control of your crypto assets at all times.
            </p>
          </div>

          <div className="glass-card p-8 flex flex-col gap-4 group hover:border-black/20 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-black/5 rounded-full blur-3xl group-hover:bg-black/10 transition-colors" />
            <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            </div>
            <h3 className="text-2xl font-bold text-black tracking-tight">Multi-Chain Native</h3>
            <p className="text-neutral-500 leading-relaxed font-medium">
              Seamlessly manage assets across Ethereum, Solana, and Bitcoin from a single unified interface. No network switching required.
            </p>
          </div>

          <div className="glass-card p-8 flex flex-col gap-4 group hover:border-black/20 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-black/5 rounded-full blur-3xl group-hover:bg-black/10 transition-colors" />
            <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <h3 className="text-2xl font-bold text-black tracking-tight">Military-Grade Security</h3>
            <p className="text-neutral-500 leading-relaxed font-medium">
              Your recovery phrase is encrypted locally using AES-256-GCM and protected by 600,000 PBKDF2 iterations.
            </p>
          </div>

        </div>

        {/* Under the Hood Section */}
        <div className="w-full max-w-5xl flex flex-col items-center gap-16 py-16">
          <div className="text-center max-w-2xl" style={{ animation: 'fade-in-up 0.8s ease-out forwards', animationDelay: '0.6s', opacity: 0 }}>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-black mb-6">Under the Hood</h2>
            <p className="text-lg text-neutral-500 leading-relaxed font-medium">
              Celestial is engineered from the ground up to provide maximum security without compromising on user experience. Here's how it works.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 w-full text-left">
            <div className="flex flex-col gap-6" style={{ animation: 'slide-in-right 0.8s ease-out forwards', animationDelay: '0.8s', opacity: 0 }}>
              <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center shadow-xl shadow-black/10">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
              </div>
              <div>
                <h4 className="text-2xl font-bold text-black mb-3">Modern Web Architecture</h4>
                <p className="text-neutral-500 leading-relaxed font-medium">
                  Built on React and Vite, the Celestial web portal offers a blazing-fast, strictly-typed onboarding experience. The UI is completely decoupled from the sensitive key-management extension.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6" style={{ animation: 'slide-in-right 0.8s ease-out forwards', animationDelay: '1.0s', opacity: 0 }}>
              <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center shadow-xl shadow-black/10">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <div>
                <h4 className="text-2xl font-bold text-black mb-3">Local Extension Bridging</h4>
                <p className="text-neutral-500 leading-relaxed font-medium">
                  When you create a wallet, your vault is securely passed directly to the Celestial browser extension via isolated <code className="bg-black/5 px-2 py-0.5 rounded text-black text-sm">postMessage</code> channels. The web portal instantly discards all sensitive data.
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="site-footer w-full relative bg-black pt-16 pb-8 px-6 lg:px-24 overflow-hidden mt-24">
      {/* Ambient glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-white/5 rounded-full blur-2xl pointer-events-none" />

      <div data-animate="footer-content" className="relative z-10 max-w-7xl mx-auto">
        {/* Main footer grid */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between border-b border-white/10 pb-12 mb-8 gap-10 md:gap-0">
          {/* Brand */}
          <div className="flex flex-col gap-4 max-w-sm">
            <h2 className="text-3xl font-black text-white tracking-tighter">CELESTIAL.</h2>
            <p className="text-sm text-neutral-400 leading-relaxed font-medium">
              The decentralized perpetuals exchange for the Celestial ecosystem. Non-custodial, cross-chain, and built for professional traders.
            </p>
          </div>

          {/* Link columns */}
          <div className="flex gap-16 md:gap-20">
            <div className="flex flex-col gap-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.15em] mb-1">Product</span>
              <a href="https://app.celestial.exchange" className="text-sm text-neutral-400 hover:text-white transition-colors font-medium relative group">
                App
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
              </a>
              <a href="https://celestial.exchange/wallet" className="text-sm text-neutral-400 hover:text-white transition-colors font-medium relative group">
                Wallet
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
              </a>
              <a href="https://docs.celestial.exchange" className="text-sm text-neutral-400 hover:text-white transition-colors font-medium relative group">
                Docs
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
              </a>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.15em] mb-1">Community</span>
              <a href="https://twitter.com/celestial" className="text-sm text-neutral-400 hover:text-white transition-colors font-medium relative group">
                Twitter
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
              </a>
              <a href="https://discord.gg/celestial" className="text-sm text-neutral-400 hover:text-white transition-colors font-medium relative group">
                Discord
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
              </a>
              <a href="https://github.com/celestial" className="text-sm text-neutral-400 hover:text-white transition-colors font-medium relative group">
                GitHub
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
              </a>
            </div>
          </div>

          {/* Builder credit (matching celestial-landing) */}
          <div className="flex flex-col items-start md:items-end gap-3">
            <span className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-1">Engineering & Design</span>
            <div className="flex items-center gap-3 bg-white/5 pr-4 pl-1 py-1 rounded-full border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 group cursor-default">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-neutral-800 to-black border border-white/20 flex items-center justify-center overflow-hidden group-hover:scale-110 transition-transform">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <span className="text-sm font-bold text-white tracking-tight">Devansh Behl</span>
            </div>

            {/* Social icons */}
            <div className="flex items-center gap-4 mt-2">
              <a href="#" className="text-neutral-400 hover:text-white transition-colors hover:-translate-y-1 transform duration-200">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
              </a>
              <a href="#" className="text-neutral-400 hover:text-white transition-colors hover:-translate-y-1 transform duration-200">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>
              </a>
              <a href="#" className="text-neutral-400 hover:text-white transition-colors hover:-translate-y-1 transform duration-200">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between text-xs font-medium text-neutral-500 gap-4 md:gap-0">
          <p>© {new Date().getFullYear()} Celestial Perps. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors relative group">
              Terms of Service
              <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
            </a>
            <a href="#" className="hover:text-white transition-colors relative group">
              Privacy Policy
              <span className="absolute -bottom-1 left-0 w-0 h-px bg-white transition-all group-hover:w-full" />
            </a>
          </div>
        </div>

        {/* Risk disclaimer */}
        <p className="text-center text-[11px] text-neutral-600 mt-6 max-w-lg mx-auto leading-relaxed">
          Decentralized trading involves significant risk. This platform is non-custodial. You are solely responsible for your funds and trading decisions.
        </p>
      </div>
    </footer>
  );
}

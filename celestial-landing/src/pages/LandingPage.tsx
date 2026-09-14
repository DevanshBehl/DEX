import { useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { ShieldCheck, Layers, Zap, ArrowRight, ArrowUpRight, ArrowDownLeft, Lock, Key, Smartphone, Repeat, Check, Sparkles, Terminal, Shield } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';

/* ============================================================
   REALISTIC WALLET MOCKUP DATA
   ============================================================ */
const TOKENS = [
  { name: 'Ethereum', symbol: 'ETH', balance: '12.4821', usd: '$43,687.35', change: '+3.2%', color: '#627EEA', icon: (
    <svg viewBox="0 0 256 417" className="w-full h-full"><path fill="#627EEA" d="M127.96 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z"/><path fill="#627EEA" opacity=".6" d="M127.962 0L0 212.32l127.962 75.639V154.158z"/><path fill="#627EEA" d="M127.96 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z"/><path fill="#627EEA" opacity=".6" d="M127.962 416.905v-104.72L0 236.585z"/></svg>
  )},
  { name: 'Solana', symbol: 'SOL', balance: '284.19', usd: '$42,628.50', change: '+5.1%', color: '#14F195', icon: (
    <svg viewBox="0 0 400 400" className="w-full h-full"><defs><linearGradient id="sg1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#14F195"/><stop offset="100%" stopColor="#9945FF"/></linearGradient></defs><path d="M64 268l42-42h230l-42 42H64zm0-136l42-42h230l-42 42H64zm42 68l-42-42h230l42 42H106z" fill="url(#sg1)"/></svg>
  )},
  { name: 'Bitcoin', symbol: 'BTC', balance: '0.5847', usd: '$38,276.15', change: '+1.8%', color: '#F7931A', icon: (
    <svg viewBox="0 0 64 64" className="w-full h-full"><circle cx="32" cy="32" r="32" fill="#F7931A"/><path fill="#fff" d="M46.1 27.4c.6-4.1-2.5-6.3-6.8-7.8l1.4-5.6-3.4-.8-1.4 5.4c-.9-.2-1.8-.4-2.7-.7l1.4-5.5-3.4-.8-1.4 5.6c-.7-.2-1.5-.4-2.2-.5l-4.7-1.2-1 3.6s2.5.6 2.5.6c1.4.3 1.6 1.3 1.6 2l-1.6 6.4c.1 0 .2 0 .3.1l-.3-.1-2.2 8.9c-.2.4-.6 1.1-1.6.8 0 0-2.5-.6-2.5-.6l-1.7 3.9 4.4 1.1c.8.2 1.6.4 2.4.6l-1.4 5.7 3.4.8 1.4-5.6c.9.3 1.8.5 2.7.7l-1.4 5.6 3.4.8 1.4-5.7c5.8 1.1 10.1.7 12-4.6 1.5-4.3 0-6.7-3.2-8.3 2.3-.5 4-2.1 4.4-5.2zM38 36.7c-1.1 4.3-8.2 2-10.5 1.4l1.9-7.5c2.3.6 9.7 1.7 8.6 6.1zm1-9.4c-1 3.9-6.9 1.9-8.8 1.4l1.7-6.8c1.9.5 8.1 1.4 7.1 5.4z"/></svg>
  )},
];

const NETWORK_LOGOS = [
  <svg key="sol" viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl"><defs><linearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#14F195" /><stop offset="100%" stopColor="#9945FF" /></linearGradient></defs><path d="M64 268l42-42h230l-42 42H64zm0-136l42-42h230l-42 42H64zm42 68l-42-42h230l42 42H106z" fill="url(#solGrad)" /></svg>,
  <svg key="btc" viewBox="0 0 64 64" fill="none" className="w-full h-full drop-shadow-xl"><circle cx="32" cy="32" r="32" fill="#F7931A" /><path fill="#fff" d="M46.1 27.4c.6-4.1-2.5-6.3-6.8-7.8l1.4-5.6-3.4-.8-1.4 5.4c-.9-.2-1.8-.4-2.7-.7l1.4-5.5-3.4-.8-1.4 5.6c-.7-.2-1.5-.4-2.2-.5l-4.7-1.2-1 3.6s2.5.6 2.5.6c1.4.3 1.6 1.3 1.6 2l-1.6 6.4c.1 0 .2 0 .3.1l-.3-.1-2.2 8.9c-.2.4-.6 1.1-1.6.8 0 0-2.5-.6-2.5-.6l-1.7 3.9 4.4 1.1c.8.2 1.6.4 2.4.6l-1.4 5.7 3.4.8 1.4-5.6c.9.3 1.8.5 2.7.7l-1.4 5.6 3.4.8 1.4-5.7c5.8 1.1 10.1.7 12-4.6 1.5-4.3 0-6.7-3.2-8.3 2.3-.5 4-2.1 4.4-5.2zM38 36.7c-1.1 4.3-8.2 2-10.5 1.4l1.9-7.5c2.3.6 9.7 1.7 8.6 6.1zm1-9.4c-1 3.9-6.9 1.9-8.8 1.4l1.7-6.8c1.9.5 8.1 1.4 7.1 5.4z"/></svg>,
  <svg key="eth" viewBox="0 0 256 417" fill="none" className="w-full h-full drop-shadow-xl"><path fill="#627EEA" d="M127.96 0l-127.96 212.32 127.96 75.64 127.96-75.64z" /><path fill="#627EEA" opacity="0.6" d="M127.96 312.3l-127.96-100 127.96 204.45 127.96-204.45z" /></svg>,
  <svg key="arb" viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl"><path d="M200 40L40 340h80l80-150 80 150h80L200 40z" fill="#28A0F0" /><circle cx="200" cy="270" r="40" fill="#28A0F0" /></svg>,
  <svg key="sui" viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl"><path d="M200 20C100.59 20 20 100.59 20 200s80.59 180 180 180 180-80.59 180-180S299.41 20 200 20zm0 280c-55.23 0-100-44.77-100-100s44.77-100 100-100 100 44.77 100 100-44.77 100-100 100z" fill="#4CA2FF" /><path d="M200 120L150 200h100L200 120z" fill="#4CA2FF" /></svg>,
];

/* ============================================================
   INTERACTIVE WALLET MOCKUP COMPONENT
   ============================================================ */
function WalletMockup() {
  const [activeTab, setActiveTab] = useState<'tokens' | 'activity'>('tokens');
  const [hoveredToken, setHoveredToken] = useState<number | null>(null);

  return (
    <div className="w-full max-w-[380px] bg-gradient-to-b from-neutral-950 to-black rounded-[2rem] shadow-[0_60px_120px_-20px_rgba(0,0,0,0.5)] overflow-hidden border border-white/10 relative">
      {/* Top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      
      {/* Header */}
      <div className="px-6 pt-8 pb-6 flex flex-col items-center">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 p-[2px]">
            <div className="w-full h-full bg-neutral-950 rounded-full flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-gradient-to-tr from-blue-400 to-purple-400" />
            </div>
          </div>
          <span className="text-white/60 text-sm font-semibold">Account 1</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" opacity="0.4"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        <motion.h2 
          className="text-white text-4xl font-black tracking-tight"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          $124,592.00
        </motion.h2>
        <motion.p 
          className="text-emerald-400 font-bold text-sm mt-1 flex items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <ArrowUpRight className="w-3.5 h-3.5" /> +$2,847.20 (2.4%) today
        </motion.p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-4 gap-3 px-6 pb-6">
        {[
          { icon: <ArrowUpRight className="w-5 h-5" />, label: 'Send' },
          { icon: <ArrowDownLeft className="w-5 h-5" />, label: 'Receive' },
          { icon: <Repeat className="w-5 h-5" />, label: 'Swap' },
          { icon: <ArrowRight className="w-5 h-5" />, label: 'Bridge' },
        ].map((action, i) => (
          <motion.div 
            key={action.label}
            className="flex flex-col items-center gap-1.5 cursor-pointer group"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.08 }}
          >
            <div className="w-12 h-12 rounded-2xl bg-white/8 border border-white/10 flex items-center justify-center text-white group-hover:bg-white/15 group-hover:border-white/20 transition-all group-hover:scale-105">
              {action.icon}
            </div>
            <span className="text-[11px] font-semibold text-white/50 group-hover:text-white/80 transition-colors">{action.label}</span>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex px-6 border-b border-white/8">
        {(['tokens', 'activity'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors relative ${
              activeTab === tab ? 'text-white' : 'text-white/30 hover:text-white/50'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Token List */}
      <div className="px-4 py-3 flex flex-col gap-1">
        {TOKENS.map((token, i) => (
          <motion.div
            key={token.symbol}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 + i * 0.1 }}
            onHoverStart={() => setHoveredToken(i)}
            onHoverEnd={() => setHoveredToken(null)}
            className={`flex items-center gap-3 px-3 py-3.5 rounded-xl cursor-pointer transition-all duration-200 ${
              hoveredToken === i ? 'bg-white/8' : 'bg-transparent'
            }`}
          >
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-white/5 p-1.5">
              {token.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-sm">{token.name}</span>
                <span className="text-white font-bold text-sm">{token.usd}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-white/40 text-xs font-medium">{token.balance} {token.symbol}</span>
                <span className="text-emerald-400 text-xs font-semibold">{token.change}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      {/* Bottom safe area */}
      <div className="h-6" />
    </div>
  );
}

/* ============================================================
   SECURITY VAULT VISUAL
   ============================================================ */
function SecurityVault() {
  return (
    <div className="w-full aspect-square max-w-[520px] relative flex items-center justify-center rounded-[3rem] bg-gradient-to-br from-neutral-50 to-white border border-neutral-200/60 shadow-[0_8px_60px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
      {/* Subtle grid pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

      {/* Concentric rings — clean thin lines, no dots */}
      <motion.div
        className="absolute w-[85%] h-[85%] rounded-full border border-neutral-200/60"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="absolute w-[65%] h-[65%] rounded-full border border-neutral-200/80"
        animate={{ rotate: -360 }}
        transition={{ duration: 45, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="absolute w-[45%] h-[45%] rounded-full border border-neutral-300/80"
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
      />

      {/* Subtle pulsing ring */}
      <motion.div
        className="absolute w-[55%] h-[55%] rounded-full border border-black/5"
        animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Center lock */}
      <motion.div
        className="relative z-10 w-32 h-32 md:w-36 md:h-36 bg-black rounded-full flex items-center justify-center shadow-xl"
        whileHover={{ scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent" />
        <Lock className="w-12 h-12 md:w-14 md:h-14 text-white relative z-10" />
      </motion.div>

      {/* Floating security labels */}
      {[
        { label: 'AES-256', top: '10%', left: '8%', delay: 0 },
        { label: 'PBKDF2', top: '14%', right: '6%', delay: 0.15 },
        { label: 'Local Only', bottom: '14%', left: '6%', delay: 0.3 },
        { label: 'Zero-Knowledge', bottom: '10%', right: '4%', delay: 0.45 },
      ].map((item, i) => (
        <motion.div
          key={i}
          className="absolute px-3.5 py-1.5 bg-white rounded-full text-[11px] font-bold text-neutral-700 border border-neutral-200 shadow-sm flex items-center gap-1.5"
          style={{ top: item.top, left: item.left, right: (item as any).right, bottom: (item as any).bottom }}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: item.delay + 0.4, duration: 0.5, type: 'spring', stiffness: 200 }}
          viewport={{ once: true }}
        >
          <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-emerald-600" />
          </div>
          {item.label}
        </motion.div>
      ))}
    </div>
  );
}

/* ============================================================
   AGENT WALLET MOCKUP COMPONENT
   ============================================================ */
function AgentWalletMockup() {
  const [messages, setMessages] = useState([
    { role: 'user', content: 'Buy 1 ETH on Base using USDC' },
    { role: 'agent', content: 'Analyzing intent & finding best route...', thinking: true },
  ]);

  useEffect(() => {
    const timer1 = setTimeout(() => {
      setMessages(prev => [
        prev[0],
        { role: 'agent', content: "I've found the optimal route for your swap via Uniswap V3 on Base.", executionDetails: true, thinking: false }
      ]);
    }, 3000);

    return () => clearTimeout(timer1);
  }, []);

  return (
    <div className="w-full max-w-[500px] h-[400px] bg-white rounded-[2rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)] overflow-hidden border border-slate-200/60 relative flex flex-col">
      {/* Top Bar */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800 leading-tight">Celestial AI</div>
            <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Agent Active</div>
          </div>
        </div>
        <div className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          Desktop Mode
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 p-5 flex flex-col gap-4 overflow-hidden relative bg-slate-50/30">
        {messages.map((msg, i) => (
          <motion.div 
            key={i}
            className={`max-w-[85%] ${msg.role === 'user' ? 'self-end bg-indigo-500 text-white rounded-2xl rounded-tr-sm' : msg.thinking ? 'self-start text-slate-500' : 'self-start w-full bg-white border border-slate-200 rounded-2xl rounded-tl-sm shadow-sm z-10'} px-4 py-3 text-sm`}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            {msg.thinking ? (
              <div className="flex items-center gap-2 text-xs font-semibold">
                <div className="flex gap-1">
                  <motion.div className="w-1.5 h-1.5 bg-slate-300 rounded-full" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} />
                  <motion.div className="w-1.5 h-1.5 bg-slate-300 rounded-full" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} />
                  <motion.div className="w-1.5 h-1.5 bg-slate-300 rounded-full" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} />
                </div>
                {msg.content}
              </div>
            ) : (
              <>
                <div className={msg.role === 'agent' ? 'text-slate-700 font-medium mb-3' : 'font-medium'}>{msg.content}</div>
                {msg.executionDetails && (
                  <>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Pay</span>
                        <span className="font-bold text-slate-800">3,452.10 USDC</span>
                      </div>
                      <div className="h-px w-full bg-slate-200 my-1" />
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Receive</span>
                        <span className="font-bold text-emerald-600">1.00 ETH</span>
                      </div>
                    </div>
                    <motion.div 
                      className="mt-4 w-full bg-indigo-500 hover:bg-indigo-600 text-white text-center py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-colors"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Confirm Execution
                    </motion.div>
                  </>
                )}
              </>
            )}
          </motion.div>
        ))}
      </div>
      
      {/* Bottom Input Area */}
      <div className="px-5 py-4 border-t border-slate-100 bg-white relative z-20">
        <div className="w-full bg-slate-50 border border-slate-200 rounded-full px-4 py-3 flex items-center justify-between text-sm text-slate-400">
          <span>Type your intent...</span>
          <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white">
            <ArrowUpRight className="w-3 h-3" />
          </div>
        </div>
      </div>
    </div>
  );
}


/* ============================================================
   MULTI-CHAIN VISUAL
   ============================================================ */
function MultiChainVisual() {
  const chains = [
    { name: 'Ethereum', symbol: 'ETH', balance: '12.48 ETH', usd: '$43,687', color: '#627EEA', gradient: 'from-[#627EEA]/20' },
    { name: 'Solana', symbol: 'SOL', balance: '284.19 SOL', usd: '$42,628', color: '#14F195', gradient: 'from-[#14F195]/20' },
    { name: 'Bitcoin', symbol: 'BTC', balance: '0.58 BTC', usd: '$38,276', color: '#F7931A', gradient: 'from-[#F7931A]/20' },
  ];

  return (
    <div className="w-full max-w-[500px] flex flex-col gap-3">
      {chains.map((chain, i) => (
        <motion.div
          key={chain.symbol}
          initial={{ opacity: 0, x: i % 2 === 0 ? -40 : 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 + i * 0.15, duration: 0.6 }}
          whileHover={{ scale: 1.02, x: 8 }}
          className={`w-full p-5 rounded-2xl bg-gradient-to-r ${chain.gradient} to-transparent border border-black/5 cursor-pointer transition-shadow hover:shadow-xl group`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: chain.color + '20' }}>
              <div className="w-6 h-6 rounded-full" style={{ backgroundColor: chain.color }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-black text-base">{chain.name}</span>
                <span className="font-black text-black text-base">{chain.usd}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-neutral-500 text-sm font-medium">{chain.balance}</span>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-emerald-600 text-xs font-bold">Connected</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* ============================================================
   3D TILT CARD WRAPPER
   ============================================================ */
function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [8, -8]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-8, 8]), { stiffness: 300, damping: 30 });

  function handleMouse(e: React.MouseEvent) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }
  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================================================
   COUNTER ANIMATION
   ============================================================ */
function AnimatedCounter({ target, prefix = '', suffix = '' }: { target: number; prefix?: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          let start = 0;
          const step = target / 60;
          const timer = setInterval(() => {
            start += step;
            if (start >= target) {
              setCount(target);
              clearInterval(timer);
            } else {
              setCount(Math.floor(start));
            }
          }, 16);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, hasAnimated]);

  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
}

/* ============================================================
   LANDING PAGE
   ============================================================ */
export default function LandingPage() {
  const navigate = useNavigate();

  const fadeInUp = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as any } }
  };
  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.15 } }
  };

  return (
    <div className="w-full flex-1 flex flex-col items-center overflow-x-hidden">
      {/* Ambient morphing blobs */}
      <div className="absolute top-[-200px] right-[-200px] w-[600px] h-[600px] bg-gradient-to-br from-indigo-200/30 via-purple-200/20 to-pink-200/30 glow-blob pointer-events-none blur-3xl" />
      <div className="absolute top-[400px] left-[-300px] w-[500px] h-[500px] bg-gradient-to-tr from-blue-200/20 via-cyan-200/15 to-emerald-200/20 glow-blob pointer-events-none blur-3xl" style={{ animationDelay: '2s' }} />

      {/* Ambient background logos */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] pointer-events-none z-0 blur-[2px] opacity-80">
        {NETWORK_LOGOS.map((logo, i) => {
          const angles = [-170, -135, -90, -45, -10];
          const radiusX = 450;
          const radiusY = 250;
          const angleRad = angles[i] * (Math.PI / 180);
          const cx = Math.cos(angleRad) * radiusX;
          const cy = Math.sin(angleRad) * radiusY;
          return (
            <motion.div
              key={i}
              className="absolute w-20 h-20 md:w-28 md:h-28"
              style={{ left: `calc(50% + ${cx}px - 56px)`, top: `calc(40% + ${cy}px - 56px)` }}
              animate={{ y: [0, -15, 0], rotate: [0, 3, 0] }}
              transition={{ duration: 6 + i * 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.6 }}
            >
              {logo}
            </motion.div>
          );
        })}
      </div>

      <div className="relative z-10 flex flex-col items-center w-full pt-32 pb-24 px-6 lg:px-24 text-center">

        {/* ============ HERO ============ */}
        <motion.div
          className="mb-12 w-full max-w-5xl flex flex-col items-center"
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} variants={staggerContainer}
        >
          <motion.h1 variants={fadeInUp} className="text-[5rem] md:text-[8rem] font-black tracking-tighter leading-[1.05] mb-8 text-black">
            Meet <br /> CELESTIAL.
          </motion.h1>
          <motion.p variants={fadeInUp} className="text-xl md:text-2xl text-neutral-500 max-w-2xl mx-auto leading-relaxed font-medium mb-12">
            The next-generation non-custodial wallet. <br className="hidden md:block" /> Your keys. Your crypto. Your future.
          </motion.p>
          <motion.div variants={fadeInUp} className="flex gap-4 flex-wrap justify-center">
            <button
              onClick={() => navigate('/onboarding')}
              className="px-10 py-5 bg-black text-white text-xl font-bold rounded-2xl hover:bg-neutral-800 transition-all hover:-translate-y-1 active:scale-95 shadow-2xl shadow-black/20 group relative overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-2">
                Get Started
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
              <div className="absolute inset-0 bg-white/10 blur-xl group-hover:scale-150 transition-transform duration-500 rounded-2xl" />
            </button>
            <button className="px-10 py-5 bg-transparent text-black text-xl font-bold rounded-2xl border-2 border-black/10 hover:border-black/30 hover:bg-black/5 transition-all hover:-translate-y-1">
              View Docs
            </button>
          </motion.div>
        </motion.div>

        {/* ============ WALLET MOCKUP HERO ============ */}
        <motion.div
          initial={{ opacity: 0, y: 120, scale: 0.88, rotateX: 15 }}
          whileInView={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] as any, delay: 0.15 }}
          viewport={{ once: true }}
          className="relative mb-40 mt-8"
          style={{ perspective: '1200px' }}
        >
          {/* Morphing glow blob behind card */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-gradient-to-br from-blue-400/25 via-purple-400/20 to-pink-400/15 glow-blob pointer-events-none blur-[80px]" />
          
          {/* Floating sparkle particles */}
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-black/20 rounded-full"
              style={{ top: `${15 + Math.random() * 70}%`, left: `${10 + Math.random() * 80}%` }}
              animate={{ y: [0, -30, 0], opacity: [0, 1, 0], scale: [0, 1.5, 0] }}
              transition={{ duration: 3 + Math.random() * 2, repeat: Infinity, delay: i * 0.7, ease: 'easeInOut' }}
            />
          ))}
          
          <TiltCard className="relative z-10">
            <WalletMockup />
          </TiltCard>
        </motion.div>

        {/* ============ STATS BAR ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="w-full max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-8 mb-40 py-12 border-y border-neutral-100"
        >
          {[
            { value: 3, suffix: '+', label: 'Blockchains' },
            { value: 256, suffix: '-bit', label: 'AES Encryption' },
            { value: 600, suffix: 'K', label: 'PBKDF2 Iterations' },
            { value: 100, suffix: '%', label: 'Non-Custodial' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="flex flex-col items-center"
            >
              <span className="text-4xl md:text-5xl font-black text-black tracking-tight">
                <AnimatedCounter target={stat.value} suffix={stat.suffix} />
              </span>
              <span className="text-sm font-semibold text-neutral-400 mt-2">{stat.label}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* ============ FEATURE 1: SELF-CUSTODY ============ */}
        <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-16 md:gap-24 mb-40 md:mb-56">
          <motion.div
            initial={{ opacity: 0, x: -60 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any }}
            className="flex-1 text-left flex flex-col items-start"
          >
            <div className="w-14 h-14 rounded-2xl bg-black flex items-center justify-center mb-6 shadow-lg">
              <ShieldCheck className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-4xl md:text-[3.5rem] font-black tracking-tighter text-black mb-6 leading-[1.1]">
              Self-custody,<br />without the anxiety.
            </h2>
            <p className="text-lg md:text-xl text-neutral-500 leading-relaxed font-medium mb-8 max-w-lg">
              Your private keys are encrypted and stored solely on your local device. Not even Celestial developers can access your funds — ever.
            </p>
            <ul className="flex flex-col gap-3">
              {['No tracking or KYC required', 'Open-source cryptographic primitives', 'Full control over your recovery phrase'].map((item, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-center gap-3 text-neutral-600 font-semibold"
                >
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-emerald-600" />
                  </div>
                  {item}
                </motion.li>
              ))}
            </ul>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any, delay: 0.2 }}
            className="flex-1 w-full flex items-center justify-center"
          >
            <SecurityVault />
          </motion.div>
        </div>

        {/* ============ FEATURE 2: MULTI-CHAIN ============ */}
        <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row-reverse items-center gap-16 md:gap-24 mb-40 md:mb-56">
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any }}
            className="flex-1 text-left flex flex-col items-start"
          >
            <div className="w-14 h-14 rounded-2xl bg-black flex items-center justify-center mb-6 shadow-lg">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-4xl md:text-[3.5rem] font-black tracking-tighter text-black mb-6 leading-[1.1]">
              One wallet.<br />Every blockchain.
            </h2>
            <p className="text-lg md:text-xl text-neutral-500 leading-relaxed font-medium mb-8 max-w-lg">
              Forget switching networks and juggling multiple extensions. All your assets, across all chains, in one beautiful interface.
            </p>
            <ul className="flex flex-col gap-3">
              {['Native Solana & EVM support', 'Auto-network detection for DApps', 'Unified portfolio tracking'].map((item, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-center gap-3 text-neutral-600 font-semibold"
                >
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-emerald-600" />
                  </div>
                  {item}
                </motion.li>
              ))}
            </ul>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -60 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any, delay: 0.2 }}
            className="flex-1 w-full flex items-center justify-center"
          >
            <MultiChainVisual />
          </motion.div>
        </div>

        {/* ============ FEATURE 3: CELESTIAL AI ============ */}
        <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-16 md:gap-24 mb-40 md:mb-56">
          <motion.div
            initial={{ opacity: 0, x: -60 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any }}
            className="flex-1 text-left flex flex-col items-start"
          >
            <div className="w-14 h-14 rounded-2xl bg-black flex items-center justify-center mb-6 shadow-lg">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-4xl md:text-[3.5rem] font-black tracking-tighter text-black mb-6 leading-[1.1]">
              Meet your new <br /> Autonomous Agent.
            </h2>
            <p className="text-lg md:text-xl text-neutral-500 leading-relaxed font-medium mb-8 max-w-lg">
              Don't execute trades manually. Express your intent to the Celestial AI and let it find the best routes, execute the swaps, and manage your portfolio across chains.
            </p>
            <ul className="flex flex-col gap-3">
              {['Intent-based swapping', 'Desktop-class interactive 800px dashboard', 'Strictly isolated agent vault'].map((item, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-center gap-3 text-neutral-600 font-semibold"
                >
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-emerald-600" />
                  </div>
                  {item}
                </motion.li>
              ))}
            </ul>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any, delay: 0.2 }}
            className="flex-1 w-full flex items-center justify-center relative perspective-[1200px]"
          >
            {/* Ambient glow behind agent wallet mockup */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-gradient-to-br from-purple-400/20 to-indigo-400/20 rounded-full blur-[80px] pointer-events-none" />
            <TiltCard className="relative z-10 w-full max-w-[500px]">
               <AgentWalletMockup />
            </TiltCard>
          </motion.div>
        </div>

        {/* ============ TECH GRID ============ */}
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} variants={staggerContainer}
          className="w-full max-w-6xl mb-32"
        >
          <motion.div variants={fadeInUp} className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter text-black mb-4">Military-Grade Engineering</h2>
            <p className="text-neutral-500 font-medium leading-relaxed text-lg">
              Designed from the ground up for absolute security and maximum performance.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            {[
              { icon: <Key className="w-7 h-7" />, title: 'AES-256-GCM', desc: 'Your recovery phrase is encrypted locally using the same standard trusted by the military and banks, protected by 600,000 PBKDF2 iterations.' },
              { icon: <Zap className="w-7 h-7" />, title: 'Vite & React 19', desc: 'The onboarding portal is built on a modern, blazing-fast web stack, providing instant feedback and strict type safety during key generation.' },
              { icon: <Smartphone className="w-7 h-7" />, title: 'Isolated Bridging', desc: 'Once generated, your encrypted vault is securely bridged to the browser extension via isolated postMessage channels. The web portal discards everything.' },
            ].map((card) => (
              <motion.div
                key={card.title}
                variants={fadeInUp}
                whileHover={{ y: -12, scale: 1.02, transition: { type: 'spring', stiffness: 400, damping: 25 } }}
                className="glass-card gradient-border p-8 flex flex-col gap-4 group hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.15)] transition-all cursor-default relative overflow-hidden rounded-3xl"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-indigo-500/5 via-purple-500/5 to-transparent rounded-full blur-3xl group-hover:from-indigo-500/15 group-hover:via-purple-500/10 transition-all pointer-events-none" />
                <motion.div
                  className="w-14 h-14 rounded-2xl bg-black/5 flex items-center justify-center text-black group-hover:bg-black group-hover:text-white transition-all duration-300"
                  whileHover={{ rotate: [0, -10, 10, 0] }}
                  transition={{ duration: 0.4 }}
                >
                  {card.icon}
                </motion.div>
                <h4 className="text-xl font-bold text-black">{card.title}</h4>
                <p className="text-neutral-500 font-medium leading-relaxed text-sm">{card.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ FINAL CTA ============ */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.95 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as any }}
          className="w-full max-w-4xl bg-black rounded-[2.5rem] p-12 md:p-20 text-center relative overflow-hidden mb-16"
        >
          {/* Animated ambient blobs */}
          <motion.div
            className="absolute top-[-100px] left-[-100px] w-[400px] h-[400px] bg-gradient-to-br from-indigo-500/20 via-purple-500/15 to-transparent rounded-full blur-[80px] pointer-events-none"
            animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-[-100px] right-[-100px] w-[350px] h-[350px] bg-gradient-to-tl from-pink-500/15 via-rose-500/10 to-transparent rounded-full blur-[80px] pointer-events-none"
            animate={{ x: [0, -40, 0], y: [0, -20, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <Sparkles className="w-8 h-8 text-white/40 mx-auto mb-6" />
          </motion.div>
          <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter mb-6 relative z-10">
            Ready to take control?
          </h2>
          <p className="text-lg text-white/60 font-medium max-w-lg mx-auto mb-10 leading-relaxed relative z-10">
            Set up your Celestial wallet in under 60 seconds. No email, no phone number, no compromises.
          </p>
          <motion.button
            onClick={() => navigate('/onboarding')}
            className="px-10 py-5 bg-white text-black text-xl font-bold rounded-2xl hover:bg-neutral-100 transition-all active:scale-95 shadow-2xl group relative z-10"
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <span className="flex items-center gap-2">
              Create Wallet
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
          </motion.button>
        </motion.div>

      </div>
    </div>
  );
}

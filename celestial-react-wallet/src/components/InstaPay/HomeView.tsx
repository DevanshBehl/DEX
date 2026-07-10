

export function HomeView() {
  return (
    <div className="flex-1 w-full flex flex-col min-h-0 bg-[#161618] text-white overflow-y-auto pb-[100px] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800">
            {/* Using a placeholder avatar image */}
            <img src="https://i.pravatar.cc/150?u=a042581f4e29026704d" alt="Profile" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col">
            <span className="text-zinc-400 text-xs">Good Morning</span>
            <span className="font-semibold text-lg leading-tight">Sajibur Rahman</span>
          </div>
        </div>
        <button className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 relative">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          {/* Notification dot */}
          <div className="absolute top-2.5 right-2.5 w-2 h-2 bg-[#D4FF00] rounded-full border-2 border-[#161618]"></div>
        </button>
      </div>

      {/* My Cards Section */}
      <div className="px-6 py-2 flex items-center justify-between">
        <h2 className="text-xl font-medium">My Cards</h2>
        <button className="text-zinc-400 text-sm font-medium hover:text-white transition-colors">
          Add Card +
        </button>
      </div>

      {/* Visa Card */}
      <div className="px-6 py-2">
        <div className="instapay-card w-full p-6 relative overflow-hidden flex flex-col justify-between" style={{ minHeight: '220px' }}>
          {/* Top Row: VISA Logo & Contactless */}
          <div className="flex items-center justify-between z-10">
            <div className="text-2xl font-black italic tracking-tighter text-[#0A2265]">
              VISA
            </div>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
              <polyline points="16 6 12 2 8 6"></polyline>
              <line x1="12" y1="2" x2="12" y2="15"></line>
            </svg>
          </div>

          {/* Card Number */}
          <div className="flex items-center gap-3 mt-4 mb-2 z-10 text-black/80 font-mono font-medium tracking-widest text-sm">
            <span>****</span>
            <span>****</span>
            <span>****</span>
            <span className="text-black font-bold">5466</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 opacity-50"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle><line x1="1" y1="1" x2="23" y2="23"></line></svg>
          </div>

          {/* Balance and Chip */}
          <div className="flex items-end justify-between z-10 mt-auto">
            <div className="flex flex-col">
              <span className="text-black/60 text-xs font-medium mb-1">Balance</span>
              <span className="text-[28px] font-bold tracking-tight leading-none">$786,898,67.00</span>
            </div>
            <div className="w-10 h-8 rounded border border-black/20 flex flex-col items-center justify-evenly bg-gradient-to-br from-white/40 to-white/10 overflow-hidden">
                <div className="w-full h-[1px] bg-black/20"></div>
                <div className="w-full h-[1px] bg-black/20"></div>
                <div className="w-full h-[1px] bg-black/20"></div>
            </div>
          </div>
          
          {/* Decorative Glow */}
          <div className="absolute top-[-50px] right-[-50px] w-48 h-48 bg-white opacity-20 rounded-full blur-[40px] pointer-events-none"></div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-6 py-6 flex items-center justify-between">
        {[
          { label: 'Deposit', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg> },
          { label: 'Withdrawal', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg> },
          { label: 'Loan', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg> },
          { label: 'Remit', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> }
        ].map((action, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <button className="w-14 h-14 rounded-2xl bg-[#282A31] border border-[#3A3D46] flex items-center justify-center text-white transition-transform active:scale-95 hover:bg-[#3A3D46]">
              {action.icon}
            </button>
            <span className="text-[11px] text-zinc-400 font-medium">{action.label}</span>
          </div>
        ))}
      </div>

      {/* Transactions */}
      <div className="px-6 py-2 flex items-center justify-between mb-4">
        <h2 className="text-xl font-medium">Transactions</h2>
        <button className="text-zinc-400 text-sm font-medium hover:text-white transition-colors">
          View All
        </button>
      </div>

      <div className="px-6 space-y-4 pb-6">
        {[
          { name: 'Henry James', time: '10:30 AM', amount: '+$450.00', type: 'Deposit', img: 'https://i.pravatar.cc/150?u=1' },
          { name: 'Chris Michael', time: '10:00 AM', amount: '+$250.00', type: 'Deposit', img: 'https://i.pravatar.cc/150?u=2' },
          { name: 'Dinesh Maisha', time: 'Yesterday', amount: '+$340.00', type: 'Deposit', img: 'https://i.pravatar.cc/150?u=3' },
        ].map((tx, i) => (
          <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-[#1B1D22]">
            <div className="flex items-center gap-3">
              <img src={tx.img} alt={tx.name} className="w-12 h-12 rounded-full object-cover" />
              <div className="flex flex-col">
                <span className="font-medium text-base">{tx.name}</span>
                <span className="text-zinc-500 text-xs">{tx.time}</span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-semibold text-base">{tx.amount}</span>
              <span className="text-zinc-500 text-xs">{tx.type}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

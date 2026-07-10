import { useState } from 'react';

interface SendMoneyViewProps {
  onBack: () => void;
}

export function SendMoneyView({ onBack }: SendMoneyViewProps) {
  const [amount, setAmount] = useState('6,342.49');
  
  const contacts = [
    { id: 1, name: 'Mahesh', img: 'https://i.pravatar.cc/150?u=4', selected: false },
    { id: 2, name: 'Dinesh', img: 'https://i.pravatar.cc/150?u=5', selected: true },
    { id: 3, name: 'Roshan', img: 'https://i.pravatar.cc/150?u=6', selected: false },
    { id: 4, name: 'Pradeep', img: 'https://i.pravatar.cc/150?u=7', selected: false },
  ];

  const quickAmounts = ['$50', '$100', '$500', '$1000', '$1500'];

  const keypad = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    '.', '0', 'backspace'
  ];

  const handleKeypadPress = (key: string) => {
    if (key === 'backspace') {
      setAmount(prev => prev.slice(0, -1));
    } else {
      // Very basic mock logic for keypad
      setAmount(prev => {
        const raw = prev.replace(/,/g, '');
        const newRaw = raw + key;
        return newRaw; // In reality we'd format with commas, but sticking to mock visual
      });
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col min-h-0 bg-[#161618] text-white animate-fade-in relative z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-6">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-[#1B1D22] flex items-center justify-center border border-[#3A3D46]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <h1 className="text-lg font-semibold">Send Money</h1>
        <button className="w-10 h-10 rounded-full bg-[#1B1D22] flex items-center justify-center border border-[#3A3D46]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-[100px] flex flex-col">
        {/* Contacts */}
        <div className="flex px-6 gap-4 overflow-x-auto mb-6 no-scrollbar">
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <button className="w-[52px] h-[52px] rounded-full border border-dashed border-zinc-500 flex items-center justify-center text-zinc-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <span className="text-[11px] text-zinc-400 font-medium">Add New</span>
          </div>

          {contacts.map(c => (
            <div key={c.id} className="flex flex-col items-center gap-2 flex-shrink-0 relative">
              <div className={`w-[52px] h-[52px] rounded-full overflow-hidden border-2 ${c.selected ? 'border-[#D4FF00]' : 'border-transparent'}`}>
                <img src={c.img} alt={c.name} className="w-full h-full object-cover" />
              </div>
              {c.selected && (
                <div className="absolute top-0 right-0 w-4 h-4 bg-[#D4FF00] rounded-full flex items-center justify-center text-black border-2 border-[#161618]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
              )}
              <span className={`text-[11px] font-medium ${c.selected ? 'text-white' : 'text-zinc-400'}`}>{c.name}</span>
            </div>
          ))}
        </div>

        {/* Amount Input Card */}
        <div className="px-6 mb-6">
          <div className="bg-[#1B1D22] rounded-3xl p-6 border border-[#282A31] flex flex-col items-center">
            {/* Card Selector */}
            <div className="flex items-center gap-2 bg-[#282A31] px-3 py-1.5 rounded-full mb-6">
              <div className="w-6 h-4 bg-[#D4FF00] rounded-[2px] relative overflow-hidden flex items-center justify-center">
                <span className="text-[5px] font-black italic text-[#0A2265]">VISA</span>
              </div>
              <span className="text-zinc-300 text-xs font-mono">**** 3425</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>

            {/* Amount */}
            <div className="flex items-center justify-center mb-2">
              <span className="text-4xl font-bold tracking-tight">$</span>
              <span className="text-4xl font-bold tracking-tight relative">
                {amount.split('.')[0]}
                <span className="text-white relative mx-0.5">
                   <span className="absolute -left-[1px] top-[10%] bottom-[10%] w-[2px] bg-[#D4FF00] animate-pulse"></span>
                  .
                </span>
                {amount.split('.')[1]}
              </span>
            </div>
            <span className="text-zinc-400 text-sm">Enter amount</span>
          </div>
        </div>

        {/* Quick Amounts */}
        <div className="px-6 flex items-center gap-2 mb-6 overflow-x-auto no-scrollbar">
          {quickAmounts.map(a => (
            <button key={a} className="px-5 py-2.5 rounded-full bg-[#1B1D22] border border-[#282A31] text-sm font-semibold flex-shrink-0 hover:bg-[#282A31] transition-colors">
              {a}
            </button>
          ))}
        </div>

        {/* Number Pad */}
        <div className="px-6 grid grid-cols-3 gap-3 mb-6 mt-auto">
          {keypad.map((key, i) => (
            <button
              key={i}
              onClick={() => handleKeypadPress(key)}
              className="h-16 rounded-2xl bg-[#282A31] text-xl font-medium flex items-center justify-center transition-transform active:scale-95 hover:bg-[#3A3D46]"
            >
              {key === 'backspace' ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="9" x2="18" y2="15"></line></svg>
              ) : (
                key
              )}
            </button>
          ))}
        </div>

        {/* Send Button */}
        <div className="px-6 pb-6">
          <button className="w-full bg-[#D4FF00] text-black font-bold py-4 rounded-2xl text-lg transition-transform active:scale-95 shadow-[0_0_20px_rgba(212,255,0,0.2)]">
            Send Money
          </button>
        </div>
      </div>
    </div>
  );
}

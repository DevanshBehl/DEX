import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface LandingPageProps {
  onSetupComplete: () => void;
}

export function LandingPage({ onSetupComplete }: LandingPageProps) {
  const [showQR, setShowQR] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[#1B1D22] text-white p-6 relative">
      {!showQR ? (
        <div className="flex flex-col items-center justify-center flex-1 w-full animate-fade-in">
          <div className="mb-12">
            <h1 className="text-5xl font-black italic tracking-tighter text-[#D4FF00] drop-shadow-[0_0_15px_rgba(212,255,0,0.5)]">
              InstaPay
            </h1>
          </div>
          
          <div className="mt-auto w-full pb-8">
            <button
              onClick={() => setShowQR(true)}
              className="w-full bg-[#D4FF00] text-black font-bold py-4 rounded-2xl text-lg transition-transform active:scale-95 hover:bg-[#E2FF46] shadow-[0_0_20px_rgba(212,255,0,0.3)]"
            >
              Setup a wallet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 w-full animate-slide-up bg-[#282A31] p-6 rounded-3xl shadow-2xl border border-[#3A3D46]">
          <h2 className="text-2xl font-bold mb-2">Connect Mobile App</h2>
          <p className="text-zinc-400 text-center mb-8 text-sm">
            Scan this QR code with your InstaPay mobile app to sync your wallet automatically.
          </p>
          
          <div className="bg-white p-4 rounded-2xl shadow-inner mb-8">
            <QRCodeSVG value="instapay://connect?session=123456789" size={200} />
          </div>
          
          <div className="w-full space-y-3">
            <button
              onClick={onSetupComplete}
              className="w-full bg-[#D4FF00] text-black font-bold py-3.5 rounded-xl text-md transition-transform active:scale-95"
            >
              I've scanned it (Skip for now)
            </button>
            <button
              onClick={() => setShowQR(false)}
              className="w-full bg-transparent text-zinc-400 font-semibold py-3.5 rounded-xl text-md border border-zinc-600 transition-colors hover:text-white hover:border-zinc-400"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

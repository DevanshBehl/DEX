import React from 'react';

interface ConnectionModalProps {
  origin: string | null;
  onApprove: () => void;
  onReject: () => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  origin,
  onApprove,
  onReject,
}) => {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#000000] text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <h2 className="text-lg font-black tracking-tight">Connect to dApp</h2>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
        <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-2 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </div>
        
        <div className="text-center space-y-2">
          <h3 className="text-xl font-bold">{origin || 'Unknown App'}</h3>
          <p className="text-sm text-[#888]">would like to connect to your wallet.</p>
        </div>

        <div className="w-full bg-white/5 border border-white/5 rounded-xl p-4 mt-4">
          <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-3">Requested Permissions</h4>
          <ul className="space-y-3">
            <li className="flex items-start space-x-3 text-sm">
              <svg className="w-5 h-5 text-green-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>View your wallet balance and activity</span>
            </li>
            <li className="flex items-start space-x-3 text-sm">
              <svg className="w-5 h-5 text-green-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Request approval for transactions</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Footer / Buttons */}
      <div className="p-4 border-t border-white/5 bg-[#0a0a0a] flex space-x-3">
        <button
          onClick={onReject}
          className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-white/5 hover:bg-white/10 transition-colors text-white"
        >
          Reject
        </button>
        <button
          onClick={onApprove}
          className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-white text-black hover:bg-gray-200 transition-colors"
        >
          Connect
        </button>
      </div>
    </div>
  );
};

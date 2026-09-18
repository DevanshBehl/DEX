import React, { useRef, useState } from 'react';

interface SlideToConfirmProps {
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
}

const THUMB = 48;
const PADDING = 4;

/** Drag-to-confirm control (pointer events: mouse, touch and pen). Keyboard users can press Enter on the thumb. */
export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({ label, disabled = false, onConfirm }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fired = useRef(false);

  const maxX = () => (trackRef.current ? trackRef.current.clientWidth - THUMB - PADDING * 2 : 0);

  const confirm = () => {
    if (fired.current || disabled) return;
    fired.current = true;
    setX(maxX());
    onConfirm();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const next = Math.min(Math.max(0, e.clientX - rect.left - PADDING - THUMB / 2), maxX());
    setX(next);
    if (next >= maxX() * 0.95) {
      setDragging(false);
      confirm();
    }
  };

  const release = () => {
    if (!dragging) return;
    setDragging(false);
    if (!fired.current) setX(0);
  };

  return (
    <div
      ref={trackRef}
      className={`relative w-full h-14 rounded-full bg-[#111111] border border-white/5 overflow-hidden select-none touch-none ${disabled ? 'opacity-50' : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="absolute left-0 top-0 bottom-0 bg-white/10 rounded-full" style={{ width: x + THUMB + PADDING * 2 }} />
      <span className={`absolute inset-0 flex items-center justify-center text-[13px] font-bold text-zinc-400 transition-opacity ${x > 30 ? 'opacity-0' : 'opacity-100'}`}>
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onPointerDown={(e) => {
          if (disabled || fired.current) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
        className={`absolute top-1 bottom-1 left-1 rounded-full flex items-center justify-center z-10 ${disabled ? 'bg-zinc-800 text-zinc-500' : 'bg-white text-black shadow-md cursor-grab active:cursor-grabbing'}`}
        style={{ width: THUMB, transform: `translateX(${x}px)`, transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.32,0.72,0,1)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
      </button>
    </div>
  );
};

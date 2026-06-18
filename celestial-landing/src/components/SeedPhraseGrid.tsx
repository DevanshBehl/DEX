interface Props {
  words: string[];
  isHovering: boolean;
  onHoverChange: (hovering: boolean) => void;
  onCopy: () => void;
  copied: boolean;
}

export default function SeedPhraseGrid({
  words,
  isHovering,
  onHoverChange,
  onCopy,
  copied,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      {/* Grid Container with Blur Guard */}
      <div
        className="relative cursor-pointer"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <div
          className="grid grid-cols-3 gap-2 transition-all duration-300 select-none"
          style={{
            filter: isHovering ? 'blur(0px)' : 'blur(16px)',
          }}
        >
          {words.map((word, i) => (
            <div key={i} className="seed-word">
              <span className="index">{i + 1}.</span>
              <span className="word">{word}</span>
            </div>
          ))}
        </div>

        {/* Hover Hint Overlay */}
        {!isHovering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-void-100/90 border border-white/10 backdrop-blur-sm">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-star-muted"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="text-sm font-medium text-star-muted">
                Hover to reveal
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Copy Button */}
      <button onClick={onCopy} className="btn-copy self-center">
        {copied ? (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ color: '#22c55e' }}>Copied!</span>
          </>
        ) : (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy to Clipboard
          </>
        )}
      </button>
    </div>
  );
}

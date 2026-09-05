export function OxygenMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="oxygen-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="14" cy="18" r="10" stroke="currentColor" strokeWidth="6" />
      <circle className="oxygen-bubble" cx="26" cy="5" r="4" fill="currentColor" />
    </svg>
  );
}

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="oxygen 首页">
      <span className="brand-mark">
        <OxygenMark />
      </span>
      <span className="wordmark-name">oxygen</span>
    </a>
  );
}

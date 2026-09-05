export function OxygenMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="oxygen-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="18" cy="23" r="11.5" stroke="currentColor" strokeWidth="5.5" />
      <circle className="oxygen-bubble" cx="32" cy="8" r="4.25" fill="currentColor" />
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

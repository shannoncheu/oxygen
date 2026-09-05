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
      <circle cx="14" cy="18" r="10" stroke="currentColor" strokeWidth="5.5" />
      <circle className="oxygen-bubble" cx="26" cy="5" r="3.5" fill="currentColor" />
    </svg>
  );
}

export function OxygenWordmark() {
  return (
    <svg
      className="oxygen-wordmark"
      viewBox="0 0 138 42"
      width="130"
      height="40"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M23 17.5C23 9.8 19.2 5 12.8 5S2.6 9.8 2.6 17.5 6.4 30 12.8 30 23 25.2 23 17.5Z" />
      <path d="m30 14 12 16m0-16L30 30" />
      <path d="m49 14 7 16m7-16-8.8 20.3c-1.4 3.1-3.6 4.2-6.6 3.2" />
      <path d="M86 14v16.8c0 5.3-3.5 8-8.7 8-2.8 0-5.1-.9-7-2.5M86 22c0-4.8-3.1-8.5-7.7-8.5s-7.8 3.7-7.8 8.5 3.2 8.5 7.8 8.5S86 26.8 86 22Z" />
      <path d="M108.5 27.5c-1.6 2-3.9 3-6.8 3-5.2 0-8.4-3.4-8.4-8.5s3.3-8.5 8.1-8.5c4.5 0 7.6 3.2 7.6 7.6v.9H93.5" />
      <path d="M117 30V14m0 7c0-4.6 2.9-7.5 7-7.5s6.8 2.9 6.8 7.5v9" />
    </svg>
  );
}

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="Oxygen 首页">
      <span className="brand-mark">
        <OxygenMark />
      </span>
      <span className="wordmark-name" aria-label="Oxygen">
        <OxygenWordmark />
      </span>
    </a>
  );
}

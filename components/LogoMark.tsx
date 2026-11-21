// The Align mark: three bars stepping into line.
export default function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <rect x="9" y="11" width="22" height="6" rx="3" fill="currentColor" opacity="0.45" />
      <rect x="13" y="21" width="26" height="6" rx="3" fill="currentColor" opacity="0.7" />
      <rect x="9" y="31" width="30" height="6" rx="3" fill="currentColor" />
    </svg>
  );
}

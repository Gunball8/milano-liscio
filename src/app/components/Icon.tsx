/** Small stroke icon set (24 px grid), inherits the text colour. */
const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  swap: 'M8 4v15m0 0-3.5-3.5M8 19l3.5-3.5M16 20V5m0 0-3.5 3.5M16 5l3.5 3.5',
  star: 'M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.6l-5.1 2.7.97-5.68L3.75 9.6l5.7-.83z',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  locate: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10',
  navigate: 'M12 3.5l6.5 16.5-6.5-3.7-6.5 3.7z',
  flag: 'M6 21V4.5M6 4.5h10.5l-2.2 4 2.2 4H6',
  stop: 'M7.5 7.5h9v9h-9z',
  pin: 'M12 21s-6.5-5.6-6.5-10.6a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21zM12 8a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 1 0 0-4.8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M20 20l-4.6-4.6',
  bike: 'M5.5 17.5a3 3 0 1 0 0-.01M18.5 17.5a3 3 0 1 0 0-.01M5.5 17.5 9 10h6l3.5 7.5M9 10l3 7.5h1.5M14 6.5h2.5l-1.5 3.5',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  chevron: 'M9 6l6 6-6 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false, size = 22, className }: { name: IconName; filled?: boolean; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

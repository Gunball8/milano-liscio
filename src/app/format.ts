export const fmtMB = (bytes: number) => `${(bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}\u00a0Mo`;

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'date inconnue';

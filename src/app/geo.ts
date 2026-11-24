/** One-shot GPS fix for "Ma position". Permission is asked on first use only (SPEC §9.4). */
export interface Fix {
  lon: number;
  lat: number;
  accuracy: number;
}

export class GeoError extends Error {}

export function getPosition(timeoutMs = 12_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('Localisation indisponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy }),
      (err) =>
        reject(
          new GeoError(
            err.code === err.PERMISSION_DENIED
              ? 'Localisation refusée : choisir un départ dans la recherche ou par appui long sur la carte.'
              : 'Position introuvable pour le moment. Réessayer ou choisir un départ.',
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}

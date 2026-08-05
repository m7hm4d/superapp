import MapLibreGL from '@maplibre/maplibre-react-native';

/**
 * Vector tile style used across the platform (OpenFreeMap "liberty").
 * No API key required.
 */
export const TILE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Some maplibre-react-native versions still expose the Mapbox-era
 * `setAccessToken` API and warn (or throw on Android) when it was never
 * called. Null it out once at module load, guarded so builds against
 * versions that removed the API keep working.
 */
const gl = MapLibreGL as unknown as {
  setAccessToken?: (token: string | null) => void;
};

if (typeof gl.setAccessToken === 'function') {
  try {
    gl.setAccessToken(null);
  } catch {
    // API present but unsupported on this platform/version — safe to ignore.
  }
}

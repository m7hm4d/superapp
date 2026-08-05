import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { TILE_STYLE_URL } from './tiles';

const {
  MapView: MLMapView,
  Camera: MLCamera,
  PointAnnotation: MLPointAnnotation,
  UserLocation: MLUserLocation,
} = MapLibreGL;

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'store' | 'store-closed' | 'driver' | 'pickup' | 'dropoff' | 'customer';
  selected?: boolean;
}

export interface MapViewProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  onMarkerPress?: (id: string) => void;
  onRegionChange?: (c: { lat: number; lng: number; zoom: number }) => void;
  showUserLocation?: boolean;
  fitBounds?: [{ lat: number; lng: number }, { lat: number; lng: number }];
  style?: object;
}

const DEFAULT_ZOOM = 14;
const ANIMATION_MS = 400;
const BOUNDS_PADDING = 48;

/** Marker fill per kind — colors mirror the shared tailwind preset. */
const MARKER_COLORS: Record<MapMarker['kind'], string> = {
  store: '#ed7320', // brand-500
  'store-closed': '#9ca3af', // gray
  driver: '#1d4ed8', // blue
  pickup: '#7c3aed', // purple
  dropoff: '#15803d', // green
  customer: '#1d4ed8', // blue dot
};

/** Shape of the GeoJSON feature emitted by onRegionDidChange (v10). */
interface RegionFeature {
  geometry?: { coordinates?: number[] };
  properties?: { zoomLevel?: number };
}

function MarkerDot({
  kind,
  selected,
}: {
  kind: MapMarker['kind'];
  selected?: boolean;
}): React.JSX.Element {
  const isDot = kind === 'customer';
  const size = isDot ? 16 : 28;
  return (
    <View
      style={[
        styles.marker,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: MARKER_COLORS[kind],
          borderWidth: isDot ? 2 : 3,
        },
        selected ? styles.markerSelected : null,
      ]}
    />
  );
}

export function MapView({
  center,
  zoom,
  markers,
  onMarkerPress,
  onRegionChange,
  showUserLocation,
  fitBounds,
  style,
}: MapViewProps): React.JSX.Element {
  const bounds = useMemo(() => {
    if (!fitBounds) return undefined;
    const [a, b] = fitBounds;
    return {
      ne: [Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)] as [number, number],
      sw: [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat)] as [number, number],
      paddingTop: BOUNDS_PADDING,
      paddingBottom: BOUNDS_PADDING,
      paddingLeft: BOUNDS_PADDING,
      paddingRight: BOUNDS_PADDING,
    };
  }, [fitBounds]);

  const handleRegionDidChange = useCallback(
    (feature: unknown) => {
      if (!onRegionChange) return;
      const f = feature as RegionFeature;
      const coords = f?.geometry?.coordinates;
      const lng = coords?.[0];
      const lat = coords?.[1];
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      const zoomLevel = f?.properties?.zoomLevel;
      onRegionChange({
        lat,
        lng,
        zoom: typeof zoomLevel === 'number' ? zoomLevel : zoom ?? DEFAULT_ZOOM,
      });
    },
    [onRegionChange, zoom],
  );

  return (
    <MLMapView
      style={[styles.map, style as StyleProp<ViewStyle>]}
      mapStyle={TILE_STYLE_URL}
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled={false}
      onRegionDidChange={handleRegionDidChange}
    >
      {bounds ? (
        <MLCamera bounds={bounds} animationDuration={ANIMATION_MS} />
      ) : (
        <MLCamera
          centerCoordinate={[center.lng, center.lat]}
          zoomLevel={zoom ?? DEFAULT_ZOOM}
          animationDuration={ANIMATION_MS}
        />
      )}
      {showUserLocation ? <MLUserLocation visible /> : null}
      {(markers ?? []).map((marker) => (
        <MLPointAnnotation
          key={marker.id}
          id={marker.id}
          coordinate={[marker.lng, marker.lat]}
          anchor={{ x: 0.5, y: 0.5 }}
          onSelected={() => onMarkerPress?.(marker.id)}
        >
          <MarkerDot kind={marker.kind} selected={marker.selected} />
        </MLPointAnnotation>
      ))}
    </MLMapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  marker: {
    borderColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  markerSelected: {
    transform: [{ scale: 1.35 }],
  },
});

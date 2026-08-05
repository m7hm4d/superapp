import { t } from '@superapp/i18n';
import { MapView, type MapMarker } from '@superapp/map';
import type { VendorCardView, VendorCategory } from '@superapp/shared';
import { CATEGORY_FLAG_BY_CATEGORY, VendorCategory as Categories } from '@superapp/shared';
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  cn,
} from '@superapp/ui';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistance } from '../../src/lib/format';
import { useConfigQuery, useNearbyQuery } from '../../src/lib/queries';

const CATEGORY_LABEL: Record<VendorCategory, () => string> = {
  [Categories.BAKERY]: () => t('customer', 'category_bakery'),
  [Categories.VEGETABLES]: () => t('customer', 'category_vegetables'),
  [Categories.MARKET]: () => t('customer', 'category_market'),
  [Categories.CONSTRUCTION]: () => t('customer', 'category_construction'),
};

function VendorRow({ vendor, onPress }: { vendor: VendorCardView; onPress: () => void }) {
  return (
    <Card onPress={onPress} className="mb-3">
      <View className="flex-row items-center gap-2">
        <AppText variant="heading" className="flex-1">
          {vendor.storeNameAr}
        </AppText>
        <Chip label={vendor.isOpen ? t('map', 'open') : t('map', 'closed')} selected={vendor.isOpen} />
      </View>
      <AppText variant="caption" className="mt-1">
        {vendor.addressText}
      </AppText>
      <View className="mt-2 flex-row items-center gap-4">
        <AppText variant="caption">
          {t('map', 'distance')}: {formatDistance(vendor.distanceM)}
        </AppText>
        <AppText variant="caption">
          {t('customer', 'prepMinutes', { n: vendor.defaultPrepMinutes })}
        </AppText>
      </View>
    </Card>
  );
}

/** C-02 استكشاف المخابز: خريطة/قائمة + فئات من الأعلام + بطاقة متجر منزلقة */
export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const configQuery = useConfigQuery();
  const city = configQuery.data?.city ?? null;

  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [category, setCategory] = useState<VendorCategory>(Categories.BAKERY);
  const [region, setRegion] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const cityCenter = useMemo(
    () => (city ? { lat: city.centerLat, lng: city.centerLng } : null),
    [city],
  );
  const searchCenter = region ?? cityCenter;
  const radiusM = Math.min(15_000, Math.max(100, (city?.visibilityRadiusKm ?? 5) * 1000));

  const enabledCategories = useMemo(() => {
    const flags = configQuery.data?.flags ?? {};
    return (Object.values(Categories) as VendorCategory[]).filter(
      (c) => flags[CATEGORY_FLAG_BY_CATEGORY[c]]?.enabled,
    );
  }, [configQuery.data]);

  const nearbyQuery = useNearbyQuery(searchCenter, category, radiusM);
  const vendors = nearbyQuery.data ?? [];
  const selectedVendor = vendors.find((v) => v.id === selectedId) ?? null;

  const markers: MapMarker[] = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        lat: v.lat,
        lng: v.lng,
        kind: v.isOpen ? 'store' : 'store-closed',
        selected: v.id === selectedId,
      })),
    [vendors, selectedId],
  );

  if (configQuery.isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (configQuery.isError || !cityCenter) {
    return (
      <Screen>
        <ErrorState onRetry={() => void configQuery.refetch()} />
      </Screen>
    );
  }

  const openStore = (id: string) => router.push(`/store/${id}`);

  return (
    <Screen scroll={false} padded={false} safeTop={false}>
      <View className="flex-1">
        {/* أدوات أعلى الشاشة: تبديل خريطة/قائمة + شرائح الفئات المفعّلة */}
        <View className="gap-2 bg-surface px-4 pb-2" style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center justify-center rounded-card bg-surface-muted p-1">
            {(['map', 'list'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                onPress={() => setMode(m)}
                className={cn(
                  'min-h-touch flex-1 items-center justify-center rounded-card',
                  mode === m && 'bg-brand-500',
                )}
              >
                <AppText
                  variant="body"
                  className={cn(mode === m ? 'text-white' : 'text-stone-600')}
                >
                  {m === 'map' ? t('customer', 'mapView') : t('customer', 'listView')}
                </AppText>
              </Pressable>
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {enabledCategories.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_LABEL[c]()}
                selected={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
        </View>

        {mode === 'map' ? (
          <View className="flex-1">
            <MapView
              center={cityCenter}
              zoom={14}
              markers={markers}
              showUserLocation
              onMarkerPress={(id) => setSelectedId(id)}
              onRegionChange={(c) => {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  setRegion({ lat: c.lat, lng: c.lng });
                }, 600);
              }}
              style={{ flex: 1 }}
            />

            {nearbyQuery.isError ? (
              <View className="absolute inset-x-4 top-2">
                <Card>
                  <ErrorState onRetry={() => void nearbyQuery.refetch()} />
                </Card>
              </View>
            ) : null}

            {!nearbyQuery.isLoading && !nearbyQuery.isError && vendors.length === 0 ? (
              <View className="absolute inset-x-4 top-2">
                <Card>
                  <AppText variant="body">{t('customer', 'noNearbyStores')}</AppText>
                  <AppText variant="caption" className="mt-1">
                    {t('customer', 'noNearbyStoresBody')}
                  </AppText>
                </Card>
              </View>
            ) : null}

            {/* بطاقة المتجر المنزلقة عند اختيار دبوس */}
            {selectedVendor ? (
              <View className="absolute inset-x-4 bottom-4">
                <Card>
                  <View className="flex-row items-center gap-2">
                    <AppText variant="heading" className="flex-1">
                      {selectedVendor.storeNameAr}
                    </AppText>
                    <Chip
                      label={selectedVendor.isOpen ? t('map', 'open') : t('map', 'closed')}
                      selected={selectedVendor.isOpen}
                    />
                  </View>
                  <AppText variant="caption" className="mt-1">
                    {selectedVendor.addressText} — {formatDistance(selectedVendor.distanceM)}
                  </AppText>
                  <View className="mt-3">
                    <Button
                      title={t('customer', 'viewStore')}
                      onPress={() => openStore(selectedVendor.id)}
                    />
                  </View>
                </Card>
              </View>
            ) : null}
          </View>
        ) : (
          <View className="flex-1 px-4 pt-3">
            {nearbyQuery.isLoading ? (
              <LoadingState />
            ) : nearbyQuery.isError ? (
              <ErrorState onRetry={() => void nearbyQuery.refetch()} />
            ) : vendors.length === 0 ? (
              <EmptyState
                title={t('customer', 'noNearbyStores')}
                body={t('customer', 'noNearbyStoresBody')}
              />
            ) : (
              <FlatList
                data={vendors}
                keyExtractor={(v) => v.id}
                renderItem={({ item }) => (
                  <VendorRow vendor={item} onPress={() => openStore(item.id)} />
                )}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
              />
            )}
          </View>
        )}
      </View>
    </Screen>
  );
}

/**
 * Token storage backends.
 * - expoSecureStorage(): expo-secure-store (lazily required so non-Expo
 *   consumers such as the admin web app never load the native module).
 * - memoryStorage(): in-memory, for tests.
 */

export interface TokenStorage {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  set(tokens: { accessToken: string; refreshToken: string }): Promise<void>;
  clear(): Promise<void>;
}

const ACCESS_KEY = 'sa.access';
const REFRESH_KEY = 'sa.refresh';

interface SecureStoreModule {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// Metro (React Native) provides require at runtime; declared locally so this
// package does not need @types/node.
declare const require: (id: string) => unknown;

export function expoSecureStorage(): TokenStorage {
  let mod: SecureStoreModule | null = null;
  const store = (): SecureStoreModule => {
    if (!mod) {
      // Lazy require so that importing @superapp/api-client does not pull in
      // expo-secure-store on platforms that don't have it (e.g. web admin).
      mod = require('expo-secure-store') as SecureStoreModule;
    }
    return mod;
  };

  return {
    async getAccess() {
      return store().getItemAsync(ACCESS_KEY);
    },
    async getRefresh() {
      return store().getItemAsync(REFRESH_KEY);
    },
    async set(tokens) {
      await store().setItemAsync(ACCESS_KEY, tokens.accessToken);
      await store().setItemAsync(REFRESH_KEY, tokens.refreshToken);
    },
    async clear() {
      await store().deleteItemAsync(ACCESS_KEY);
      await store().deleteItemAsync(REFRESH_KEY);
    },
  };
}

export function memoryStorage(): TokenStorage {
  let access: string | null = null;
  let refresh: string | null = null;

  return {
    async getAccess() {
      return access;
    },
    async getRefresh() {
      return refresh;
    },
    async set(tokens) {
      access = tokens.accessToken;
      refresh = tokens.refreshToken;
    },
    async clear() {
      access = null;
      refresh = null;
    },
  };
}

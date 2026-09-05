import type { GeoIpResponse } from './types';

// Served over http(s): call the same origin. Opened from disk (file://):
// fall back to a local dev address.
const API_ORIGIN =
  location.protocol === 'http:' || location.protocol === 'https:'
    ? ''
    : 'http://localhost:8787';

// `__APP_BASE_URL__` is the build-time base URL, always normalised to "/…/".
const LOOKUP_URL = `${API_ORIGIN}${__APP_BASE_URL__}lookup`;

/** Look up an IP address. Sends and receives JSON. */
export async function lookup(ip: string): Promise<GeoIpResponse> {
  let res: Response;
  try {
    res = await fetch(LOOKUP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ip }),
    });
  } catch {
    throw new Error('Could not reach the GeoIP service. Please try again.');
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Service returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (HTTP ${res.status})`;
    throw new Error(message);
  }

  return data as GeoIpResponse;
}

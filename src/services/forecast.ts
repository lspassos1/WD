import { ForecastServiceClient } from '@/generated/client/worldmonitor/forecast/v1/service_client';
import type { Forecast } from '@/generated/client/worldmonitor/forecast/v1/service_client';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { getHydratedData } from '@/services/bootstrap';

export type { Forecast };

export { escapeHtml } from '@/utils/sanitize';

let _client: ForecastServiceClient | null = null;

function getClient(): ForecastServiceClient {
  if (!_client) {
    _client = new ForecastServiceClient(getRpcBaseUrl(), {
      fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    });
  }
  return _client;
}

function filterForecasts(forecasts: Forecast[], domain?: string, region?: string): Forecast[] {
  let filtered = forecasts;
  if (domain) filtered = filtered.filter((forecast) => forecast.domain === domain);
  if (region) {
    const normalized = region.toLowerCase();
    filtered = filtered.filter((forecast) => forecast.region.toLowerCase().includes(normalized));
  }
  return filtered;
}

export async function fetchForecasts(domain?: string, region?: string): Promise<Forecast[]> {
  const hydrated = getHydratedData('forecasts') as { predictions?: Forecast[]; forecasts?: Forecast[] } | undefined;
  const hydratedForecasts = hydrated?.forecasts ?? hydrated?.predictions ?? [];
  if (hydratedForecasts.length > 0) {
    return filterForecasts(hydratedForecasts, domain, region);
  }

  const resp = await getClient().getForecasts({ domain: domain || '', region: region || '' });
  return resp.forecasts || [];
}

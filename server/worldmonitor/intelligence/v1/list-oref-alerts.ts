import type {
  IntelligenceServiceHandler,
  ServerContext,
  ListOrefAlertsRequest,
  ListOrefAlertsResponse,
  OrefAlert,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { getRelayBaseUrl, getRelayHeaders } from './_relay';

interface RelayOrefAlert {
  id?: string | number;
  cat?: string;
  title?: string;
  data?: string[];
  desc?: string;
  alertDate?: string;
}

interface RelayOrefWave {
  alerts?: RelayOrefAlert[];
  timestamp?: string;
}

interface RelayOrefResponse {
  configured?: boolean;
  alerts?: RelayOrefAlert[];
  history?: RelayOrefWave[];
  historyCount24h?: number;
  totalHistoryCount?: number;
  timestamp?: string;
  error?: string;
}

function toEpochMs(value: string | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function emptyResponse(error: string): ListOrefAlertsResponse {
  return {
    configured: false,
    alerts: [],
    history: [],
    historyCount24h: 0,
    totalHistoryCount: 0,
    timestampMs: Date.now(),
    error,
  };
}

function mapAlert(alert: RelayOrefAlert): OrefAlert {
  return {
    id: String(alert.id || ''),
    cat: String(alert.cat || ''),
    title: String(alert.title || ''),
    data: Array.isArray(alert.data) ? alert.data.map(String) : [],
    desc: String(alert.desc || ''),
    timestampMs: toEpochMs(alert.alertDate),
  };
}

/**
 * ListOrefAlerts fetches Israeli Red Alerts from the Home Front Command relay.
 */
export const listOrefAlerts: IntelligenceServiceHandler['listOrefAlerts'] = async (
  _ctx: ServerContext,
  req: ListOrefAlertsRequest,
): Promise<ListOrefAlertsResponse> => {
  const relayBaseUrl = getRelayBaseUrl();
  if (!relayBaseUrl) {
    return emptyResponse('WS_RELAY_URL not configured');
  }

  const endpoint = req.mode === 'MODE_HISTORY' ? '/oref/history' : '/oref/alerts';
  const url = `${relayBaseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      headers: getRelayHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return emptyResponse(`Relay HTTP ${response.status}`);
    }

    const data = (await response.json()) as RelayOrefResponse;
    return {
      configured: data.configured ?? false,
      alerts: (data.alerts || []).map(mapAlert),
      history: (data.history || []).map((wave) => ({
        alerts: (wave.alerts || []).map(mapAlert),
        timestampMs: toEpochMs(wave.timestamp),
      })),
      historyCount24h: data.historyCount24h || 0,
      totalHistoryCount: data.totalHistoryCount || 0,
      timestampMs: toEpochMs(data.timestamp) || Date.now(),
      error: data.error || '',
    };
  } catch (error) {
    return emptyResponse(String(error));
  }
};

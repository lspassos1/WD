/**
 * RPC: GetEarningsCalendar -- fetches upcoming or recent earnings from Finnhub.
 */

import type {
  ServerContext,
  GetEarningsCalendarRequest,
  GetEarningsCalendarResponse,
  EarningsReport,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { UPSTREAM_TIMEOUT_MS } from './_shared';
import { CHROME_UA, finnhubGate } from '../../../_shared/constants';
import { cachedFetchJson } from '../../../_shared/redis';

const REDIS_CACHE_KEY = 'market:earnings-calendar:v1';
const REDIS_CACHE_TTL = 3600; // 1 hour

export async function getEarningsCalendar(
  _ctx: ServerContext,
  req: GetEarningsCalendarRequest,
): Promise<GetEarningsCalendarResponse> {
  const timeframe = req.timeframe || 'upcoming';
  const redisKey = `${REDIS_CACHE_KEY}:${timeframe}`;

  const finnhubToken = process.env.FINNHUB_API_KEY || process.env.FINNHUB_TOKEN;

  // If no token, return empty but explain why (Suggestion #2 fix)
  if (!finnhubToken) {
    return { 
      reports: [], 
      finnhubSkipped: true, 
      skipReason: 'Missing FINNHUB_API_KEY in server environment' 
    };
  }

  try {
    const result = await cachedFetchJson<GetEarningsCalendarResponse>(redisKey, REDIS_CACHE_TTL, async () => {
      const now = new Date();
      let from: string;
      let to: string;

      if (timeframe === 'recent') {
        // Last 7 days
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        from = startDate.toISOString().split('T')[0]!;
        to = now.toISOString().split('T')[0]!;
      } else {
        // Next 7 days
        const endDate = new Date(now);
        endDate.setDate(now.getDate() + 7);
        from = now.toISOString().split('T')[0]!;
        to = endDate.toISOString().split('T')[0]!;
      }

      const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}`;
      
      await finnhubGate();
      const res = await fetch(url, {
        headers: { 
          'X-Finnhub-Token': finnhubToken,
          'User-Agent': CHROME_UA 
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (!res.ok) {
        if (res.status === 429) {
          return { reports: [], finnhubSkipped: true, skipReason: 'Finnhub rate limited (429)' };
        }
        return null;
      }

      const data = await res.json() as { earningsCalendar?: any[] };
      const rawReports = data.earningsCalendar || [];
      
      const reports: EarningsReport[] = rawReports.map((r: any) => ({
        symbol: r.symbol || '',
        title: r.symbol || '', // Finnhub doesn't provide company name here, symbol used as title
        epsEstimate: r.epsEstimate != null ? Number(r.epsEstimate) : 0,
        epsActual: r.epsActual != null ? Number(r.epsActual) : 0,
        epsSurprisePercent: r.epsSurprisePercent != null ? Number(r.epsSurprisePercent) : 0,
        revenueEstimate: r.revenueEstimate != null ? Number(r.revenueEstimate) : 0,
        revenueActual: r.revenueActual != null ? Number(r.revenueActual) : 0,
        revenueSurprisePercent: r.revenueSurprisePercent != null ? Number(r.revenueSurprisePercent) : 0,
        reportDate: r.date || '',
        reportTime: r.hour || '',
      }));

      return { 
        reports, 
        finnhubSkipped: false, 
        skipReason: '' 
      };
    });

    return result || { reports: [], finnhubSkipped: false, skipReason: 'Internal fetch failure' };
  } catch (err) {
    return { 
      reports: [], 
      finnhubSkipped: true, 
      skipReason: (err as Error).message 
    };
  }
}

import type { GetEarningsCalendarResponse } from '@/generated/server/worldmonitor/market/v1/service_server';
import { SITE_VARIANT } from '@/config';
import { getCurrentLanguage } from './i18n';

export async function fetchEarningsReports(timeframe: 'upcoming' | 'recent'): Promise<GetEarningsCalendarResponse> {

    // For development/screenshot purposes, provide mock data if API fails or returns empty
    const useMock = import.meta.env.DEV;

    try {
        const res = await fetch(`/api/market/v1/get-earnings-calendar?timeframe=${encodeURIComponent(timeframe)}&variant=${SITE_VARIANT}&lang=${getCurrentLanguage()}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
        }
        const data = await res.json() as GetEarningsCalendarResponse;

        if (useMock && (!data.reports || data.reports.length === 0)) {
            const { getMockEarnings } = await import('./__mocks__/earnings');
            return getMockEarnings(timeframe);
        }

        return data;
    } catch (err) {
        console.error(`[Earnings API] Failed to fetch earnings for timeframe ${timeframe}:`, err);
        if (useMock) {
            const { getMockEarnings } = await import('./__mocks__/earnings');
            return getMockEarnings(timeframe);
        }
        return { reports: [], finnhubSkipped: false, skipReason: String(err) };
    }
}


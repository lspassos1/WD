import type { GetEarningsCalendarResponse } from '@/generated/server/worldmonitor/market/v1/service_server';

export function getMockEarnings(timeframe: 'upcoming' | 'recent'): GetEarningsCalendarResponse {
    const mockReports: any[] = timeframe === 'upcoming' ? [
        {
            symbol: 'AAPL',
            title: 'Apple Inc.',
            epsEstimate: 2.10,
            reportDate: '2026-03-12',
            reportTime: 'AMC',
        },
        {
            symbol: 'NVDA',
            title: 'NVIDIA Corporation',
            epsEstimate: 0.75,
            reportDate: '2026-03-15',
            reportTime: 'AMC',
        },
        {
            symbol: 'TSLA',
            title: 'Tesla, Inc.',
            epsEstimate: 0.60,
            reportDate: '2026-03-18',
            reportTime: 'BMO',
        }
    ] : [
        {
            symbol: 'MSFT',
            title: 'Microsoft Corp.',
            epsEstimate: 2.80,
            epsActual: 2.93,
            epsSurprisePercent: 4.6,
            revenueEstimate: 61120000000,
            revenueActual: 62020000000,
            revenueSurprisePercent: 1.5,
            reportDate: '2026-03-08',
            reportTime: 'AMC',
        },
        {
            symbol: 'GOOGL',
            title: 'Alphabet Inc.',
            epsEstimate: 1.60,
            epsActual: 1.64,
            epsSurprisePercent: 2.5,
            revenueEstimate: 86320000000,
            revenueActual: 86600000000,
            revenueSurprisePercent: 0.3,
            reportDate: '2026-03-06',
            reportTime: 'AMC',
        }
    ];

    return {
        reports: mockReports,
        finnhubSkipped: false,
        skipReason: ''
    };
}

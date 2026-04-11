export type BootstrapTier = 'fast' | 'slow';
export type HealthBucket = 'bootstrap' | 'standalone';
export type CacheFillFallback = 'return_null' | 'hedge' | 'throw';

export interface DatasetContract {
  id: string;
  displayName: string;
  domain: string;
  description: string;
  owner: { github: string; team?: string };
  redis: { key: string; versionTag?: `v${number}`; payload: 'json' };
  bootstrap?: { alias: string; tier: BootstrapTier; public: boolean; redisReadMode: 'unprefixed' };
  health?: {
    bucket: HealthBucket;
    seedMetaKey?: string;
    maxStaleMin?: number;
    onDemand?: boolean;
    emptyOk?: boolean;
    cascadeGroup?: string;
  };
  cacheFill?: { enabled: boolean; leaseMs?: number; waitMs?: number; fallback?: CacheFillFallback };
}

const BOOTSTRAP_ALIASES = {
  earthquakes: 'seismology:earthquakes:v1',
  outages: 'infra:outages:v1',
  serviceStatuses: 'infra:service-statuses:v1',
  ddosAttacks: 'cf:radar:ddos:v1',
  trafficAnomalies: 'cf:radar:traffic-anomalies:v1',
  marketQuotes: 'market:stocks-bootstrap:v1',
  commodityQuotes: 'market:commodities-bootstrap:v1',
  sectors: 'market:sectors:v2',
  etfFlows: 'market:etf-flows:v1',
  macroSignals: 'economic:macro-signals:v1',
  bisPolicy: 'economic:bis:policy:v1',
  bisExchange: 'economic:bis:eer:v1',
  bisCredit: 'economic:bis:credit:v1',
  imfMacro: 'economic:imf:macro:v2',
  shippingRates: 'supply_chain:shipping:v2',
  chokepoints: 'supply_chain:chokepoints:v4',
  minerals: 'supply_chain:minerals:v2',
  giving: 'giving:summary:v1',
  climateAnomalies: 'climate:anomalies:v2',
  climateDisasters: 'climate:disasters:v1',
  co2Monitoring: 'climate:co2-monitoring:v1',
  oceanIce: 'climate:ocean-ice:v1',
  climateNews: 'climate:news-intelligence:v1',
  radiationWatch: 'radiation:observations:v1',
  thermalEscalation: 'thermal:escalation:v1',
  crossSourceSignals: 'intelligence:cross-source-signals:v1',
  wildfires: 'wildfire:fires:v1',
  cyberThreats: 'cyber:threats-bootstrap:v2',
  techReadiness: 'economic:worldbank-techreadiness:v1',
  progressData: 'economic:worldbank-progress:v1',
  renewableEnergy: 'economic:worldbank-renewable:v1',
  positiveGeoEvents: 'positive_events:geo-bootstrap:v1',
  theaterPosture: 'theater_posture:sebuf:stale:v1',
  riskScores: 'risk:scores:sebuf:stale:v1',
  naturalEvents: 'natural:events:v1',
  flightDelays: 'aviation:delays-bootstrap:v1',
  insights: 'news:insights:v1',
  predictions: 'prediction:markets-bootstrap:v1',
  cryptoQuotes: 'market:crypto:v1',
  cryptoSectors: 'market:crypto-sectors:v1',
  defiTokens: 'market:defi-tokens:v1',
  aiTokens: 'market:ai-tokens:v1',
  otherTokens: 'market:other-tokens:v1',
  gulfQuotes: 'market:gulf-quotes:v1',
  stablecoinMarkets: 'market:stablecoins:v1',
  unrestEvents: 'unrest:events:v1',
  iranEvents: 'conflict:iran-events:v1',
  ucdpEvents: 'conflict:ucdp-events:v1',
  temporalAnomalies: 'temporal:anomalies:v1',
  weatherAlerts: 'weather:alerts:v1',
  spending: 'economic:spending:v1',
  techEvents: 'research:tech-events-bootstrap:v1',
  gdeltIntel: 'intelligence:gdelt-intel:v1',
  correlationCards: 'correlation:cards-bootstrap:v1',
  forecasts: 'forecast:predictions:v2',
  securityAdvisories: 'intelligence:advisories-bootstrap:v1',
  customsRevenue: 'trade:customs-revenue:v1',
  sanctionsPressure: 'sanctions:pressure:v1',
  consumerPricesOverview: 'consumer-prices:overview:ae',
  consumerPricesCategories: 'consumer-prices:categories:ae:30d',
  consumerPricesMovers: 'consumer-prices:movers:ae:30d',
  consumerPricesSpread: 'consumer-prices:retailer-spread:ae:essentials-ae',
  groceryBasket: 'economic:grocery-basket:v1',
  bigmac: 'economic:bigmac:v1',
  fuelPrices: 'economic:fuel-prices:v1',
  faoFoodPriceIndex: 'economic:fao-ffpi:v1',
  nationalDebt: 'economic:national-debt:v1',
  euGasStorage: 'economic:eu-gas-storage:v1',
  eurostatCountryData: 'economic:eurostat-country-data:v1',
  marketImplications: 'intelligence:market-implications:v1',
  fearGreedIndex: 'market:fear-greed:v1',
  crudeInventories: 'economic:crude-inventories:v1',
  natGasStorage: 'economic:nat-gas-storage:v1',
  ecbFxRates: 'economic:ecb-fx-rates:v1',
  euFsi: 'economic:fsi-eu:v1',
  shippingStress: 'supply_chain:shipping_stress:v1',
  socialVelocity: 'intelligence:social:reddit:v1',
  wsbTickers: 'intelligence:wsb-tickers:v1',
  pizzint: 'intelligence:pizzint:seed:v1',
  diseaseOutbreaks: 'health:disease-outbreaks:v1',
  economicStress: 'economic:stress-index:v1',
  electricityPrices: 'energy:electricity:v1:index',
  jodiOil: 'energy:jodi-oil:v1:_countries',
  chokepointBaselines: 'energy:chokepoint-baselines:v1',
  portwatchChokepointsRef: 'portwatch:chokepoints:ref:v1',
  portwatchPortActivity: 'supply_chain:portwatch-ports:v1:_countries',
  oilStocksAnalysis: 'energy:oil-stocks-analysis:v1',
  lngVulnerability: 'energy:lng-vulnerability:v1',
  sprPolicies: 'energy:spr-policies:v1',
  aaiiSentiment: 'market:aaii-sentiment:v1',
  breadthHistory: 'market:breadth-history:v1',
} as const;

const BOOTSTRAP_TIERS = {
  bisPolicy: 'slow',
  bisExchange: 'slow',
  bisCredit: 'slow',
  imfMacro: 'slow',
  minerals: 'slow',
  giving: 'slow',
  sectors: 'slow',
  etfFlows: 'slow',
  wildfires: 'slow',
  climateAnomalies: 'slow',
  climateDisasters: 'slow',
  co2Monitoring: 'slow',
  oceanIce: 'slow',
  climateNews: 'slow',
  radiationWatch: 'slow',
  thermalEscalation: 'slow',
  crossSourceSignals: 'slow',
  cyberThreats: 'slow',
  techReadiness: 'slow',
  progressData: 'slow',
  renewableEnergy: 'slow',
  naturalEvents: 'slow',
  cryptoQuotes: 'slow',
  cryptoSectors: 'slow',
  defiTokens: 'slow',
  aiTokens: 'slow',
  otherTokens: 'slow',
  gulfQuotes: 'slow',
  stablecoinMarkets: 'slow',
  unrestEvents: 'slow',
  ucdpEvents: 'slow',
  techEvents: 'slow',
  securityAdvisories: 'slow',
  customsRevenue: 'slow',
  sanctionsPressure: 'slow',
  consumerPricesOverview: 'slow',
  consumerPricesCategories: 'slow',
  consumerPricesMovers: 'slow',
  consumerPricesSpread: 'slow',
  groceryBasket: 'slow',
  bigmac: 'slow',
  fuelPrices: 'slow',
  faoFoodPriceIndex: 'slow',
  nationalDebt: 'slow',
  euGasStorage: 'slow',
  eurostatCountryData: 'slow',
  marketImplications: 'slow',
  fearGreedIndex: 'slow',
  crudeInventories: 'slow',
  natGasStorage: 'slow',
  ecbFxRates: 'slow',
  euFsi: 'slow',
  shippingStress: 'fast',
  socialVelocity: 'fast',
  wsbTickers: 'fast',
  pizzint: 'slow',
  diseaseOutbreaks: 'slow',
  economicStress: 'slow',
  electricityPrices: 'slow',
  jodiOil: 'slow',
  chokepointBaselines: 'slow',
  portwatchChokepointsRef: 'slow',
  portwatchPortActivity: 'slow',
  oilStocksAnalysis: 'slow',
  lngVulnerability: 'slow',
  sprPolicies: 'slow',
  aaiiSentiment: 'slow',
  breadthHistory: 'slow',
  earthquakes: 'fast',
  outages: 'fast',
  serviceStatuses: 'fast',
  ddosAttacks: 'fast',
  trafficAnomalies: 'fast',
  marketQuotes: 'fast',
  commodityQuotes: 'fast',
  macroSignals: 'fast',
  shippingRates: 'fast',
  chokepoints: 'fast',
  positiveGeoEvents: 'fast',
  theaterPosture: 'fast',
  riskScores: 'fast',
  flightDelays: 'fast',
  insights: 'fast',
  predictions: 'fast',
  iranEvents: 'fast',
  temporalAnomalies: 'fast',
  weatherAlerts: 'fast',
  spending: 'fast',
  gdeltIntel: 'fast',
  correlationCards: 'fast',
  forecasts: 'fast',
} as const satisfies Record<keyof typeof BOOTSTRAP_ALIASES, BootstrapTier>;

const BOOTSTRAP_TO_DATASET_NAME = {
  insights: 'newsInsights',
  predictions: 'predictionMarkets',
} as const;

const DEFAULT_OWNER = { github: 'lspassos1' } as const;

function normalizeDomain(rawKey: string): string {
  return rawKey.split(':')[0].replace(/_/g, '-');
}

function extractVersionTag(key: string): `v${number}` | undefined {
  const match = key.match(/(?:^|[:\\-])(v\\d+)(?:$|[:])/);
  return match?.[1] as `v${number}` | undefined;
}

function buildDatasets(): DatasetContract[] {
  return Object.entries(BOOTSTRAP_ALIASES)
    .map(([alias, redisKey]) => {
      const logicalName = BOOTSTRAP_TO_DATASET_NAME[alias as keyof typeof BOOTSTRAP_TO_DATASET_NAME] ?? alias;
      const domain = normalizeDomain(redisKey);

      return {
        id: `${domain}.${logicalName}`,
        displayName: logicalName,
        domain,
        description: `Dataset contract for ${logicalName}`,
        owner: { ...DEFAULT_OWNER },
        redis: {
          key: redisKey,
          versionTag: extractVersionTag(redisKey),
          payload: 'json',
        },
        bootstrap: {
          alias,
          tier: BOOTSTRAP_TIERS[alias as keyof typeof BOOTSTRAP_TIERS],
          public: true,
          redisReadMode: 'unprefixed',
        },
        // Bootstrap datasets are required to carry an explicit health contract even
        // before api/health.js migrates to generated artifacts.
        health: { bucket: 'bootstrap' },
      } satisfies DatasetContract;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const DATASETS: DatasetContract[] = buildDatasets();

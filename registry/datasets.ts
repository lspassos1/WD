export type BootstrapTier = 'fast' | 'slow';
export type HealthBucket = 'bootstrap' | 'standalone';
export type CacheFillFallback = 'return_null' | 'hedge' | 'throw';

export interface DatasetContract {
  id: string;
  displayName: string;
  domain: string;
  description: string;
  owner: { github: string; team?: string; };
  redis: { key: string; versionTag?: `v${number}`; payload: 'json'; };
  bootstrap?: { alias: string; tier: BootstrapTier; public: boolean; redisReadMode: 'unprefixed'; };
  health?: { bucket: HealthBucket; seedMetaKey?: string; maxStaleMin?: number; onDemand?: boolean; emptyOk?: boolean; cascadeGroup?: string; };
  cacheFill?: { enabled: boolean; leaseMs?: number; waitMs?: number; fallback?: CacheFillFallback; };
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
} as const;

const HEALTH_BOOTSTRAP_KEYS = {
  earthquakes: 'seismology:earthquakes:v1',
  outages: 'infra:outages:v1',
  sectors: 'market:sectors:v2',
  etfFlows: 'market:etf-flows:v1',
  climateAnomalies: 'climate:anomalies:v2',
  climateDisasters: 'climate:disasters:v1',
  climateAirQuality: 'climate:air-quality:v1',
  co2Monitoring: 'climate:co2-monitoring:v1',
  oceanIce: 'climate:ocean-ice:v1',
  wildfires: 'wildfire:fires:v1',
  marketQuotes: 'market:stocks-bootstrap:v1',
  commodityQuotes: 'market:commodities-bootstrap:v1',
  cyberThreats: 'cyber:threats-bootstrap:v2',
  techReadiness: 'economic:worldbank-techreadiness:v1',
  progressData: 'economic:worldbank-progress:v1',
  renewableEnergy: 'economic:worldbank-renewable:v1',
  positiveGeoEvents: 'positive_events:geo-bootstrap:v1',
  riskScores: 'risk:scores:sebuf:stale:v1',
  naturalEvents: 'natural:events:v1',
  flightDelays: 'aviation:delays-bootstrap:v1',
  newsInsights: 'news:insights:v1',
  predictionMarkets: 'prediction:markets-bootstrap:v1',
  cryptoQuotes: 'market:crypto:v1',
  gulfQuotes: 'market:gulf-quotes:v1',
  stablecoinMarkets: 'market:stablecoins:v1',
  unrestEvents: 'unrest:events:v1',
  iranEvents: 'conflict:iran-events:v1',
  ucdpEvents: 'conflict:ucdp-events:v1',
  weatherAlerts: 'weather:alerts:v1',
  spending: 'economic:spending:v1',
  techEvents: 'research:tech-events-bootstrap:v1',
  gdeltIntel: 'intelligence:gdelt-intel:v1',
  correlationCards: 'correlation:cards-bootstrap:v1',
  forecasts: 'forecast:predictions:v2',
  securityAdvisories: 'intelligence:advisories-bootstrap:v1',
  customsRevenue: 'trade:customs-revenue:v1',
  comtradeFlows: 'comtrade:flows:v1',
  blsSeries: 'bls:series:v1',
  sanctionsPressure: 'sanctions:pressure:v1',
  crossSourceSignals: 'intelligence:cross-source-signals:v1',
  sanctionsEntities: 'sanctions:entities:v1',
  radiationWatch: 'radiation:observations:v1',
  consumerPricesOverview: 'consumer-prices:overview:ae',
  consumerPricesCategories: 'consumer-prices:categories:ae:30d',
  consumerPricesMovers: 'consumer-prices:movers:ae:30d',
  consumerPricesSpread: 'consumer-prices:retailer-spread:ae:essentials-ae',
  consumerPricesFreshness: 'consumer-prices:freshness:ae',
  groceryBasket: 'economic:grocery-basket:v1',
  bigmac: 'economic:bigmac:v1',
  fuelPrices: 'economic:fuel-prices:v1',
  faoFoodPriceIndex: 'economic:fao-ffpi:v1',
  nationalDebt: 'economic:national-debt:v1',
  defiTokens: 'market:defi-tokens:v1',
  aiTokens: 'market:ai-tokens:v1',
  otherTokens: 'market:other-tokens:v1',
  fredBatch: 'economic:fred:v1:FEDFUNDS:0',
  ecbEstr: 'economic:fred:v1:ESTR:0',
  ecbEuribor3m: 'economic:fred:v1:EURIBOR3M:0',
  ecbEuribor6m: 'economic:fred:v1:EURIBOR6M:0',
  ecbEuribor1y: 'economic:fred:v1:EURIBOR1Y:0',
  fearGreedIndex: 'market:fear-greed:v1',
  breadthHistory: 'market:breadth-history:v1',
  euYieldCurve: 'economic:yield-curve-eu:v1',
  earningsCalendar: 'market:earnings-calendar:v1',
  econCalendar: 'economic:econ-calendar:v1',
  cotPositioning: 'market:cot:v1',
  crudeInventories: 'economic:crude-inventories:v1',
  natGasStorage: 'economic:nat-gas-storage:v1',
  spr: 'economic:spr:v1',
  refineryInputs: 'economic:refinery-inputs:v1',
  ecbFxRates: 'economic:ecb-fx-rates:v1',
  eurostatCountryData: 'economic:eurostat-country-data:v1',
  euGasStorage: 'economic:eu-gas-storage:v1',
  euFsi: 'economic:fsi-eu:v1',
  shippingStress: 'supply_chain:shipping_stress:v1',
  diseaseOutbreaks: 'health:disease-outbreaks:v1',
  healthAirQuality: 'health:air-quality:v1',
  socialVelocity: 'intelligence:social:reddit:v1',
  wsbTickers: 'intelligence:wsb-tickers:v1',
  vpdTrackerRealtime: 'health:vpd-tracker:realtime:v1',
  vpdTrackerHistorical: 'health:vpd-tracker:historical:v1',
  electricityPrices: 'energy:electricity:v1:index',
  gasStorageCountries: 'energy:gas-storage:v1:_countries',
  aaiiSentiment: 'market:aaii-sentiment:v1',
} as const;

const HEALTH_BOOTSTRAP_ADDITIONS = {
  ddosAttacks: 'cf:radar:ddos:v1',
  trafficAnomalies: 'cf:radar:traffic-anomalies:v1',
  cryptoSectors: 'market:crypto-sectors:v1',
  economicStress: 'economic:stress-index:v1',
} as const;

const HEALTH_STANDALONE_KEYS = {
  serviceStatuses: 'infra:service-statuses:v1',
  macroSignals: 'economic:macro-signals:v1',
  bisPolicy: 'economic:bis:policy:v1',
  bisExchange: 'economic:bis:eer:v1',
  bisCredit: 'economic:bis:credit:v1',
  imfMacro: 'economic:imf:macro:v2',
  climateZoneNormals: 'climate:zone-normals:v1',
  shippingRates: 'supply_chain:shipping:v2',
  chokepoints: 'supply_chain:chokepoints:v4',
  minerals: 'supply_chain:minerals:v2',
  giving: 'giving:summary:v1',
  gpsjam: 'intelligence:gpsjam:v2',
  theaterPosture: 'theater_posture:sebuf:stale:v1',
  theaterPostureLive: 'theater-posture:sebuf:v1',
  theaterPostureBackup: 'theater-posture:sebuf:backup:v1',
  riskScoresLive: 'risk:scores:sebuf:v1',
  usniFleet: 'usni-fleet:sebuf:v1',
  usniFleetStale: 'usni-fleet:sebuf:stale:v1',
  faaDelays: 'aviation:delays:faa:v1',
  intlDelays: 'aviation:delays:intl:v3',
  notamClosures: 'aviation:notam:closures:v2',
  positiveEventsLive: 'positive-events:geo:v1',
  cableHealth: 'cable-health-v1',
  cyberThreatsRpc: 'cyber:threats:v2',
  militaryBases: 'military:bases:active',
  militaryFlights: 'military:flights:v1',
  militaryFlightsStale: 'military:flights:stale:v1',
  temporalAnomalies: 'temporal:anomalies:v1',
  displacement: 'displacement:summary:v1:{currentYear}',
  satellites: 'intelligence:satellites:tle:v1',
  portwatch: 'supply_chain:portwatch:v1',
  portwatchPortActivity: 'supply_chain:portwatch-ports:v1:_countries',
  corridorrisk: 'supply_chain:corridorrisk:v1',
  chokepointTransits: 'supply_chain:chokepoint_transits:v1',
  transitSummaries: 'supply_chain:transit-summaries:v1',
  thermalEscalation: 'thermal:escalation:v1',
  tariffTrendsUs: 'trade:tariffs:v1:840:all:10',
  militaryForecastInputs: 'military:forecast-inputs:stale:v1',
  gscpi: 'economic:fred:v1:GSCPI:0',
  marketImplications: 'intelligence:market-implications:v1',
  hormuzTracker: 'supply_chain:hormuz_tracker:v1',
  simulationPackageLatest: 'forecast:simulation-package:latest',
  simulationOutcomeLatest: 'forecast:simulation-outcome:latest',
  newsThreatSummary: 'news:threat:summary:v1',
  climateNews: 'climate:news-intelligence:v1',
  pizzint: 'intelligence:pizzint:seed:v1',
  resilienceStaticIndex: 'resilience:static:index:v1',
  resilienceRanking: 'resilience:ranking:v8',
  productCatalog: 'product-catalog:v2',
  energySpineCountries: 'energy:spine:v1:_countries',
  energyExposure: 'energy:exposure:v1:index',
  energyMixAll: 'energy:mix:v1:_all',
  regulatoryActions: 'regulatory:actions:v1',
  energyIntelligence: 'energy:intelligence:feed:v1',
  ieaOilStocks: 'energy:iea-oil-stocks:v1:index',
  oilStocksAnalysis: 'energy:oil-stocks-analysis:v1',
  jodiGas: 'energy:jodi-gas:v1:_countries',
  lngVulnerability: 'energy:lng-vulnerability:v1',
  jodiOil: 'energy:jodi-oil:v1:_countries',
  chokepointBaselines: 'energy:chokepoint-baselines:v1',
  portwatchChokepointsRef: 'portwatch:chokepoints:ref:v1',
  chokepointFlows: 'energy:chokepoint-flows:v1',
  emberElectricity: 'energy:ember:v1:_all',
  resilienceIntervals: 'resilience:intervals:v1:US',
  sprPolicies: 'energy:spr-policies:v1',
  regionalSnapshots: 'intelligence:regional-snapshots:summary:v1',
} as const;

const HEALTH_SEED_META = {
  earthquakes: { key: 'seed-meta:seismology:earthquakes', maxStaleMin: 30 },
  wildfires: { key: 'seed-meta:wildfire:fires', maxStaleMin: 360 },
  outages: { key: 'seed-meta:infra:outages', maxStaleMin: 30 },
  climateAnomalies: { key: 'seed-meta:climate:anomalies', maxStaleMin: 240 },
  climateDisasters: { key: 'seed-meta:climate:disasters', maxStaleMin: 720 },
  climateAirQuality: { key: 'seed-meta:health:air-quality', maxStaleMin: 180 },
  climateZoneNormals: { key: 'seed-meta:climate:zone-normals', maxStaleMin: 89280 },
  co2Monitoring: { key: 'seed-meta:climate:co2-monitoring', maxStaleMin: 4320 },
  oceanIce: { key: 'seed-meta:climate:ocean-ice', maxStaleMin: 2880 },
  climateNews: { key: 'seed-meta:climate:news-intelligence', maxStaleMin: 90 },
  unrestEvents: { key: 'seed-meta:unrest:events', maxStaleMin: 120 },
  cyberThreats: { key: 'seed-meta:cyber:threats', maxStaleMin: 240 },
  cryptoQuotes: { key: 'seed-meta:market:crypto', maxStaleMin: 30 },
  etfFlows: { key: 'seed-meta:market:etf-flows', maxStaleMin: 60 },
  gulfQuotes: { key: 'seed-meta:market:gulf-quotes', maxStaleMin: 30 },
  stablecoinMarkets: { key: 'seed-meta:market:stablecoins', maxStaleMin: 60 },
  naturalEvents: { key: 'seed-meta:natural:events', maxStaleMin: 360 },
  flightDelays: { key: 'seed-meta:aviation:faa', maxStaleMin: 90 },
  notamClosures: { key: 'seed-meta:aviation:notam', maxStaleMin: 240 },
  predictionMarkets: { key: 'seed-meta:prediction:markets', maxStaleMin: 90 },
  newsInsights: { key: 'seed-meta:news:insights', maxStaleMin: 30 },
  marketQuotes: { key: 'seed-meta:market:stocks', maxStaleMin: 30 },
  commodityQuotes: { key: 'seed-meta:market:commodities', maxStaleMin: 30 },
  cableHealth: { key: 'seed-meta:cable-health', maxStaleMin: 90 },
  macroSignals: { key: 'seed-meta:economic:macro-signals', maxStaleMin: 20 },
  bisPolicy: { key: 'seed-meta:economic:bis', maxStaleMin: 10080 },
  imfMacro: { key: 'seed-meta:economic:imf-macro', maxStaleMin: 100800 },
  shippingRates: { key: 'seed-meta:supply_chain:shipping', maxStaleMin: 420 },
  chokepoints: { key: 'seed-meta:supply_chain:chokepoints', maxStaleMin: 60 },
  gpsjam: { key: 'seed-meta:intelligence:gpsjam', maxStaleMin: 720 },
  positiveGeoEvents: { key: 'seed-meta:positive-events:geo', maxStaleMin: 60 },
  riskScores: { key: 'seed-meta:intelligence:risk-scores', maxStaleMin: 30 },
  iranEvents: { key: 'seed-meta:conflict:iran-events', maxStaleMin: 20160 },
  ucdpEvents: { key: 'seed-meta:conflict:ucdp-events', maxStaleMin: 420 },
  militaryFlights: { key: 'seed-meta:military:flights', maxStaleMin: 30 },
  satellites: { key: 'seed-meta:intelligence:satellites', maxStaleMin: 240 },
  weatherAlerts: { key: 'seed-meta:weather:alerts', maxStaleMin: 45 },
  spending: { key: 'seed-meta:economic:spending', maxStaleMin: 120 },
  techEvents: { key: 'seed-meta:research:tech-events', maxStaleMin: 480 },
  gdeltIntel: { key: 'seed-meta:intelligence:gdelt-intel', maxStaleMin: 420 },
  forecasts: { key: 'seed-meta:forecast:predictions', maxStaleMin: 90 },
  sectors: { key: 'seed-meta:market:sectors', maxStaleMin: 30 },
  techReadiness: { key: 'seed-meta:economic:worldbank-techreadiness:v1', maxStaleMin: 10080 },
  progressData: { key: 'seed-meta:economic:worldbank-progress:v1', maxStaleMin: 10080 },
  renewableEnergy: { key: 'seed-meta:economic:worldbank-renewable:v1', maxStaleMin: 10080 },
  intlDelays: { key: 'seed-meta:aviation:intl', maxStaleMin: 90 },
  theaterPosture: { key: 'seed-meta:theater-posture', maxStaleMin: 60 },
  correlationCards: { key: 'seed-meta:correlation:cards', maxStaleMin: 15 },
  portwatch: { key: 'seed-meta:supply_chain:portwatch', maxStaleMin: 720 },
  portwatchPortActivity: { key: 'seed-meta:supply_chain:portwatch-ports', maxStaleMin: 2160 },
  corridorrisk: { key: 'seed-meta:supply_chain:corridorrisk', maxStaleMin: 120 },
  chokepointTransits: { key: 'seed-meta:supply_chain:chokepoint_transits', maxStaleMin: 30 },
  transitSummaries: { key: 'seed-meta:supply_chain:transit-summaries', maxStaleMin: 30 },
  usniFleet: { key: 'seed-meta:military:usni-fleet', maxStaleMin: 720 },
  securityAdvisories: { key: 'seed-meta:intelligence:advisories', maxStaleMin: 120 },
  customsRevenue: { key: 'seed-meta:trade:customs-revenue', maxStaleMin: 1440 },
  comtradeFlows: { key: 'seed-meta:trade:comtrade-flows', maxStaleMin: 2880 },
  blsSeries: { key: 'seed-meta:economic:bls-series', maxStaleMin: 2880 },
  sanctionsPressure: { key: 'seed-meta:sanctions:pressure', maxStaleMin: 720 },
  crossSourceSignals: { key: 'seed-meta:intelligence:cross-source-signals', maxStaleMin: 30 },
  regionalSnapshots: { key: 'seed-meta:intelligence:regional-snapshots', maxStaleMin: 720 },
  sanctionsEntities: { key: 'seed-meta:sanctions:entities', maxStaleMin: 1440 },
  radiationWatch: { key: 'seed-meta:radiation:observations', maxStaleMin: 30 },
  groceryBasket: { key: 'seed-meta:economic:grocery-basket', maxStaleMin: 10080 },
  bigmac: { key: 'seed-meta:economic:bigmac', maxStaleMin: 10080 },
  fuelPrices: { key: 'seed-meta:economic:fuel-prices', maxStaleMin: 10080 },
  faoFoodPriceIndex: { key: 'seed-meta:economic:fao-ffpi', maxStaleMin: 86400 },
  thermalEscalation: { key: 'seed-meta:thermal:escalation', maxStaleMin: 360 },
  nationalDebt: { key: 'seed-meta:economic:national-debt', maxStaleMin: 10080 },
  tariffTrendsUs: { key: 'seed-meta:trade:tariffs:v1:840:all:10', maxStaleMin: 900 },
  consumerPricesOverview: { key: 'seed-meta:consumer-prices:overview:ae', maxStaleMin: 1500 },
  consumerPricesCategories: { key: 'seed-meta:consumer-prices:categories:ae:30d', maxStaleMin: 1500 },
  consumerPricesMovers: { key: 'seed-meta:consumer-prices:movers:ae:30d', maxStaleMin: 1500 },
  consumerPricesSpread: { key: 'seed-meta:consumer-prices:retailer-spread:ae:essentials-ae', maxStaleMin: 1500 },
  consumerPricesFreshness: { key: 'seed-meta:consumer-prices:freshness:ae', maxStaleMin: 1500 },
  defiTokens: { key: 'seed-meta:market:token-panels', maxStaleMin: 90 },
  aiTokens: { key: 'seed-meta:market:token-panels', maxStaleMin: 90 },
  otherTokens: { key: 'seed-meta:market:token-panels', maxStaleMin: 90 },
  fredBatch: { key: 'seed-meta:economic:fred:v1:FEDFUNDS:0', maxStaleMin: 1500 },
  ecbEstr: { key: 'seed-meta:economic:ecb-short-rates', maxStaleMin: 4320 },
  ecbEuribor3m: { key: 'seed-meta:economic:ecb-short-rates', maxStaleMin: 4320 },
  ecbEuribor6m: { key: 'seed-meta:economic:ecb-short-rates', maxStaleMin: 4320 },
  ecbEuribor1y: { key: 'seed-meta:economic:ecb-short-rates', maxStaleMin: 4320 },
  gscpi: { key: 'seed-meta:economic:gscpi', maxStaleMin: 2880 },
  fearGreedIndex: { key: 'seed-meta:market:fear-greed', maxStaleMin: 720 },
  breadthHistory: { key: 'seed-meta:market:breadth-history', maxStaleMin: 2880 },
  hormuzTracker: { key: 'seed-meta:supply_chain:hormuz_tracker', maxStaleMin: 2880 },
  earningsCalendar: { key: 'seed-meta:market:earnings-calendar', maxStaleMin: 1440 },
  econCalendar: { key: 'seed-meta:economic:econ-calendar', maxStaleMin: 1440 },
  cotPositioning: { key: 'seed-meta:market:cot', maxStaleMin: 14400 },
  crudeInventories: { key: 'seed-meta:economic:crude-inventories', maxStaleMin: 20160 },
  natGasStorage: { key: 'seed-meta:economic:nat-gas-storage', maxStaleMin: 20160 },
  spr: { key: 'seed-meta:economic:spr', maxStaleMin: 20160 },
  refineryInputs: { key: 'seed-meta:economic:refinery-inputs', maxStaleMin: 20160 },
  ecbFxRates: { key: 'seed-meta:economic:ecb-fx-rates', maxStaleMin: 5760 },
  eurostatCountryData: { key: 'seed-meta:economic:eurostat-country-data', maxStaleMin: 4320 },
  euGasStorage: { key: 'seed-meta:economic:eu-gas-storage', maxStaleMin: 2880 },
  euYieldCurve: { key: 'seed-meta:economic:yield-curve-eu', maxStaleMin: 4320 },
  euFsi: { key: 'seed-meta:economic:fsi-eu', maxStaleMin: 20160 },
  newsThreatSummary: { key: 'seed-meta:news:threat-summary', maxStaleMin: 60 },
  shippingStress: { key: 'seed-meta:supply_chain:shipping_stress', maxStaleMin: 45 },
  diseaseOutbreaks: { key: 'seed-meta:health:disease-outbreaks', maxStaleMin: 2880 },
  healthAirQuality: { key: 'seed-meta:health:air-quality', maxStaleMin: 180 },
  socialVelocity: { key: 'seed-meta:intelligence:social-reddit', maxStaleMin: 30 },
  wsbTickers: { key: 'seed-meta:intelligence:wsb-tickers', maxStaleMin: 30 },
  pizzint: { key: 'seed-meta:intelligence:pizzint', maxStaleMin: 30 },
  productCatalog: { key: 'seed-meta:product-catalog', maxStaleMin: 1080 },
  vpdTrackerRealtime: { key: 'seed-meta:health:vpd-tracker', maxStaleMin: 2880 },
  vpdTrackerHistorical: { key: 'seed-meta:health:vpd-tracker', maxStaleMin: 2880 },
  resilienceStaticIndex: { key: 'seed-meta:resilience:static', maxStaleMin: 576000 },
  resilienceRanking: { key: 'seed-meta:resilience:ranking', maxStaleMin: 720 },
  resilienceIntervals: { key: 'seed-meta:resilience:intervals', maxStaleMin: 20160 },
  energyExposure: { key: 'seed-meta:economic:owid-energy-mix', maxStaleMin: 50400 },
  energyMixAll: { key: 'seed-meta:economic:owid-energy-mix', maxStaleMin: 50400 },
  regulatoryActions: { key: 'seed-meta:regulatory:actions', maxStaleMin: 360 },
  energySpineCountries: { key: 'seed-meta:energy:spine', maxStaleMin: 2880 },
  electricityPrices: { key: 'seed-meta:energy:electricity-prices', maxStaleMin: 2880 },
  gasStorageCountries: { key: 'seed-meta:energy:gas-storage-countries', maxStaleMin: 2880 },
  energyIntelligence: { key: 'seed-meta:energy:intelligence', maxStaleMin: 720 },
  jodiOil: { key: 'seed-meta:energy:jodi-oil', maxStaleMin: 57600 },
  ieaOilStocks: { key: 'seed-meta:energy:iea-oil-stocks', maxStaleMin: 57600 },
  oilStocksAnalysis: { key: 'seed-meta:energy:oil-stocks-analysis', maxStaleMin: 72000 },
  jodiGas: { key: 'seed-meta:energy:jodi-gas', maxStaleMin: 57600 },
  lngVulnerability: { key: 'seed-meta:energy:jodi-gas', maxStaleMin: 57600 },
  chokepointBaselines: { key: 'seed-meta:energy:chokepoint-baselines', maxStaleMin: 576000 },
  sprPolicies: { key: 'seed-meta:energy:spr-policies', maxStaleMin: 576000 },
  aaiiSentiment: { key: 'seed-meta:market:aaii-sentiment', maxStaleMin: 20160 },
  portwatchChokepointsRef: { key: 'seed-meta:portwatch:chokepoints-ref', maxStaleMin: 2880 },
  chokepointFlows: { key: 'seed-meta:energy:chokepoint-flows', maxStaleMin: 720 },
  emberElectricity: { key: 'seed-meta:energy:ember', maxStaleMin: 2880 },
} as const;

const HEALTH_ON_DEMAND_KEYS = [
  'riskScoresLive',
  'usniFleetStale',
  'positiveEventsLive',
  'bisPolicy',
  'bisExchange',
  'bisCredit',
  'macroSignals',
  'shippingRates',
  'chokepoints',
  'minerals',
  'giving',
  'cyberThreatsRpc',
  'militaryBases',
  'temporalAnomalies',
  'displacement',
  'corridorrisk',
  'serviceStatuses',
  'militaryForecastInputs',
  'marketImplications',
  'simulationPackageLatest',
  'simulationOutcomeLatest',
  'newsThreatSummary',
  'resilienceRanking',
] as string[];

HEALTH_ON_DEMAND_KEYS.push('cryptoSectors', 'ddosAttacks', 'economicStress', 'trafficAnomalies');

const HEALTH_EMPTY_OK_KEYS = [
  'notamClosures',
  'faaDelays',
  'gpsjam',
  'positiveGeoEvents',
  'weatherAlerts',
  'earningsCalendar',
  'econCalendar',
  'cotPositioning',
  'usniFleet',
  'newsThreatSummary',
] as const;

const HEALTH_CASCADE_GROUPS = {
  theaterPosture: ['theaterPosture', 'theaterPostureLive', 'theaterPostureBackup'],
  theaterPostureLive: ['theaterPosture', 'theaterPostureLive', 'theaterPostureBackup'],
  theaterPostureBackup: ['theaterPosture', 'theaterPostureLive', 'theaterPostureBackup'],
  militaryFlights: ['militaryFlights', 'militaryFlightsStale'],
  militaryFlightsStale: ['militaryFlights', 'militaryFlightsStale'],
} as const;

const BOOTSTRAP_TO_HEALTH_NAME = {
  insights: 'newsInsights',
  predictions: 'predictionMarkets',
} as const;

const DEFAULT_OWNER = { github: 'lspassos1' } as const;

function normalizeDomain(rawKey: string): string {
  return rawKey.split(':')[0].replace(/_/g, '-');
}

function extractVersionTag(key: string): `v${number}` | undefined {
  const match = key.match(/(?:^|[:-])(v\d+)(?:$|[:])/);
  return match?.[1] as `v${number}` | undefined;
}

function buildDatasets(): DatasetContract[] {
  const datasets = new Map<string, DatasetContract>();

  const register = (logicalName: string, redisKey: string): DatasetContract => {
    const existing = datasets.get(logicalName);
    if (existing) {
      return existing;
    }

    const dataset: DatasetContract = {
      id: `${normalizeDomain(redisKey)}.${logicalName}`,
      displayName: logicalName,
      domain: normalizeDomain(redisKey),
      description: `Dataset contract for ${logicalName}`,
      owner: { ...DEFAULT_OWNER },
      redis: {
        key: redisKey,
        versionTag: extractVersionTag(redisKey),
        payload: 'json',
      },
    };

    datasets.set(logicalName, dataset);
    return dataset;
  };

  for (const [logicalName, redisKey] of Object.entries(HEALTH_BOOTSTRAP_KEYS)) {
    register(logicalName, redisKey).health = { bucket: 'bootstrap' };
  }

  for (const [logicalName, redisKey] of Object.entries(HEALTH_BOOTSTRAP_ADDITIONS)) {
    register(logicalName, redisKey).health = { bucket: 'standalone', onDemand: true };
  }

  for (const [logicalName, redisKey] of Object.entries(HEALTH_STANDALONE_KEYS)) {
    register(logicalName, redisKey).health = { bucket: 'standalone' };
  }

  for (const [alias, redisKey] of Object.entries(BOOTSTRAP_ALIASES)) {
    const logicalName = BOOTSTRAP_TO_HEALTH_NAME[alias as keyof typeof BOOTSTRAP_TO_HEALTH_NAME] ?? alias;
    const dataset = register(logicalName, redisKey);
    dataset.bootstrap = {
      alias,
      tier: BOOTSTRAP_TIERS[alias as keyof typeof BOOTSTRAP_TIERS],
      public: true,
      redisReadMode: 'unprefixed',
    };
  }

  for (const [logicalName, meta] of Object.entries(HEALTH_SEED_META)) {
    const dataset = datasets.get(logicalName);
    if (!dataset?.health) {
      continue;
    }
    dataset.health.seedMetaKey = meta.key;
    dataset.health.maxStaleMin = meta.maxStaleMin;
  }

  for (const logicalName of HEALTH_ON_DEMAND_KEYS) {
    const dataset = datasets.get(logicalName);
    if (dataset?.health) {
      dataset.health.onDemand = true;
    }
  }

  for (const logicalName of HEALTH_EMPTY_OK_KEYS) {
    const dataset = datasets.get(logicalName);
    if (dataset?.health) {
      dataset.health.emptyOk = true;
    }
  }

  const cascadeGroupsByKey = new Map<string, string[]>();
  for (const members of Object.values(HEALTH_CASCADE_GROUPS)) {
    const key = [...members].sort().join('|');
    if (!cascadeGroupsByKey.has(key)) {
      cascadeGroupsByKey.set(key, [...members]);
    }
  }

  for (const members of cascadeGroupsByKey.values()) {
    const groupName = members.includes('theaterPosture')
      ? 'theater-posture'
      : members.includes('militaryFlights')
        ? 'military-flights'
        : members.slice().sort().join('|');

    for (const logicalName of members) {
      const dataset = datasets.get(logicalName);
      if (dataset?.health) {
        dataset.health.cascadeGroup = groupName;
      }
    }
  }

  return [...datasets.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const DATASETS: DatasetContract[] = buildDatasets();

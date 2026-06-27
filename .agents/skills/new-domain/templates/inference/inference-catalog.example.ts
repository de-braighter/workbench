// EXAMPLE inference catalog — replace the indicator key, prior, and projection paths
// with your domain's real indicator. Lives in apps/{{DOMAIN}}-api/src/config/ (NOT the
// library — the lib must not depend on substrate-runtime).
import {
  asJsonPath, type ObservationProjection, type IndicatorKey,
} from '@de-braighter/substrate-contracts/inference';
import { InMemoryInferenceCatalog } from '@de-braighter/substrate-runtime';

export const EXAMPLE_INDICATOR_KEY = '{{DOMAIN}}.example_indicator' as IndicatorKey;

function requireJsonPath(raw: string) {
  const r = asJsonPath(raw);
  if (!r.ok) throw new Error(`Invalid JsonPath "${raw}": ${r.error.message}`);
  return r.value;
}

export const EXAMPLE_PROJECTION: ObservationProjection = {
  indicatorKey: EXAMPLE_INDICATOR_KEY,
  source: 'event-log',
  eventTypes: ['{{DOMAIN}}:ExampleObserved.v1'],
  numeratorPath: requireJsonPath('value'),
  timestampPath: requireJsonPath('observedAt'),
};

export function build{{DOMAIN_PASCAL}}Catalog(): InMemoryInferenceCatalog {
  return new InMemoryInferenceCatalog([
    {
      indicatorKey: EXAMPLE_INDICATOR_KEY,
      conjugateHint: 'normal',     // or 'beta' / 'lognormal'
      priorMean: 0, priorSd: 5, observationSd: 1,
      observationProjection: EXAMPLE_PROJECTION,
    },
  ]);
}

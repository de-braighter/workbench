Splice this inference provider chain into apps/{{DOMAIN}}-api/src/app/app.module.ts (after the DB wiring); add ReadoutController to controllers and ReadoutService to providers:

```typescript
import {
  GucPrismaRunner,
  PrismaEvidenceLogRepository,
  EVIDENCE_REPOSITORY,
  INFERENCE_CATALOG,
  InferenceBackboneRouter,
  type EvidenceRepository,
  type InferenceCatalog,
} from '@de-braighter/substrate-runtime';
import {
  DISTRIBUTION_CATALOG,
  MEMBER_RESOLUTION_PORT,
  type DistributionCatalog,
  type MemberResolution,
} from '@de-braighter/substrate-contracts';
import {
  INFERENCE_BACKBONE,
  NUMPYRO_SIDECAR,
} from '@de-braighter/substrate-contracts/inference';
import { build{{DOMAIN_PASCAL}}Catalog } from '../config/inference-catalog.js';
import { ReadoutController } from '../readout/readout.controller.js';
import { ReadoutService } from '../readout/readout.service.js';

// Before @Module — build catalog once and reuse in providers:
const catalog = build{{DOMAIN_PASCAL}}Catalog();

/**
 * MemberResolution no-op — replace if your domain uses aggregate (group) subjects.
 * InferenceBackboneRouter only calls resolveMembers for aggregate subjects.
 */
const NULL_MEMBER_RESOLUTION: MemberResolution = {
  resolveMembers(): Promise<never> {
    return Promise.reject(
      new Error('{{DOMAIN}}: MemberResolution.resolveMembers should not be called — no aggregate subjects'),
    );
  },
};

// Inside @Module({ providers: [ ... ] }):
{ provide: INFERENCE_CATALOG,      useValue: catalog },
{
  provide: EVIDENCE_REPOSITORY,
  useFactory: (r: GucPrismaRunner, c: InferenceCatalog) =>
    new PrismaEvidenceLogRepository(r, c),
  inject: [GucPrismaRunner, INFERENCE_CATALOG],
},
{ provide: NUMPYRO_SIDECAR,        useValue: null },
{ provide: MEMBER_RESOLUTION_PORT, useValue: NULL_MEMBER_RESOLUTION },
{
  provide: INFERENCE_BACKBONE,
  useFactory: (
    cat: InferenceCatalog,
    evidence: EvidenceRepository,
    sidecar: null,
    members: MemberResolution,
    distributions: DistributionCatalog,
  ) => new InferenceBackboneRouter(cat, evidence, sidecar, members, distributions),
  // DISTRIBUTION_CATALOG comes from SubstrateModule.forRoot's default binding —
  // InMemoryDistributionCatalog seeded with the Normal family when the prisma
  // client has no distributionCatalog delegate. Do NOT provide it yourself.
  inject: [INFERENCE_CATALOG, EVIDENCE_REPOSITORY, NUMPYRO_SIDECAR, MEMBER_RESOLUTION_PORT, DISTRIBUTION_CATALOG],
},
```

Substrate ≥1.1 made the `DistributionCatalog` the router's **5th required constructor
arg** — a 4-arg `new InferenceBackboneRouter(...)` no longer typechecks. The
`DISTRIBUTION_CATALOG` token is exported from `@de-braighter/substrate-contracts`
(root), not `…/inference`.

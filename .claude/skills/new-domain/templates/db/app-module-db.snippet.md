Splice this DB wiring into apps/{{DOMAIN}}-api/src/app/app.module.ts (imports + the appRoleClient/guard + the SubstrateModule.forRoot options + the providers):

```typescript
import {
  GucPrismaRunner,
  InMemoryConsentReceiptRepository,
  InMemoryPackRoleAssignmentRepository,
  PrismaOutboxWriter,
  SubstrateModule,
  DOMAIN_EVENT_PUBLISHER,
} from '@de-braighter/substrate-runtime';
import { PrismaClient } from '@prisma/client';
import { {{DOMAIN_PASCAL_UPPER}}_MANIFEST } from '../config/manifest.js';
import { {{DOMAIN_PASCAL_UPPER}}_TENANTS } from '../config/tenants.js';

const appRoleUrl = process.env['SUBSTRATE_APP_DATABASE_URL'];
if (!appRoleUrl) {
  throw new Error(
    '[{{DOMAIN}}-api] SUBSTRATE_APP_DATABASE_URL is required — ' +
    'without it PrismaClient falls back to the admin URL and bypasses RLS.',
  );
}

const appRoleClient = new PrismaClient({
  datasources: { db: { url: appRoleUrl } },
});

const runner = new GucPrismaRunner(appRoleClient);

// In @Module({ imports: [...] }):
SubstrateModule.forRoot({
  tenants: {{DOMAIN_PASCAL_UPPER}}_TENANTS,
  manifests: [{{DOMAIN_PASCAL_UPPER}}_MANIFEST],
  prismaClient: appRoleClient,
  packRoleAssignmentRepository: InMemoryPackRoleAssignmentRepository,
  consentReceiptRepository: InMemoryConsentReceiptRepository,
}),

// In @Module({ providers: [...] }):
{ provide: GucPrismaRunner,        useValue: runner },
{ provide: DOMAIN_EVENT_PUBLISHER, useValue: new PrismaOutboxWriter() },
```

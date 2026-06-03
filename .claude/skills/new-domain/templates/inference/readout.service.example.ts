// EXAMPLE readout — replace the subject(s) and the value mapping with your domain's.
import { Inject, Injectable } from '@nestjs/common';
import {
  INFERENCE_BACKBONE,
  type InferenceBackbone,
} from '@de-braighter/substrate-contracts/inference';
import { {{DOMAIN_PASCAL_UPPER}}_TENANT_PACK_ID, {{DOMAIN_PASCAL_UPPER}}_PLAN_ROOT_ID } from '../config/tenants.js';
import { EXAMPLE_INDICATOR_KEY } from '../config/inference-catalog.js';

// Replace with your domain's result shape.
export interface ReadoutResult {
  readonly subjectId: string;
  readonly mean: number;
  readonly p10: number;
  readonly p90: number;
}

// EXAMPLE subject UUID — replace with your domain's real subject UUIDs (or a loop over
// multiple subjects). The backbone uses subject.id only as the aggregate_id filter against
// kernel.event_log; kind:'person' is the v1 fast-path workaround (Normal-Normal rejects
// non-person subjects).
const EXAMPLE_SUBJECT_UUID = '00000000-0001-4000-8000-000000000001';

@Injectable()
export class ReadoutService {
  constructor(
    @Inject(INFERENCE_BACKBONE)
    private readonly backbone: InferenceBackbone,
  ) {}

  async readout(): Promise<ReadoutResult> {
    const r = await this.backbone.posterior({
      tenantPackId: {{DOMAIN_PASCAL_UPPER}}_TENANT_PACK_ID,
      treeRoot: {{DOMAIN_PASCAL_UPPER}}_PLAN_ROOT_ID,
      subject: { kind: 'person', id: EXAMPLE_SUBJECT_UUID },
      indicatorKey: EXAMPLE_INDICATOR_KEY,
    });

    if (!r.ok) {
      // Return zeroed-out sentinel on error so the endpoint stays available.
      return { subjectId: EXAMPLE_SUBJECT_UUID, mean: 0, p10: 0, p90: 0 };
    }

    const s = r.value.summary;
    return {
      subjectId: EXAMPLE_SUBJECT_UUID,
      // If your indicator is in natural (non-log) space, use s.mean / s.p10 / s.p90 directly.
      // For log-space indicators (e.g. log-price) apply Math.exp:
      //   mean: Math.exp(s.mean), p10: Math.exp(s.p10), p90: Math.exp(s.p90),
      mean: s.mean,
      p10:  s.p10,
      p90:  s.p90,
    };
  }
}

// EXAMPLE card — replace with your domain's item view.
import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { NgClass } from '@angular/common';
import type { ItemReadout, ItemHealthStatus } from '../readout.types';

// Replace with your domain's item label map (id → display name).
const ITEM_NAME: Record<string, string> = {
  'example-a': 'Example A',
  'example-b': 'Example B',
};

// Replace with your domain's item short-code map (id → short label).
const ITEM_CODE: Record<string, string> = {
  'example-a': 'EXA',
  'example-b': 'EXB',
};

@Component({
  selector: 'app-asset-card',
  standalone: true,
  imports: [NgClass],
  templateUrl: './asset-card.component.html',
  styleUrl: './asset-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetCardComponent {
  asset = input.required<ItemReadout>();

  // Replace computed label/code derivation with your domain's logic.
  code = computed(() => ITEM_CODE[this.asset().id] ?? this.asset().id.toUpperCase());
  name = computed(() => ITEM_NAME[this.asset().id] ?? this.asset().id);

  // Replace with your domain's primary value formatter.
  formatValue(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }

  // Maps health/status string to a CSS class suffix (health-online / health-stale / health-offline).
  healthClass(h: ItemHealthStatus): string {
    return `health-${h}`;
  }

  confidencePercent = computed(() => Math.round(this.asset().confidence * 100));
}

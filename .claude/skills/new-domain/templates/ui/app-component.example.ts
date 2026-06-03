// EXAMPLE shell — replace the title, the readout shape, and the card binding with your domain's.
import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { interval, Subscription, startWith, switchMap, catchError, of } from 'rxjs';
import { ReadoutService } from './readout.service';
import { AssetCardComponent } from './asset-card/asset-card.component';
import { DatePipe } from '@angular/common';
import type { ReadoutResult } from './readout.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AssetCardComponent, DatePipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  private service = inject(ReadoutService);

  readout  = signal<ReadoutResult | null>(null);
  loading  = signal(true);
  error    = signal<string | null>(null);
  ingesting = signal(false);

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = interval(10_000).pipe(
      startWith(0),
      switchMap(() =>
        this.service.readout().pipe(
          // CRITICAL: catchError INSIDE switchMap — keeps the polling stream alive on errors.
          // A raw error outside switchMap terminates the RxJS stream permanently.
          catchError((err: unknown) => {
            this.error.set(String(err));
            this.loading.set(false);
            return of(null);
          }),
        ),
      ),
    ).subscribe((result) => {
      if (result !== null) {
        this.readout.set(result);
        this.loading.set(false);
        this.error.set(null);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  triggerIngest(): void {
    this.ingesting.set(true);
    this.service.triggerIngest().subscribe({
      next: () => this.ingesting.set(false),
      error: () => this.ingesting.set(false),
    });
  }
}

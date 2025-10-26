/**
 * Complete MARTEM Architecture Test
 * 
 * This demonstrates all 6 component types working together:
 * - Modulator: Deduplicates events
 * - Afferent: Simulates external input  
 * - Receptor: Converts events to facets
 * - Transform: Adds metadata to facets
 * - Effector: Logs facet changes
 * - Maintainer: Counts frames
 */

import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  BaseModulator,
  BaseAfferent,
  BaseReceptor, 
  BaseTransform,
  BaseEffector,
  BaseMaintainer
} from '../src';
import {
  SpaceEvent,
  ReadonlyVEILState,
  Facet,
  VEILDelta,
  FacetDelta,
  EffectorResult,
  AfferentContext,
  Frame
} from '../src';

/**
 * Modulator that deduplicates events within a time window
 */
class DeduplicationModulator extends BaseModulator {
  private recentEvents = new Map<string, number>();
  private windowMs = 100;
  
  process(events: SpaceEvent[]): SpaceEvent[] {
    const now = Date.now();
    const processed: SpaceEvent[] = [];
    
    for (const event of events) {
      const key = `${event.topic}:${JSON.stringify(event.payload)}`;
      const lastSeen = this.recentEvents.get(key);
      
      if (!lastSeen || now - lastSeen > this.windowMs) {
        this.recentEvents.set(key, now);
        processed.push(event);
        console.log(`[Modulator] Allowing event: ${event.topic}`);
      } else {
        console.log(`[Modulator] Deduplicating event: ${event.topic}`);
      }
    }
    
    // Clean old entries
    for (const [key, time] of this.recentEvents) {
      if (now - time > this.windowMs * 2) {
        this.recentEvents.delete(key);
      }
    }
    
    return processed;
  }
}

/**
 * Afferent that generates periodic events
 */
class TickerAfferent extends BaseAfferent<{ interval: number }, { stop: boolean }> {
  private intervalId?: NodeJS.Timeout;
  private tickCount = 0;
  
  protected async onInitialize(): Promise<void> {
    console.log(`[Afferent] Initialized with interval: ${this.context.config.interval}ms`);
  }
  
  protected async onStart(): Promise<void> {
    console.log('[Afferent] Starting ticker...');
    this.intervalId = setInterval(() => {
      this.tickCount++;
      this.emit({
        topic: 'ticker:tick',
        source: { elementId: 'ticker', elementPath: [] },
        timestamp: Date.now(),
        payload: { count: this.tickCount }
      });
      console.log(`[Afferent] Emitted tick #${this.tickCount}`);
    }, this.context.config.interval);
  }
  
  protected async onStop(): Promise<void> {
    console.log('[Afferent] Stopping ticker...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
  
  protected async onDestroyAfferent(): Promise<void> {
    console.log('[Afferent] Destroyed');
  }
  
  protected async onCommand(command: { stop: boolean }): Promise<void> {
    if (command.stop) {
      await this.stop();
    }
  }
}

/**
 * Receptor that converts ticker events to facets
 */
class TickerReceptor extends BaseReceptor {
  topics = ['ticker:tick'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const { count } = event.payload as { count: number };
    console.log(`[Receptor] Converting tick event #${count} to facet`);
    
    return [{
      id: `tick-${count}`,
      type: 'tick-event',
      content: `Tick #${count}`,
      state: { count },
      timestamp: event.timestamp
    }];
  }
}

/**
 * Transform that creates summary facets every 3 ticks
 */
class TickSummaryTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Count tick events
    const tickEvents = Array.from(state.facets.values())
      .filter(f => f.type === 'tick-event');
    
    // Every 3 ticks, create a summary
    if (tickEvents.length >= 3) {
      // Check if we already have a summary for this set
      const summaryId = `tick-summary-${Math.floor(tickEvents.length / 3)}`;
      const existingSummary = state.facets.get(summaryId);
      
      if (!existingSummary) {
        console.log(`[Transform] Creating summary for ${tickEvents.length} ticks`);
        deltas.push({
          type: 'addFacet',
          facet: {
            id: summaryId,
            type: 'tick-summary',
            content: `Summary: ${tickEvents.length} ticks received`,
            state: {
              tickCount: tickEvents.length,
              lastThree: tickEvents.slice(-3).map((t: any) => t.state.count)
            },
            timestamp: Date.now()
          }
        });
      }
    }
    
    return deltas;
  }
}

/**
 * Effector that logs tick events and summaries
 */
class TickLoggerEffector extends BaseEffector {
  facetFilters = [
    { type: 'tick-event' },
    { type: 'tick-summary' }
  ];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type === 'added') {
        const facet = change.facet as any;
        if (facet.type === 'tick-event') {
          console.log(`[Effector] New tick: ${facet.content}`);
        } else if (facet.type === 'tick-summary') {
          console.log(`[Effector] Summary: ${facet.content} - Last three: [${facet.state.lastThree.join(', ')}]`);
        }
      }
    }
    
    return { events: [] };
  }
}

/**
 * Maintainer that tracks frame statistics
 */
class FrameStatsMaintainer extends BaseMaintainer {
  private frameCount = 0;
  private eventCount = 0;
  
  async process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<import('../src/spaces/receptor-effector-types').MaintainerResult> {
    this.frameCount++;
    this.eventCount += frame.events.length;
    
    console.log(`[Maintainer] Frame #${this.frameCount}: ${frame.events.length} events, ${changes.length} changes`);
    
    // Every 5 frames, emit a stats event
    if (this.frameCount % 5 === 0) {
      return {
        events: [{
          topic: 'stats:report',
          source: { elementId: 'stats', elementPath: [] },
          timestamp: Date.now(),
          payload: {
            frames: this.frameCount,
            totalEvents: this.eventCount,
            avgEventsPerFrame: this.eventCount / this.frameCount
          }
        }]
      };
    }
    
    return { events: [] };
  }
}

async function main() {
  console.log('=== MARTEM Architecture Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Register all MARTEM components
  console.log('1. Registering MARTEM components...\n');
  
  // Phase 0: Modulator
  const modulator = new DeduplicationModulator();
  space.addModulator(modulator);
  
  // Phase 1: Receptor
  const receptor = new TickerReceptor();
  space.addReceptor(receptor);
  
  // Phase 2: Transform
  const transform = new TickSummaryTransform();
  space.addTransform(transform);
  
  // Phase 3: Effector
  const effector = new TickLoggerEffector();
  space.addEffector(effector);
  
  // Phase 4: Maintainer
  const maintainer = new FrameStatsMaintainer();
  space.addMaintainer(maintainer);
  
  // Create and start afferent
  console.log('2. Starting afferent...\n');
  const afferent = new TickerAfferent();
  
  // Mock context for the afferent
  const afferentContext: AfferentContext<{ interval: number }> = {
    emit: (event) => space.emit(event),
    emitError: (error) => console.error('[Afferent Error]', error),
    config: { interval: 200 },
    afferentId: 'ticker-1'
  };
  
  await afferent.initialize(afferentContext);
  await afferent.mount(space);
  await afferent.start();
  
  console.log('3. Running for 1 second...\n');
  
  // Test deduplication by emitting duplicate events
  setTimeout(() => {
    console.log('\n4. Testing deduplication...\n');
    space.emit({
      topic: 'ticker:tick',
      source: { elementId: 'test', elementPath: [] },
      timestamp: Date.now(),
      payload: { count: 999 }
    });
    // Immediate duplicate
    space.emit({
      topic: 'ticker:tick',
      source: { elementId: 'test', elementPath: [] },
      timestamp: Date.now(),
      payload: { count: 999 }
    });
  }, 500);
  
  // Stop after 1 second
  setTimeout(async () => {
    console.log('\n5. Stopping afferent...\n');
    await afferent.stop();
    
    // Final state check
    setTimeout(() => {
      console.log('\n6. Final state:');
      const state = veilState.getState();
      console.log(`- Total frames: ${state.currentSequence}`);
      console.log(`- Facets in state: ${state.facets.size}`);
      
      console.log('\n✅ MARTEM test complete!');
      process.exit(0);
    }, 100);
  }, 1000);
}

main().catch(console.error);

import { ReadonlyVEILState, SpaceEvent, FacetDelta } from '../spaces/receptor-effector-types';
import { BaseMaintainer } from '../components/base-martem';
import { VEILStateManager } from '../veil/veil-state';
import { FileStorageAdapter } from './file-storage';
import { FrameDelta, PersistenceSnapshot, ElementOperation } from './types';
import { serializeVEILState, serializeElement } from './serialization';
import { Frame } from '../veil/types';
import { Space } from '../spaces/space';

export interface PersistenceMaintainerConfig {
  storagePath: string;
  snapshotInterval?: number; // Default: every 100 frames
  maxDeltasPerFile?: number; // Default: 1000
}

/**
 * Maintainer that handles persistence of VEIL state
 * Runs in Phase 4 after all other processing is complete
 */
export class PersistenceMaintainer extends BaseMaintainer {
  private storage: FileStorageAdapter;
  private lastSnapshotSequence: number = 0;
  private elementOperations: ElementOperation[] = [];
  
  constructor(
    private veilState: VEILStateManager,
    private space: Space,
    private config: PersistenceMaintainerConfig
  ) {
    super();
    this.storage = new FileStorageAdapter(config.storagePath);
  }
  
  async process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<import('../spaces/receptor-effector-types').MaintainerResult> {
    // Save the frame delta
    this.saveDelta(frame, frame.sequence).catch(err => {
      console.error('[PersistenceMaintainer] Failed to save delta:', err);
    });
    
    // Check if we need a snapshot
    const snapshotInterval = this.config.snapshotInterval || 100;
    const currentSequence = this.veilState.getState().currentSequence;
    if (currentSequence - this.lastSnapshotSequence >= snapshotInterval) {
      // Snapshot the CURRENT state (which is one frame behind during Phase 4)
      this.createSnapshot(currentSequence).catch(err => {
        console.error('[PersistenceMaintainer] Failed to create snapshot:', err);
      });
      this.lastSnapshotSequence = currentSequence;
    }
    
    // Clear element operations after snapshot
    if (this.elementOperations.length > 0 && frame.sequence % snapshotInterval === 0) {
      this.elementOperations = [];
    }
    
    return { events: [] }; // No events to emit
  }
  
  private async saveDelta(frame: Frame, sequence: number): Promise<void> {
    // Create a minimal frame representation for delta storage
    // We only need deltas, sequence, and timestamp - not events or transition data
    const minimalFrame: Frame = {
      sequence: frame.sequence,
      timestamp: frame.timestamp,
      uuid: frame.uuid,
      events: [],  // Events not needed for replay
      deltas: frame.deltas,
      transition: {
        sequence: frame.transition.sequence,
        timestamp: frame.transition.timestamp,
        elementOps: [],  // Element ops tracked separately
        componentOps: [],
        componentChanges: [],
        veilOps: []
      }
    };
    
    const delta: FrameDelta = {
      sequence,
      timestamp: frame.timestamp,
      lifecycleId: this.space.lifecycleId,  // Tag with current lifecycle
      frame: minimalFrame,
      elementOperations: [...this.elementOperations]
    };
    
    // Save using the storage adapter
    await this.storage.saveDelta(delta);
  }
  
  async createSnapshot(sequence?: number): Promise<void> {
    // Get the full state
    const state = this.veilState.getState();

    // Use provided sequence or current sequence
    const snapshotSequence = sequence !== undefined ? sequence : state.currentSequence;
    
    // Element tree is now fully stored in element-tree facets within VEIL
    // No need for separate elementTree serialization
    const elementTree = {
      id: this.space.id,
      name: 'root',
      type: 'Space',
      active: true,
      subscriptions: [],
      components: [],
      children: []
    };
    
    // Create snapshot
    const snapshot: PersistenceSnapshot = {
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: snapshotSequence,
      lifecycleId: this.space.lifecycleId,  // Tag with current lifecycle
      spaceId: this.space.id,                // Stable Space ID
      veilState: serializeVEILState(state),
      elementTree, // Minimal - only for backward compatibility
      metadata: {
        facetCount: state.facets.size,
        streamCount: state.streams.size,
        agentCount: state.agents.size
      }
    };

    // Save snapshot
    await this.storage.saveSnapshot(snapshot);

    this.lastSnapshotSequence = snapshotSequence;
    console.log(`[PersistenceMaintainer] Created snapshot at sequence ${snapshotSequence}`);
  }
}

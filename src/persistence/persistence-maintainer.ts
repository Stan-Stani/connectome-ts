import { ReadonlyVEILState, SpaceEvent, FacetDelta } from '../spaces/receptor-effector-types';
import { BaseMaintainer } from '../components/base-martem';
import { VEILStateManager } from '../veil/veil-state';
import { FileStorageAdapter } from './file-storage';
import { FrameDelta, PersistenceSnapshot } from './types';
import { serializeVEILState, serializeSpace } from './serialization';
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

  // Named 'rootSpace' to avoid conflict with Component.space getter
  private rootSpace: Space;
  private veilState: VEILStateManager;
  private config: PersistenceMaintainerConfig;

  constructor(
    veilState: VEILStateManager,
    space: Space,
    config: PersistenceMaintainerConfig
  ) {
    super();
    this.veilState = veilState;
    this.rootSpace = space;
    this.config = config;
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
    if (frame.sequence % snapshotInterval === 0) {
      // Cleanup if needed
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
      lifecycleId: this.rootSpace.lifecycleId,  // Tag with current lifecycle
      frame: minimalFrame
    };
    
    // Save using the storage adapter
    await this.storage.saveDelta(delta);
  }
  
  async createSnapshot(sequence?: number): Promise<void> {
    // Get the full state
    const state = this.veilState.getState();

    // Use provided sequence or current sequence
    const snapshotSequence = sequence !== undefined ? sequence : state.currentSequence;
    
    // Serialize Space (replaces element tree)
    const serializedSpace = serializeSpace(this.rootSpace);
    
    // Create snapshot
    const snapshot: PersistenceSnapshot = {
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: snapshotSequence,
      lifecycleId: this.rootSpace.lifecycleId,  // Tag with current lifecycle
      spaceId: this.rootSpace.id,                // Stable Space ID
      veilState: serializeVEILState(state),
      space: serializedSpace,
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

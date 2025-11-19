/**
 * ActiveStreamTransform
 * 
 * Sets frame.activeStream based on events in the frame.
 * Generic transform that works for any adapter (Discord, Slack, file editor, etc.)
 * 
 * Uses the LAST event with streamId (most recent activity)
 * This ensures currentStream reflects the most recent stream interaction.
 */

import { BaseTransform } from '../components/base-martem';
import { ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { VEILDelta } from '../veil/types';

export class ActiveStreamTransform extends BaseTransform {
  // Priority: Early in Phase 2, before rendering (ContextTransform is 100)
  priority = 50;
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Get current frame being processed
    const space = this.space as any;
    const frame = space?.getCurrentFrame();
    
    if (!frame) {
      return [];
    }
    
    // Skip if activeStream already set
    if (frame.activeStream) {
      return [];
    }
    
    // Find LAST event with streamId (most recent activity)
    // Iterate backwards to get most recent first
    for (let i = frame.events.length - 1; i >= 0; i--) {
      const event = frame.events[i];
      const payload = event.payload as any;
      
      if (payload?.streamId) {
        // Set frame's activeStream from this event
        frame.activeStream = {
          streamId: payload.streamId,
          streamType: payload.streamType || 'unknown',
          metadata: {
            ...(payload.metadata || {}),
            eventTopic: event.topic
          }
        };
        
        console.log(`[ActiveStreamTransform] Set frame ${frame.sequence} activeStream to ${payload.streamId} (from event ${i}/${frame.events.length})`);
        break;  // Use most recent (last) stream found
      }
    }
    
    return [];  // No VEIL deltas, just side effect on frame
  }
}


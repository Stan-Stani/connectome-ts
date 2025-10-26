# HUD Frame Timing Fix

**Date**: October 2025  
**Issue**: HUD/ContextTransform was always one frame behind  
**Solution**: Include current frame explicitly during rendering

## The Problem

The ContextTransform runs during Phase 2 of frame processing to generate context for agent activations. However, it was only seeing `frameHistory`, which doesn't include the current frame being processed.

Frame processing timeline:
1. Phase 0: Modulators preprocess events
2. Phase 1: Receptors convert events to VEIL deltas
3. Phase 2: Transforms run (including ContextTransform)
4. Phase 3: Effectors react to changes
5. Phase 4: Maintainers do cleanup
6. **AFTER ALL PHASES**: `finalizeFrame()` adds frame to `frameHistory`

This meant agents were making decisions without seeing the most recent events!

## The Solution

Modified `ContextTransform` to explicitly get the current frame from Space and include it in rendering:

```typescript
// Get current frame from Space to include in rendering
const space = this.element?.findSpace() as any;
const currentFrame = space?.getCurrentFrame();

// Combine frameHistory with current frame so agent sees everything
const allFrames = [...fullState.frameHistory];
if (currentFrame) {
  allFrames.push(currentFrame);
}

const context = this.hud.render(
  allFrames,  // Now includes current frame!
  fullState.facets,
  this.compressionEngine,
  agentOptions
);
```

## Impact

- Agents now see ALL events including those from the current frame
- No changes to frame lifecycle or when frames are finalized
- Backwards compatible - if no current frame exists, behaves as before
- CompressionTransform doesn't need this fix (it compresses historical frames)

## Testing

To verify the fix works:
1. Send a message that should trigger an immediate agent response
2. Agent should see and respond to that message in the same frame
3. Check rendered context in debug UI to confirm current frame is included

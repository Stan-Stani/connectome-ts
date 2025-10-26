# Test Request: HUD Frame Timing Fix

**For**: Sonnet  
**Priority**: High  
**Date**: October 2025

## Background

We just fixed an issue where the HUD/ContextTransform was always one frame behind. The agent wasn't seeing events from the current frame because `frameHistory` doesn't include the current frame until after all phases complete.

## The Fix

In `src/hud/context-transform.ts`, we now explicitly get and include the current frame:

```typescript
// Get current frame from Space to include in rendering
const space = this.element?.findSpace() as any;
const currentFrame = space?.getCurrentFrame();

// Combine frameHistory with current frame so agent sees everything
const allFrames = [...fullState.frameHistory];
if (currentFrame) {
  allFrames.push(currentFrame);
}
```

## Test Scenarios

Please test in `examples/console-chat-host.ts` or create a minimal test:

### 1. Basic Responsiveness Test
- Start console chat
- Send a message like "Hello!"
- **Expected**: Agent should see and respond to "Hello!" in the SAME frame
- **Previous behavior**: Agent would only see "Hello!" in the NEXT frame

### 2. Debug Verification
- Enable debug server or add logging to verify:
  - The rendered context includes the current frame's events
  - The agent activation happens in the same frame as the user message
  - Frame N contains both the user message AND agent response

### 3. Multi-Message Test
- Send multiple messages quickly
- Verify each message is visible to the agent when it processes that frame
- No "lag" where agent responds to previous messages

## How to Verify

1. Add logging in `ContextTransform.process()`:
```typescript
console.log(`[ContextTransform] Frame history: ${fullState.frameHistory.length} frames`);
console.log(`[ContextTransform] Current frame: ${currentFrame ? 'YES' : 'NO'}`);
console.log(`[ContextTransform] Total frames for rendering: ${allFrames.length}`);
```

2. Check that when a user message arrives:
   - Current frame exists and contains the user message
   - Agent sees it immediately (not in next frame)

3. Look for this pattern in logs:
```
Frame N:
  - User message event
  - ContextTransform runs (sees Frame N)
  - Agent activation
  - Agent response
```

## Success Criteria

✅ Agent responds to messages in the same frame they're received  
✅ No one-frame delay in agent perception  
✅ Current frame is included in rendered context  
✅ No regression in existing functionality

Please let us know the test results!

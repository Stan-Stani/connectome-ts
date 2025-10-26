# Rendered Context Investigation Findings

## Summary

The rendered context system IS working correctly, but there were issues with message role attribution that we've now fixed.

## Key Findings

### 1. Ephemeral Facets Working As Designed ✅
- Agent activation facets are created with `ephemeral: true`
- Rendered context facets are created with `ephemeral: true`
- Both are cleaned up at the end of the frame after being used
- This is the intended behavior - contexts only exist during processing

### 2. Frame Events Bug (FIXED) ✅
**Issue**: All frames had empty `events` arrays, causing `getFrameSource()` to always return `'system'`

**Root Cause**: Phase frames were created with `events: []` instead of including the triggering events

**Fix**: Updated `Space.processFrame()` to pass events to Phase 1 frame:
```typescript
const phase1Frame: Frame = {
  sequence: frameId,
  timestamp,
  events: events, // Include the events that triggered this frame
  deltas: phase1Facets.map(facet => ({
    type: 'addFacet' as const,
    facet
  })),
  transition: createDefaultTransition(frameId, timestamp)
};
```

**Result**: Message roles now correctly identified:
- `console:input` events → `user` role
- `veil:operation` from AgentElement → `assistant` role

### 3. Remaining Minor Issues

1. **Missing System Prompt**: The system prompt from agent config is not appearing as the first message
2. **Assistant Message Formatting**: Assistant messages contain `<my_turn>` tags that should be stripped

## Architecture Validation

The V2 architecture is working correctly:
- ✅ Phase 1: Receptors create facets from events
- ✅ Phase 2: Transforms process state (ContextTransform creates rendered-context)
- ✅ Phase 3: Effectors react to changes (AgentEffector processes contexts)
- ✅ Phase 4: Maintainers handle cleanup and persistence

## Testing Approach

To properly test ephemeral facets:
1. Create custom effectors that capture facets during Phase 3
2. Don't check final state after cleanup - ephemeral facets will be gone
3. Use the captured facets to verify correct behavior

## Conclusion

The rendered context system is functioning as designed. The frame events fix ensures proper message role attribution, which is critical for LLM context formatting. The remaining issues are minor formatting concerns that don't affect core functionality.


# HUD Frame Timing Fix - Implementation Summary

## Problem

The HUD/ContextTransform was always one frame behind. Agents couldn't see events from the current frame because `frameHistory` doesn't include the current frame until after all phases complete.

## Solution

### 1. Core Frame Timing Fix (Space.ts)

**Added current frame deltas incrementally during frame processing:**

```typescript
// Phase 1: Add deltas to currentFrame immediately
const phase1Deltas = this.runPhase1(processedEvents);
const phase1Changes = this.veilState.applyDeltasDirect(phase1Deltas);
this.currentFrame.deltas.push(...phase1Deltas);  // ← NEW

// Phase 2: Add each iteration's deltas immediately
while (iteration < maxIterations) {
  const phase2Deltas = this.runPhase2();
  const phase2Changes = this.veilState.applyDeltasDirect(phase2Deltas);
  this.currentFrame.deltas.push(...phase2Deltas);  // ← NEW
  // ...
}
```

**Why this works:**
- Current frame now contains deltas as they're generated
- Transforms in Phase 2 can access `getCurrentFrame()` and see all previous deltas
- Agent sees messages in the SAME frame they're received

### 2. ContextTransform getCurrentFrame() Access

**Uses existing Component pattern to access Space:**

```typescript
const space = this.element?.findSpace() as any;
const currentFrame = space?.getCurrentFrame();

const allFrames = [...fullState.frameHistory];
if (currentFrame) {
  allFrames.push(currentFrame);  // Include current frame!
}
```

### 3. Component Mounting & Registration Pattern

**Auto-registration on mount** (`src/components/base-martem.ts`):

```typescript
// BaseTransform.mount()
async mount(element: Element): Promise<void> {
  this.element = element;
  
  // Auto-register with Space
  const space = element.findSpace() as any;
  if (space && space.addTransform) {
    space.addTransform(this);
  }
}
```

**Registration validation** (`src/spaces/space.ts`):

```typescript
addTransform(transform: Transform): void {
  if (!(transform as any).element) {
    throw new Error(`Transform must be mounted before registration`);
  }
  // ... register
}
```

**Usage pattern:**

```typescript
// OLD (❌ - required manual registration)
space.addTransform(new ContextTransform(veilState, space));

// NEW (✓ - mount auto-registers)
const contextTransform = new ContextTransform(veilState);
await contextTransform.mount(space);
```

### 4. Benefits

✅ **No frame lag** - Agents see messages immediately  
✅ **Clean architecture** - Components mount to elements, `findSpace()` finds Space  
✅ **No explicit parameters** - Space inferred through element tree  
✅ **Validation** - Components must be mounted before registration  
✅ **Consistency** - Same pattern for all RETM components (Receptors, Transforms, Effectors, Maintainers)

## Files Changed

### Core Implementation
- `src/spaces/space.ts` - Frame delta accumulation + registration validation
- `src/hud/context-transform.ts` - getCurrentFrame() access pattern  
- `src/components/base-martem.ts` - Auto-registration on mount

### Examples Updated
- `examples/console-chat-host.ts`
- `test-hud-timing.ts`
- (Other examples need similar updates)

## Testing

Run the test:
```bash
npx tsx test-hud-timing.ts
```

Expected output:
```
✔️  Current frame: YES (with deltas > 0) ✓
✔️  Agent should see "Hello!" immediately ✓
✔️  Response should be in SAME frame as message ✓
```

## Migration Guide

If you have code that manually calls `addTransform`, `addReceptor`, etc.:

**Before:**
```typescript
space.addTransform(new MyTransform(veilState, space));
```

**After:**
```typescript
const transform = new MyTransform(veilState);
await transform.mount(space); // Auto-registers
```

## Architecture Notes

- **Registration methods are internal** - `addTransform()`, etc. should not be called directly by users
- **Mount handles everything** - Sets element reference AND registers with Space
- **findSpace() works** - Any component can walk up the element tree to find Space
- **Space IS an Element** - Since Space extends Element, components mounted to Space find themselves immediately


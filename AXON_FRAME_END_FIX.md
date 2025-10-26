# AXON frame:end Removal Instructions

## Files to Update

### 1. `/discord-axon/src/modules/discord-axon-refactored.ts`
Line 226: Remove `this.element.subscribe('frame:end');`

### 2. `/discord-axon/src/modules/discord-control-panel.ts`
No changes needed - this file only subscribes to `frame:start`

## Quick Fix Script

Run this from the discord-axon directory:

```bash
cd /Users/olena/connectome-local/discord-axon

# Remove frame:end subscription from discord-axon-refactored.ts
sed -i '' '/this\.element\.subscribe.*frame:end/d' src/modules/discord-axon-refactored.ts

# Rebuild
npm run build
```

## Verification

After making the change:
1. Check that the line is removed
2. Build succeeds
3. Test Discord connection still works

## Why This Works

The Discord AXON components subscribed to `frame:end` but never actually processed these events in their `handleEvent` methods. They only use `frame:start` for initialization and pending message processing.


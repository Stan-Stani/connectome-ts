# BasicAgent Constructor Fix

The developer feedback mentioned: "Constructor signatures don't match intuition (BasicAgent needs config + provider separately, not as one object)"

## The Problem

```typescript
// BEFORE: Confusing separate parameters
const agent = new BasicAgent(
  config,      // What order?
  provider,    // Easy to mix up
  veilState,   // Optional?
  compression  // Another optional?
);
```

Issues:
- Parameter order is not intuitive
- Easy to pass arguments in wrong order
- Optional parameters unclear
- No parameter names to guide you

## The Solution

### 1. Factory Function (Recommended)
```typescript
const agent = createBasicAgent({
  name: 'Assistant',
  provider: new MockLLMProvider(),
  systemPrompt: 'You are helpful',
  temperature: 0.7,
  veilStateManager: new VEILStateManager()
});
```

Benefits:
- All configuration in one object
- Parameter names are clear
- Optional parameters obvious
- Can't get order wrong

### 2. Constructor Options Pattern
```typescript
const agent = new BasicAgent({
  config: {
    name: 'Assistant',
    systemPrompt: 'You are helpful'
  },
  provider: new MockLLMProvider(),
  veilStateManager: new VEILStateManager()
});
```

### 3. Backward Compatibility
```typescript
// Old way still works!
const agent = new BasicAgent(
  config,
  provider,
  veilState
);
```

## What Changed

1. **Added `createBasicAgent()` factory** - The recommended way to create agents
2. **Updated BasicAgent constructor** - Now accepts both patterns
3. **Exported from root** - Easy to discover and use

## Impact

The developer who struggled with non-intuitive constructors can now:
- Use a clean factory function with named parameters
- Can't accidentally swap parameter order
- Gets TypeScript hints for all options
- Existing code continues to work

This is a perfect example of how small API improvements can dramatically improve developer experience!

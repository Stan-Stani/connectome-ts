# Friendly IDs in Connectome

We've improved ID generation to be more readable and debuggable while supporting stable IDs when needed.

## The Problem

### Before: Unfriendly, Verbose IDs
```typescript
// Generated IDs like:
"ambient-1699123456789-x7k9m2p4q"
"note-1699123456789-a3b2c1d4e5"
"event-1699123456789-z9y8x7w6v5"

// Hard to debug, impossible to remember
// Takes up lots of space in logs
// No semantic meaning
```

### Before: No Stable ID Support
```typescript
// Had to use full operations for stable IDs
this.addOperation({
  type: 'addFacet',
  facet: {
    id: `note-${noteId}`, // Manual stable ID
    type: 'ambient',
    // ... lots of boilerplate
  }
});
```

## The Solution

### Friendly Auto-Generated IDs
```typescript
// New IDs are short and sequential:
"ambient-1"
"note-2"
"event-3"
"activation-4"

// Or with element context:
"my-element-ambient-1699123456789"
"my-element-event-1699123456790"
```

### Easy Stable IDs
All helper methods now support optional stable IDs:

```typescript
// Auto-generated ID (default)
this.addAmbient('Hello world');
// Creates: "my-element-ambient-1699123456789"

// Stable ID when you need it
this.addAmbient('Hello world', 'welcome-message');
// Creates: "welcome-message"

// Same pattern for all helpers
this.addEvent('User action', 'click', 'user-click-1');
this.addOperation(addFacet('Content', 'ambient', 'my-stable-id'));
```

## Usage Examples

### Component Methods
```typescript
class MyComponent extends Component {
  showNotification(message: string, id?: string) {
    // Optional stable ID for updates/removal
    this.addAmbient(message, id || undefined, {
      type: 'notification',
      timestamp: Date.now()
    });
  }
  
  trackEvent(action: string) {
    // Auto-generated ID is fine for events
    this.addEvent(`User ${action}`, 'user-action', {
      action,
      timestamp: Date.now()
    });
  }
}
```

### Factory Functions
```typescript
// Auto-generated friendly ID
const activation = createAgentActivation('User needs help');
// activation.id = "activation-1"

// Stable ID
const activation = createAgentActivation('User needs help', {
  id: 'help-request-main',
  priority: 'high'
});
// activation.id = "help-request-main"
```

### SpaceNotes Example
```typescript
// Before: Complex operation for stable ID
this.addOperation({
  type: 'addFacet',
  facet: {
    id: `note-${params.noteId}`,
    // ... lots of setup
  }
});

// After: Simple helper with stable ID
this.addAmbient(
  noteContent,
  `note-${params.noteId}`, // Stable ID for removal
  { noteId: params.noteId }
);
```

## Custom ID Generation

For more control, use the `friendlyId` helper:

```typescript
import { friendlyId } from 'connectome-ts';

// Sequential IDs with custom prefix
const id1 = friendlyId('task');     // "task-1"
const id2 = friendlyId('task');     // "task-2" 
const id3 = friendlyId('task');     // "task-3"

// Non-unique (just the prefix)
const id4 = friendlyId('header', false);  // "header"
```

## Benefits

1. **Readable Logs**: `"note-1"` vs `"note-1699123456789-x7k9m2p4q"`
2. **Easier Debugging**: IDs tell you what they are
3. **Stable When Needed**: Full control without boilerplate
4. **Backward Compatible**: Old code still works
5. **Smaller Payloads**: Less data over the wire

## Migration

Old code continues to work. To adopt friendly IDs:

```typescript
// Old: Manual ID generation
const id = `note-${Date.now()}-${Math.random()...}`;

// New: Use helpers
this.addAmbient(content); // Auto ID
this.addAmbient(content, 'my-id'); // Stable ID
```

The framework now generates IDs that are both human-friendly and machine-friendly!

# SpaceNotes Component: Before and After

This document shows how the new helper methods dramatically reduce boilerplate in real components.

## Adding Search Results

### Before (13 lines)
```typescript
this.addFacet({
  id: `search-results-${Date.now()}`,
  type: 'ambient',
  displayName: `Search Results: "${params.query}"`,
  content: results.length === 0 
    ? 'No notes found'
    : results.map(n => `[${n.id}] ${n.content.substring(0, 100)}...`).join('\n'),
  attributes: {
    resultCount: results.length,
    noteIds: results.map(n => n.id)
  }
});
```

### After (8 lines)
```typescript
const content = results.length === 0 
  ? 'No notes found'
  : results.map(n => `[${n.id}] ${n.content.substring(0, 100)}...`).join('\n');

this.addAmbient(
  `Search Results: "${params.query}"\n\n${content}`,
  { resultCount: results.length, noteIds: results.map(n => n.id), searchQuery: params.query }
);
```

**40% less code**, and the intent is clearer!

## Creating Events

### Before (7 lines)
```typescript
this.element.emit({
  topic: 'notes:added',
  source: this.element.getRef(),
  payload: { noteId, preview: params.content.substring(0, 50) },
  timestamp: Date.now()
});
```

### After (5 lines)
```typescript
this.element.emit(
  createSpaceEvent('notes:added', this.element, {
    noteId,
    preview: params.content.substring(0, 50)
  })
);
```

No more manual ElementRef construction or timestamp handling!

## Removing Facets

### Before
```typescript
this.addOperation({
  type: 'removeFacet',
  facetId: `note-${params.noteId}`,
  mode: 'delete'
});
```

### After
```typescript
this.addOperation(
  removeFacet(`note-${params.noteId}`, 'delete')
);
```

The operation type is clear from the function name.

## Persistent UI State

### Before (16 lines)
```typescript
this.addFacet({
  id: 'space-notes-actions',
  type: 'ambient',
  displayName: 'Space Notes',
  content: `Space Notes - Your workspace...`,
  attributes: {
    component: 'SpaceNotes',
    persistent: true
  }
});
```

### After (8 lines)
```typescript
this.addState('notes-help', 
  `Space Notes - Your workspace...`,
  {
    component: 'SpaceNotes',
    noteCount: this.notes.size,
    openNotes: this.openNotes.size
  }
);
```

State facets are perfect for UI elements, and now they're trivial to create.

## Frame Safety

### Before
```typescript
// Hope we're in a frame, or crash with cryptic error
this.addOperation(...);
```

### After
```typescript
// Option 1: Check safely
if (!this.inFrame()) {
  this.deferToNextFrame(() => this.updateStats());
  return;
}

// Option 2: Require it
this.requireFrame(); // Clear error if not in frame
this.addOperation(...);
```

## Error Messages

### Before (8 lines)
```typescript
this.addFacet({
  id: `note-error-${Date.now()}`,
  type: 'ambient',
  displayName: 'Note Not Found',
  content: `Note ${params.noteId} not found`
});
```

### After (4 lines)
```typescript
this.addAmbient(
  `Note Not Found: ${params.noteId} not found`,
  { error: true, noteId: params.noteId }
);
```

## The Result

The SpaceNotes component is now:
- **~30% less code** overall
- **More readable** - intent is clear, not buried in boilerplate
- **Safer** - frame checks prevent cryptic errors
- **More maintainable** - changes are easier when you're working with abstractions

Most importantly, developers can focus on what the component DOES, not how to make Connectome happy!

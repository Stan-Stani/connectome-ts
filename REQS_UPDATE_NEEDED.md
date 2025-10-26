# Updates Needed for connectome-ts-reqs.md

Based on the V2 architecture implementation, the following sections need updating:

## 1. Three-Phase → Four-Phase Processing Architecture

**Current (line 124-144):**
```
Three-Phase Processing Architecture:
```

**Should be:**
```
Four-Phase Processing Architecture (RETM):
```

Add new Phase 4:
```
Phase 4 - Maintenance → Events (Maintainers):
- Perform system maintenance operations
- Examples: Element tree management, persistence, transition tracking
- Can emit new events for the next frame
- Cannot modify VEIL directly
```

## 2. Frame Events

**Remove references to frame:end:**
- Line 9: "frame start/frame end events" → just "frame start events"
- Line 177: Remove "frame lifecycle (start/end)" from first-class events
- Line 13: Update compression engine timing (no longer "after the end of frame")

## 3. Agent Management Operations

**Current (line 104-105):**
```
- Agent registration via addAgent/removeAgent/updateAgent operations
```

**Should be:**
```
- Agent registration via meta-facets (agent-add, agent-remove, agent-update)
```

## 4. Implementation Status (line 300-356)

**Update "Completed" section:**
- Change "Three-phase processing" → "Four-phase processing (RETM)"
- Add: "Maintainers for system-level operations"
- Add: "Element tree persistence via VEIL"
- Add: "ComponentRegistry for declarative element management"
- Add: "AXON RETM support"
- Add: "Removal of frame:end events"
- Add: "Phase 2 looping with iteration limit"

**Update "Recently Removed" section:**
- Add: "frame:end events (functionality moved to Maintainers)"
- Add: "Legacy Component support"
- Add: "Direct element tree manipulation (now declarative via VEIL)"

## 5. RETM Acronym Introduction

Add explanation near the processing architecture:
```
The RETM (Receptor/Effector/Transform/Maintainer) architecture provides...
```

## 6. Frame Structure

**Current (line 21):**
```
Frames carry both their deltas and the SpaceEvents that triggered them
```

This is correct! But add:
```
The `events` field in frames is crucial for turn attribution - it contains the SpaceEvents that triggered the frame, allowing the HUD to determine message roles (user/assistant/system).
```

## 7. Element Tree Management

Add new section:
```
Element Tree Persistence:
- Element tree structure is persisted in VEIL via ElementTreeFacet
- Components are registered in ComponentRegistry
- Element creation/deletion is declarative via events
- ElementRequestReceptor processes element:create/delete events
- ElementTreeMaintainer handles actual instantiation
```

## 8. AXON Protocol Enhancement

**Add to AXON section (after line 165):**
```
7. **RETM Support**: AXON modules can export Receptors, Effectors, Transforms, and Maintainers directly
8. **V2 Environment**: Extended environment provides all RETM interfaces and helpers
```

## 9. Ephemeral Facet Cleanup

**Add clarification:**
```
Ephemeral facets are automatically cleaned up after all four phases complete, not actively removed during processing.
```

## 10. VEILOperation → VEILDelta

Throughout the document, ensure consistent use of "VEILDelta" instead of "VEILOperation" or "operation" when referring to VEIL changes.

## Summary

The core architecture described in the requirements is still valid, but it needs updates to reflect:
1. The four-phase RETM pattern
2. Removal of frame:end events
3. Declarative element tree management
4. Enhanced AXON capabilities
5. Maintainers as a distinct phase


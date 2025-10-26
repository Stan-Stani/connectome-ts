# Architecture Cleanup Audit
Generated: September 29, 2025

## 🎯 Purpose
Identify outdated code, legacy patterns, and non-RETM compatible components after Phase 2 fix and Discord RETM migration.

---

## 1. Legacy Folders

### /legacy/ (Root Level)
- `legacy/discord-axon.ts` - Old Discord implementation
- `legacy/discord-chat.ts` - Old chat component
- **Action**: Can be deleted - replaced by discord-axon with proper RETM architecture

---

## 2. Legacy Components (Non-RETM)

### Components That Still Use Direct VEIL Manipulation

**AgentComponent** (`src/agent/agent-component.ts`)
- Status: DEPRECATED (documented in reqs)
- Replacement: AgentEffector + ContextTransform
- Issue: Still subscr to `frame:end` (removed), uses VEILComponent pattern
- Used in: 20+ example files
- **Action**: Should be migrated to AgentEffector in all examples

**ConsoleChatComponent** (`src/elements/console-chat.ts`)
- Status: ✅ REPLACED by console-chat-retm.ts
- Old: Subscribes to `frame:start`, `frame:end`, manipulates VEIL directly
- New: ConsoleAfferent + ConsoleMessageReceptor + ConsoleSpeechEffector
- Used in: 16 example files (need to migrate)
- **Action**: ✅ DONE - New RETM version created and tested
- **Remaining**: Update 16 examples to use new version

**DiscordAutoJoinComponent** (`discord-axon/src/discord-app.ts`)
- Status: Marked DEPRECATED in code
- Replacement: DiscordAutoJoinEffector (already implemented)
- Still registered in ComponentRegistry
- **Action**: Remove from registry and code

---

## 3. Components Using VEILComponent/InteractiveComponent Pattern

These components legitimately need VEIL access for their functionality but should be reviewed:

### Legitimate Use Cases (Keep)
- `BoxDispenserComponent` - InteractiveComponent for game logic
- `DispenseButtonComponent` - VEILComponent for simple state
- `BoxStateComponent` - StateComponent wrapper
- `SharedNotesComponent` - InteractiveComponent for collaborative notes
- `SpaceNotesComponent` - InteractiveComponent for notes
- `ControlPanelComponent` - VEILComponent for UI state

### May Need Review
- `BoxInteractionComponent` - Uses `addFacet()` in onFirstFrame
- These are fine if they only manipulate VEIL during frame processing (onFirstFrame, handleEvent)

---

## 4. Examples Using Deprecated Patterns

### Using AgentComponent (Should Use AgentEffector)
1. `test-agent-integration.ts`
2. `test-multi-agent.ts`
3. `test-multi-agent-simple.ts`
4. `test-multi-agent-parallel.ts`
5. `test-multi-agent-clean.ts`
6. `test-clean-architecture.ts`
7. `test-console-chat.ts`
8. `test-interactive-box.ts`
9. `test-activation-helper.ts`
10. `test-agent-activation.ts`
11. `test-console-receptor.ts`
12. `test-axon.ts`
13. `test-event-flow.ts`
14. `test-persistence.ts`
15. `test-shared-notes.ts`
16. `test-state-init.ts`
17. `test-auto-registration.ts`
18. `test-improved-api.ts`
19. `test-api-improvements-v2.ts`
20. `dispenser-app.ts`
21. `generic-host-example.ts`
22. `component-centric-pattern.ts`
23. `test-agent-effector.ts` (ironically tests the OLD AgentComponent)

### Using frame:end (Removed)
1. `test-space-element.ts` - Checks for frame:end events
2. `test-multi-agent-parallel.ts` - Subscribes to frame:end
3. `test-agent-effector.ts` - Uses frame:end
4. `test-axon-compatibility.ts` - Tests frame:end compatibility

### Using ConsoleChatComponent (Should Use Afferent)
1. `test-console-chat.ts`
2. `test-interactive-box.ts`
3. `test-multi-agent.ts`
4. `test-multi-agent-simple.ts`
5. `test-auto-registration.ts`
6. `test-activation-helper.ts`
7. `test-agent-activation.ts`
8. `test-api-improvements-v2.ts`
9. `test-shared-notes.ts`
10. `test-multi-agent-clean.ts`
11. `test-clean-architecture.ts`
12. `dispenser-app.ts`
13. `generic-host-example.ts`
14. `test-axon.ts`
15. `test-improved-api.ts`

---

## 5. Migration Adapters (Temporary)

**File**: `src/spaces/migration-adapters.ts`
- **Purpose**: Help migrate existing components to RETM
- **Status**: Marked "TEMPORARY - Remove once migration is complete"
- **Contains**:
  - `ComponentToReceptorAdapter`
  - `ComponentToEffectorAdapter`
  - `VEILOperationReceptor` (for backward compatibility)
- **Used By**: Space.ts (VEILOperationReceptor is built-in)
- **Action**: Review if still needed; VEILOperationReceptor might be permanent for flexibility

---

## 6. Deprecated Code Markers

### In Source Code
1. **veil-state.ts**: `getCurrentState()` - @deprecated, use `getState()`
2. **component.ts**: `updateState()` - @deprecated, use `changeState()`
3. **basic-agent.ts**: `hasPendingActivations()` - @deprecated
4. **veil/types.ts**: LegacyFacetFields, LegacyFrame interfaces
5. **agent/types.ts**: Tool.handler - deprecated for backward compat

### In Discord Code
6. **discord-app.ts**: `DiscordAutoJoinComponent` - marked DEPRECATED

---

## 7. Test Files for Old Architecture

### Compatibility Tests (Documenting old behavior)
- `test-axon-compatibility.ts` - Tests components work without frame:end
- **Action**: Keep for documentation, mark as historical reference

### Migration Tests
- `test-migration-with-debug.ts` - Tests migration adapters
- `test-full-migration.ts` - Tests full migration
- **Action**: Review if still relevant after full RETM adoption

---

## 8. Documentation Files (Historical)

### Architecture Evolution Docs
- `DISCORD_V2_ASSESSMENT.md`
- `DISCORD_V2_COMPLETE.md`
- `AXON_COMPATIBILITY_ASSESSMENT.md`
- `AXON_FRAME_END_FIX.md`
- `AXON_RETM_DESIGN.md`
- `AXON_RETM_SUMMARY.md`
- `V2_VALIDATION_SUMMARY.md`
- `QA_REPORT*.md` (multiple)
- `REFACTORING_COMPLETE.md`
- `CODEX_*.md` (multiple)
- `REQS_UPDATE_*.md`

**Action**: Move to `docs/archive/` or `docs/history/` folder

---

## 9. Old Discord Implementations

### In Root
- `discord-axon/` folder uses new DiscordAfferent ✅
- `legacy/discord-axon.ts`, `legacy/discord-chat.ts` - old implementations

### Still in Use (But Deprecated)
- `discord-axon/src/modules/discord-axon-refactored.ts` - Component version
- `discord-axon/src/modules/discord-chat-refactored.ts` - Component version
- Replaced by: `discord-afferent.ts` (Afferent version)

**Action**: Keep old modules for backward compatibility but document as deprecated

---

## 10. Recommended Actions

### High Priority (Breaking Old Patterns)
1. ⚠️ **Convert AgentComponent → AgentEffector** in all examples (20+ files)
2. ✅ **Convert ConsoleChatComponent → Console Afferent** + Receptors - DONE!
   - Created: `src/elements/console-chat-retm.ts`
   - Exports: ConsoleAfferent, ConsoleMessageReceptor, ConsoleSpeechEffector
   - Tested: Architecture verified
   - Remaining: Update 16 examples to use new version
3. ⚠️ **Remove frame:end** usage from examples (will happen with #1)
4. ⚠️ **Delete** `DiscordAutoJoinComponent` from discord-app.ts
5. ⚠️ **Remove deprecated methods**: `getCurrentState()`, `updateState()`, `hasPendingActivations()`

### Medium Priority (Cleanup)
6. Move architecture evolution docs to `docs/history/`
7. Delete `/legacy/` folder (replaced by Discord Afferent)
8. Review migration-adapters.ts - decide if temporary or permanent
9. Update all examples to use pure RETM patterns

### Low Priority (Documentation)
10. Add comments to LegacyFacetFields explaining why they exist
11. Mark test-axon-compatibility.ts as "historical reference"
12. Create migration guide for AgentComponent → AgentEffector

---

## 11. Files That Are Actually Fine

### Core RETM Infrastructure ✅
- All Receptor/Effector/Transform/Maintainer base classes
- Space, Element, VEILStateManager with Phase 2 fix
- FrameTrackingHUD, ContextTransform
- Agent Effector, BasicAgent
- Afferent infrastructure

### RETM Examples ✅  
- `test-martem-complete.ts` - Full RETM test
- `test-discord-v2.ts` - Pure RETM Discord (though needs updating to Afferent)
- `test-context-transform-*.ts` - Transform tests
- `test-infinite-transform.ts` - Phase 2 test

### Helper Components ✅
- Box/Dispenser/Notes components (legitimate VEILComponent use)
- These provide interactive elements, not external input

---

## Summary Statistics

**Components to Migrate**: 2 major (AgentComponent, ConsoleChatComponent)
**Examples to Update**: ~25 files
**Legacy Code to Delete**: ~4 files in /legacy/
**Docs to Archive**: ~15 markdown files
**Deprecated Methods to Remove**: 3-4 methods

**Current Architecture Purity**: ~70%
**Target Architecture Purity**: 95% (some VEILComponents are legitimate)

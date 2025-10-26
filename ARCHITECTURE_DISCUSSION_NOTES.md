# Architecture Discussion Notes

## Key Points from Team Discussion

### Phase Definitions (Current Implementation)

1. **Phase 0 (Proposed)**: Event preprocessing
   - Buffering, batching, aggregating, filtering events
   - Not yet implemented but under consideration

2. **Phase 1**: Receptors
   - Convert events → VEIL deltas (facets)
   - Stateless, unordered
   - Can emit VEIL

3. **Phase 2**: Transforms  
   - VEIL deltas → VEIL deltas
   - Stateless, potentially ordered (mechanism TBD)
   - Includes compression (replacing facets)
   - Can emit VEIL

4. **Phase 3**: Effectors
   - React to VEIL changes → Events + Real world actions
   - Cannot emit VEIL
   - Manage "yet unnamed components" (async external listeners)

5. **Phase 4**: Maintainers
   - Background operations
   - Cannot emit VEIL
   - Can queue events (for next frame)

### Key Architectural Clarifications

#### VEIL Emission Rules
- **Only Phase 1 & 2** can emit VEIL deltas
- Phase 3 & 4 cannot modify VEIL directly
- Events can be queued from any phase

#### The "Yet Unnamed Components"
- Managed by Effectors
- Convert truly external events → Space events
- Run asynchronously (not synchronized with main loop)
- Examples: Discord bot, game engine listeners

#### Anton's Game Example Flow
```
1. game_effector: enemy unit detected (event)
2. receptor: unit-detected-event → enemy-unit facet
3. transformer: enemy-unit facet → enemy-unit-count++, statistics
4. llm_effector: "I dislike enemy units" → action event
5. receptor: action-event → command_log facet
6. game_effector: destroy-enemy-unit facet → [game engine orders]
7. game_effector: event: "opponent said gg"
```

### Current Implementation Status

✅ **Implemented in refactor branch**:
- Four-phase processing loop with iteration limit
- Receptors, Transforms, Effectors, Maintainers
- Ephemeral facet cleanup after all phases
- AXON support for RETM exports
- PersistenceMaintainer, TransitionMaintainer

⚠️ **Differences/Clarifications Needed**:
1. **RETM vs RTEM naming**: Execution order is R→T→E→M but name is RETM
2. **Transform ordering**: Currently unordered, mechanism TBD
3. **Effector boundaries**: Discussion suggests Effectors manage external listeners
4. **"Inflictors"**: Andrii's term for the async components managed by Effectors

### Architecture Insights

The RETM architecture creates clear boundaries:
- **Phases 1-2**: "What happens in VEIL" (state mutations)
- **Phases 3-4**: "What happens at lower level" (reactions, maintenance)

This separation ensures:
- Clean state management
- Predictable execution order
- No VEIL mutations during reaction phases
- Async external events properly channeled

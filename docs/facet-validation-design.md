# Facet Validation Design

## Overview
Runtime validation to ensure facets conform to their expected structure and contain required fields.

## Design Principles

1. **Fail Fast**: Catch invalid facets at creation time, not when they cause issues later
2. **Clear Errors**: Provide helpful error messages that explain what's wrong and how to fix it
3. **Performance Aware**: Validation should be efficient and optionally disabled in production
4. **Progressive Enhancement**: Start with basic validation, add more sophisticated checks over time

## Validation Levels

### Level 1: Structure Validation (Required)
- Facet has `id` and `type` fields
- `id` is a non-empty string
- `type` matches a known facet type

### Level 2: Aspect Validation (Required)
Based on facet type, validate required aspects:

```typescript
// Example: SpeechFacet must have:
- content (ContentAspect)
- agentId (AgentGeneratedAspect) 
- streamId (StreamAspect)

// Example: EventFacet must have:
- content (ContentAspect)
- state.source (for turn attribution)
```

### Level 3: Consistency Validation (Warning)
- If `agentId` is present, `agentName` should be too
- If `streamId` is present, `streamType` should be too
- Ephemeral facets shouldn't have persistent state

### Level 4: Reference Validation (Optional)
- Verify `agentId` refers to existing agent
- Verify `streamId` refers to existing stream
- Verify `scopeId` refers to existing scope

## Where to Validate

### 1. Factory Functions (Primary)
```typescript
export function createSpeechFacet(params: SpeechFacetParams): SpeechFacet {
  const facet = { /* ... */ };
  
  // Validate before returning
  validateFacet(facet, 'speech');
  
  return facet;
}
```

### 2. Receptor Transform (Secondary)
```typescript
transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
  const facets = [/* ... */];
  
  // Validate all facets before returning
  if (VALIDATION_ENABLED) {
    facets.forEach(f => validateFacet(f));
  }
  
  return facets;
}
```

### 3. VEILStateManager (Safety Net)
```typescript
applyDelta(delta: VEILDelta): FacetDelta | null {
  if (delta.type === 'addFacet') {
    // Last chance validation
    const validation = validateFacet(delta.facet, undefined, { throw: false });
    if (!validation.valid) {
      console.error(`Invalid facet rejected: ${validation.error}`);
      return null;
    }
  }
  // ... rest of implementation
}
```

## Implementation

### Core Validation Function
```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

function validateFacet(
  facet: any, 
  expectedType?: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { 
    level = ValidationLevel.Aspect,
    throw: shouldThrow = true,
    context = ''
  } = options;
  
  // Level 1: Structure
  if (!facet.id || !facet.type) {
    return error('Facet missing required id or type', shouldThrow);
  }
  
  // Level 2: Aspects
  const validator = FACET_VALIDATORS[facet.type];
  if (validator) {
    return validator(facet, options);
  }
  
  return { valid: true };
}
```

### Type-Specific Validators
```typescript
const FACET_VALIDATORS: Record<string, FacetValidator> = {
  'speech': validateSpeechFacet,
  'thought': validateThoughtFacet,
  'action': validateActionFacet,
  'event': validateEventFacet,
  'state': validateStateFacet,
  // ... etc
};

function validateSpeechFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required aspects
  if (!hasContentAspect(facet) || !facet.content) {
    errors.push('Speech facet must have content');
  }
  
  if (!hasAgentGeneratedAspect(facet) || !facet.agentId) {
    errors.push('Speech facet must have agentId');
  }
  
  if (!hasStreamAspect(facet) || !facet.streamId) {
    errors.push('Speech facet must have streamId');
  }
  
  // Consistency checks
  if (facet.agentId && !facet.agentName) {
    warnings.push('Speech facet has agentId but no agentName');
  }
  
  return {
    valid: errors.length === 0,
    error: errors.join('; '),
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
```

### Configuration
```typescript
// Environment variable or config
const VALIDATION_ENABLED = process.env.NODE_ENV !== 'production' || 
                          process.env.ENABLE_FACET_VALIDATION === 'true';

const VALIDATION_LEVEL = process.env.FACET_VALIDATION_LEVEL || 
                        ValidationLevel.Aspect;

// Can be set globally or per-space
interface ValidationConfig {
  enabled: boolean;
  level: ValidationLevel;
  throwOnError: boolean;
  logWarnings: boolean;
}
```

## Error Messages

Good error messages are crucial:

```typescript
// Bad:
"Invalid facet"

// Good:
"Speech facet missing required 'agentId' field. Speech facets must include agentId to identify the speaking agent."

// Better:
"Speech facet 'speech-123' missing required 'agentId' field. 
Speech facets must include agentId to identify the speaking agent.
Example: { id: 'speech-123', type: 'speech', content: '...', agentId: 'agent-1', ... }"
```

## Migration Strategy

1. **Phase 1**: Add validation functions but only log warnings
2. **Phase 2**: Enable throwing in factory functions
3. **Phase 3**: Enable validation in receptors
4. **Phase 4**: Enable validation in VEILStateManager

## Performance Considerations

- Use type guards that TypeScript can optimize
- Cache validation results for immutable facets
- Consider sampling validation in production (e.g., validate 1% of facets)
- Make validation async-friendly for future enhancements

## Future Enhancements

1. **Schema Validation**: Use JSON Schema or similar for declarative validation
2. **Custom Validators**: Allow components to register custom validators
3. **Validation Reports**: Generate reports of validation issues over time
4. **Auto-correction**: Attempt to fix common issues (e.g., add missing streamId from context)

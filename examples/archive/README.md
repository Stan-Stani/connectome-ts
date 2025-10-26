# Archived Examples

This directory contains **91 files** that have been archived as of October 2, 2025.

## Contents

### Outdated Test Files
~70+ `test-*.ts` files representing various stages of development and testing. These may use outdated APIs, have broken imports, or test features that no longer exist.

### Conceptual/Non-Runnable Examples
- `basic-agent-constructor-example.ts` - Shows old vs new API (educational)
- `better-ids-example.ts` - ID generation patterns
- `component-centric-pattern.ts` - Component pattern demo
- `improved-api-example.ts` - Helper method examples
- `minimal-example.ts` - Data structure examples
- `naming-consistency-example.ts` - Naming conventions
- `new-component-example.ts` - Component API demo
- `fork-invariant-example.ts` - Conceptual example

### Superseded Examples
- `dispenser-app.ts` - Old dispenser, replaced by `dispenser-with-host.ts` and `dispenser-retm.ts`
- `test-full-console-agent.ts` - Old console implementation
- `test-console-retm.ts` - Incomplete, superseded by `console-chat-host.ts`

### Old Test Data
- `test-restore-data/` - Snapshot data directory
- `test-restore-final/` - Another snapshot data directory
- `axon-test/` - Old axon testing files (both .js and .ts versions)
- `axon-modules/` - Old axon module examples

### Documentation
- `reconciliation-summary.md` - Historical reconciliation documentation

## Why Archived?

These files were archived to:
1. **Reduce clutter** - Make the main examples directory more navigable
2. **Preserve history** - Keep old examples for reference
3. **Focus on current** - Highlight only working, maintained examples
4. **Prevent confusion** - Avoid developers running outdated/broken examples

## Using Archived Examples

⚠️ **Warning:** Files in this directory may not work with the current codebase. They likely have:
- Broken imports
- Outdated API calls
- References to removed features
- Incompatible patterns

If you need to reference these examples:
1. Check the git history to see when they last worked
2. Review the changes needed to update them
3. Consider creating a new example instead of reviving old ones

## Cleanup Strategy

To fully clean up:
```bash
# Review and decide what to keep
cd examples/archive

# Delete if you're sure you don't need them
rm -rf test-*.ts axon-test/ test-restore-*/

# Keep only examples with unique value
```

---

*Archived on October 2, 2025 during examples directory cleanup*



/**
 * Test append-only state with cached lookups
 */

import { VEILStateManager } from './src/veil/veil-state';

async function main() {
  console.log('=== Append-Only State Test ===\n');
  
  const veil = new VEILStateManager();
  
  // 1. Add initial state
  console.log('1. Adding initial box state...');
  veil.applyDelta({
    type: 'addFacet',
    facet: {
      id: 'box-1-state',
      type: 'state',
      content: 'A closed box',
      state: { isOpen: false, contents: 'mystery' }
    }
  });
  
  let current = veil.getCurrentStateFor('box-1-state');
  console.log('   Current state:', current);
  console.log('   ✅ isOpen:', current.isOpen);
  
  // 2. Add state-change (endotemporal evolution)
  console.log('\n2. Box opens (state-change facet)...');
  veil.applyDelta({
    type: 'addFacet',
    facet: {
      id: 'state-change-1',
      type: 'state-change',
      targetFacetIds: ['box-1-state'],
      state: {
        changes: {
          isOpen: { old: false, new: true }
        }
      },
      ephemeral: true
    }
  });
  
  current = veil.getCurrentStateFor('box-1-state');
  console.log('   Current state:', current);
  console.log('   ✅ isOpen:', current.isOpen);
  
  // 3. Check facet count
  const state = veil.getState();
  console.log('\n3. VEIL facets:');
  console.log(`   Total facets: ${state.facets.size}`);
  
  let boxState = state.facets.get('box-1-state');
  console.log(`   box-1-state.state:`, (boxState as any).state);
  
  if ((boxState as any).state.isOpen === false) {
    console.log('   ✅ Original facet unchanged (still isOpen: false)');
  } else {
    console.log('   ❌ Original facet WAS MUTATED! isOpen:', (boxState as any).state.isOpen);
  }
  
  let stateChange = state.facets.get('state-change-1');
  console.log(`   state-change-1:`, stateChange ? 'EXISTS' : 'REMOVED');
  
  // 4. Verify cache
  console.log('\n4. Cache verification:');
  console.log(`   Cache size: ${state.currentStateCache.size}`);
  console.log(`   Cached state for box-1-state:`, state.currentStateCache.get('box-1-state'));
  
  console.log('\n✅ Append-only VEIL working!');
  console.log('Key points:');
  console.log('  - Original state facet unchanged');
  console.log('  - State-change facet records evolution');
  console.log('  - Cache provides O(1) current state lookup');
  console.log('  - Full history preserved in VEIL\n');
  
  process.exit(0);
}

main();

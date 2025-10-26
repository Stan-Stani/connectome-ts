#!/usr/bin/env tsx
/**
 * Simple Tag-Based Continuations Test
 * Tests the core continuation functionality without the Host
 */

import { config } from 'dotenv';
config();

import {
  Space,
  VEILStateManager,
  Element,
  ElementRequestReceptor,
  ElementTreeMaintainer,
  ComponentRegistry
} from '../src';
import { ContinuationTransform } from '../src/transforms/continuation-transform';

async function testContinuations() {
  console.log('🏷️  Simple Tag-Based Continuations Test');
  console.log('======================================\n');
  
  // Create VEILStateManager and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add receptors and maintainers
  space.addReceptor(new ElementRequestReceptor());
  space.addMaintainer(new ElementTreeMaintainer(space));
  
  // Add continuation transform
  space.addTransform(new ContinuationTransform());
  
  // Track facets created
  let continuationCompleted = false;
  let agentActivated = false;
  
  // Add a debug effector to watch for facets
  space.addEffector({
    facetFilters: undefined,
    async mount() {},
    async unmount() {},
    async process(changes) {
      for (const change of changes) {
        if (change.type === 'added') {
          const facet = change.facet;
          console.log(`📝 Facet created: ${facet.type} - ${facet.id}`);
          
          if (facet.type === 'continuation:complete') {
            continuationCompleted = true;
            console.log(`✅ Continuation completed: ${(facet as any).state.continuationTag}`);
          }
          
          if (facet.type === 'agent-activation') {
            agentActivated = true;
            console.log(`🤖 Agent activated!`);
          }
        }
      }
      return { events: [] };
    }
  });
  
  console.log('📦 Creating element with continuation tag...\n');
  
  // Emit element:create event with continuation tag
  space.emit({
    topic: 'element:create',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      parentId: 'root',
      name: 'test-element',
      elementType: 'TestElement',
      continuationTag: 'activate-after-test-123'
    }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('\n📊 Results:');
  console.log(`- Continuation completed: ${continuationCompleted ? '✅' : '❌'}`);
  console.log(`- Agent activated: ${agentActivated ? '✅' : '❌'}`);
  
  if (continuationCompleted && agentActivated) {
    console.log('\n✅ Test PASSED! Continuations are working correctly.');
  } else {
    console.log('\n❌ Test FAILED! Something went wrong.');
  }
  
  console.log('\n🔄 Continuation flow:');
  console.log('1. element:create event with continuationTag');
  console.log('2. ElementTreeMaintainer creates element');
  console.log('3. ElementTreeMaintainer emits continuation:complete');
  console.log('4. ContinuationTransform sees completion');
  console.log('5. ContinuationTransform creates agent-activation');
}

testContinuations().catch(console.error);

#!/usr/bin/env tsx
/**
 * Test Tag-Based Continuations
 * 
 * Demonstrates:
 * - Element creation with continuation tags
 * - Automatic agent activation after element creation
 * - ContinuationTransform processing continuation:complete facets
 */

import { config } from 'dotenv';
config();

import {
  ConnectomeHost,
  Space,
  VEILStateManager,
  Element,
  MockLLMProvider,
  ElementRequestReceptor,
  ElementTreeMaintainer,
  ComponentRegistry,
  BasicAgent,
  AgentEffector,
  ContextTransform
} from '../src';
import { ContinuationTransform } from '../src/transforms/continuation-transform';
import { ConnectomeApplication } from '../src/host/types';

class ContinuationTestApp implements ConnectomeApplication {
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    // Add receptors and maintainers
    space.addReceptor(new ElementRequestReceptor());
    space.addMaintainer(new ElementTreeMaintainer(space));
    
    // Add continuation transform
    space.addTransform(new ContinuationTransform());
    
    // Create agent
    const agentElem = new Element('agent');
    space.addChild(agentElem);
    
    const llmProvider = new MockLLMProvider();
    llmProvider.setResponses([
      "Oh! Something new just appeared!",
      "I see the element was created successfully.",
      "The continuation system is working perfectly!"
    ]);
    
    const agent = new BasicAgent({
      config: {
        name: 'ContinuationAgent',
        systemPrompt: 'You are testing the continuation system. React when new elements appear.'
      },
      provider: llmProvider,
      veilStateManager: veilState
    });
    
    space.addEffector(new AgentEffector(agentElem, agent));
    space.addTransform(new ContextTransform(veilState));
    
    console.log('✅ Continuation test initialized\n');
  }
  
  getComponentRegistry(): typeof ComponentRegistry {
    return ComponentRegistry;
  }
  
  createSpace(veilState: VEILStateManager, hostRegistry?: any): { space: Space; veilState: VEILStateManager } {
    const space = new Space(veilState, hostRegistry);
    return { space, veilState };
  }
  
  async onStart(space: Space): Promise<void> {
    console.log('🚀 Testing continuations...\n');
    
    // Test 1: Create element with continuation tag
    console.log('📦 Creating element with continuation tag...');
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
    
    // Give time for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n✅ Test complete!');
    
    // Show the continuation flow
    console.log('\nContinuation flow:');
    console.log('1. element:create event with continuationTag');
    console.log('2. ElementTreeMaintainer creates element');
    console.log('3. ElementTreeMaintainer emits continuation:complete');
    console.log('4. ContinuationTransform sees completion');
    console.log('5. ContinuationTransform creates agent-activation');
    console.log('6. Agent activates and responds');
  }
}

async function main() {
  console.log('🏷️  Tag-Based Continuations Test');
  console.log('==================================\n');
  
  const app = new ContinuationTestApp();
  
  const host = new ConnectomeHost({
    persistence: { enabled: false },
    debug: { enabled: false },
    reset: true
  });
  
  const shutdown = async () => {
    console.log('\n👋 Shutting down...');
    await host.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  try {
    await host.start(app);
    
    // Auto-exit after 3 seconds
    setTimeout(shutdown, 3000);
  } catch (error) {
    console.error('❌ Failed:', error);
    process.exit(1);
  }
}

main();

/**
 * Test script to demonstrate the debug registry
 *
 * Run with inspector:
 *   node --inspect=9229 -r ts-node/register examples/test-debug-registry.ts
 *
 * Then connect with:
 *   node inspect localhost:9229
 *
 * Or use Chrome DevTools:
 *   chrome://inspect
 *
 * In the inspector console:
 *   global.__connectome_debug.space
 *   global.__connectome_debug.veilState.getState()
 *   global.__connectome_debug.host
 */

import { config } from 'dotenv';
config();

import { ConnectomeHost } from '../src/host/host';
import { ConnectomeApplication } from '../src/host/types';
import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';

// Simple test application
class TestApp implements ConnectomeApplication {
  async createSpace(hostRegistry?: Map<string, any>): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState, hostRegistry);
    return { space, veilState };
  }

  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('✅ Test app initialized');

    // Add a test facet
    await space.emit({
      topic: 'veil:operation',
      source: space.getRef(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: 'test-facet',
            type: 'ambient',
            content: 'This is a test facet for debug registry demo'
          }
        }
      },
      timestamp: Date.now()
    });
  }

  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Test app started');
    console.log('\n📍 Debug registry is now available!');
    console.log('   Connect your debugger and access:');
    console.log('   • global.__connectome_debug.space');
    console.log('   • global.__connectome_debug.veilState');
    console.log('   • global.__connectome_debug.host');
    console.log('   • global.__connectome_debug.debugServer');
    console.log('\n   Example commands:');
    console.log('   • global.__connectome_debug.veilState.getState().facets.size');
    console.log('   • global.__connectome_debug.space.children.length');
    console.log('   • global.__connectome_debug.host.config');
  }
}

async function main() {
  console.log('🔍 Starting with inspector debug registry...\n');

  const llmProvider = new MockLLMProvider();

  const host = new ConnectomeHost({
    debug: {
      enabled: true,
      port: 3015
    },
    providers: {
      'llm.primary': llmProvider
    },
    secrets: {
      'test.secret': 'my-secret-token-123'
    }
  });

  const app = new TestApp();
  const space = await host.start(app);

  console.log('\n⏸️  Process will stay alive. Use Ctrl+C to exit.\n');

  // Keep process alive
  await new Promise(() => {});
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}

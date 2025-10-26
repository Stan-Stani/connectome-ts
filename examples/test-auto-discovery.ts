#!/usr/bin/env tsx
/**
 * Test auto-discovery eliminating dual registration
 * Shows the dramatically simplified developer experience
 */

import { config } from 'dotenv';
config();

import {
  VEILStateManager,
  Element,
  BaseReceptor,
  BaseEffector,
  BaseTransform,
  BaseMaintainer,
  createEventFacet
} from '../src';
import { SpaceWithAutoDiscovery } from '../src/spaces/space-with-discovery';
import { 
  SpaceEvent, 
  ReadonlyVEILState, 
  FacetDelta, 
  EffectorResult,
  MaintainerResult,
  Frame
} from '../src/spaces/receptor-effector-types';
import { VEILDelta } from '../src/veil/types';

/**
 * Example button component that is BOTH element component AND receptor
 */
class ButtonReceptor extends BaseReceptor {
  topics = ['ui:click'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    console.log('🔘 Button clicked!');
    return [{
      type: 'addFacet',
      facet: createEventFacet({
        id: `button-press-${Date.now()}`,
        content: 'Button was pressed',
        source: 'button',
        eventType: 'button-press'
      })
    }];
  }
}

/**
 * Display component that shows messages
 */
class DisplayEffector extends BaseEffector {
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type === 'added' && change.facet.type === 'event') {
        const event = change.facet as any;
        if (event.state?.eventType === 'button-press') {
          console.log('📺 Display showing: Button pressed!');
        }
      }
    }
    return { events: [] };
  }
}

/**
 * Counter that tracks button presses
 */
class CounterTransform extends BaseTransform {
  private count = 0;
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Count button presses
    for (const [id, facet] of state.facets) {
      if (facet.type === 'event' && (facet as any).state?.eventType === 'button-press') {
        this.count++;
        deltas.push({
          type: 'addFacet',
          facet: {
            id: `counter-${Date.now()}`,
            type: 'state',
            content: `Button pressed ${this.count} times`,
            state: { count: this.count }
          }
        });
      }
    }
    
    return deltas;
  }
}

/**
 * Logger that records all events
 */
class EventLoggerMaintainer extends BaseMaintainer {
  async process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<MaintainerResult> {
    const eventCount = changes.filter(c => 
      c.type === 'added' && c.facet.type === 'event'
    ).length;
    
    if (eventCount > 0) {
      console.log(`📝 Logger: ${eventCount} events in frame ${frame.sequence}`);
    }
    
    return { events: [] };
  }
}

async function testAutoDiscovery() {
  console.log('🚀 Auto-Discovery Test');
  console.log('=====================\n');
  
  const veilState = new VEILStateManager();
  const space = new SpaceWithAutoDiscovery(veilState);
  
  // Create UI structure
  const ui = new Element('ui-root');
  space.addChild(ui);
  
  const button = new Element('button');
  ui.addChild(button);
  
  const display = new Element('display');
  ui.addChild(display);
  
  const system = new Element('system');
  space.addChild(system);
  
  console.log('✨ Adding components WITHOUT dual registration:\n');
  
  // Just add components - NO space.addReceptor() etc needed!
  button.addComponent(new ButtonReceptor());
  console.log('  ✓ button.addComponent(new ButtonReceptor())');
  
  display.addComponent(new DisplayEffector());
  console.log('  ✓ display.addComponent(new DisplayEffector())');
  
  system.addComponent(new CounterTransform());
  console.log('  ✓ system.addComponent(new CounterTransform())');
  
  system.addComponent(new EventLoggerMaintainer());
  console.log('  ✓ system.addComponent(new EventLoggerMaintainer())');
  
  console.log('\n🔍 Space will auto-discover these components!\n');
  
  // Simulate button clicks
  console.log('--- Click 1 ---');
  space.emit({
    topic: 'ui:click',
    source: button.getRef(),
    timestamp: Date.now(),
    payload: { x: 100, y: 50 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n--- Click 2 ---');
  space.emit({
    topic: 'ui:click',
    source: button.getRef(),
    timestamp: Date.now(),
    payload: { x: 100, y: 50 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Add component dynamically
  console.log('\n🎯 Adding component dynamically...');
  const newButton = new Element('second-button');
  ui.addChild(newButton);
  newButton.addComponent(new ButtonReceptor());
  console.log('  ✓ Dynamically added second button');
  
  console.log('\n--- Click 3 (from new button) ---');
  space.emit({
    topic: 'ui:click',
    source: newButton.getRef(),
    timestamp: Date.now(),
    payload: { x: 200, y: 100 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n✅ Benefits demonstrated:');
  console.log('  • No dual registration needed');
  console.log('  • Components just work when added to elements');
  console.log('  • Dynamic component addition supported');
  console.log('  • Single source of truth (element tree)');
  console.log('  • Zero boilerplate!');
}

testAutoDiscovery().catch(console.error);

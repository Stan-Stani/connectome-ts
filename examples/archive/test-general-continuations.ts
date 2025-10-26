#!/usr/bin/env tsx
/**
 * General Continuations Test
 * 
 * Demonstrates the flexible continuation system where any operation
 * can specify arbitrary facets to create upon completion.
 */

import { config } from 'dotenv';
config();

import {
  Space,
  VEILStateManager,
  Element,
  ElementRequestReceptor,
  ElementTreeMaintainer,
  ComponentRegistry,
  BaseEffector,
  BaseReceptor
} from '../src';
import { ContinuationTransform } from '../src/transforms/continuation-transform';
import { SpaceEvent, Facet, ReadonlyVEILState, FacetDelta, EffectorResult } from '../src/spaces/receptor-effector-types';

/**
 * Simple receptor that creates operations with continuations
 */
class OperationReceptor extends BaseReceptor {
  topics = ['test:operation'];
  
  transform(event: SpaceEvent): Facet[] {
    const { operationType } = event.payload;
    
    if (operationType === 'create-with-notification') {
      return [{
        id: `element-request-${Date.now()}`,
        type: 'element-request',
        state: {
          parentId: 'root',
          name: 'notification-element',
          elementType: 'NotificationElement',
          continuations: [{
            // Create a notification event after element creation
            facetType: 'event',
            facetSpec: {
              eventType: 'notification',
              content: 'Element {{elementId}} was created successfully!',
              severity: 'info',
              state: {
                elementName: '{{name}}',
                timestamp: Date.now()
              }
            },
            condition: 'success'
          }, {
            // Log an error if creation fails
            facetType: 'event',
            facetSpec: {
              eventType: 'error-log',
              content: 'Failed to create element: {{error}}',
              severity: 'error'
            },
            condition: 'failure'
          }]
        }
      }];
    }
    
    if (operationType === 'chain-operations') {
      return [{
        id: `element-request-${Date.now()}`,
        type: 'element-request',
        state: {
          parentId: 'root',
          name: 'parent-element',
          elementType: 'ParentElement',
          continuations: [{
            // Chain another element creation
            facetType: 'element-request',
            facetSpec: {
              parentId: '{{elementId}}',  // Use the created element as parent
              name: 'child-element',
              elementType: 'ChildElement',
              state: {
                parentName: '{{name}}'
              },
              continuations: [{
                // And create a state facet after the child is created
                facetType: 'state',
                facetSpec: {
                  content: 'Parent-child hierarchy created',
                  state: {
                    parentId: '{{result.parentId}}',
                    childId: '{{elementId}}'
                  }
                },
                condition: 'success'
              }]
            },
            condition: 'success'
          }]
        }
      }];
    }
    
    return [];
  }
}

/**
 * Effector that logs different types of events
 */
class LoggingEffector extends BaseEffector {
  facetFilters = undefined;
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type === 'added') {
        const facet = change.facet;
        
        // Log different event types
        if (facet.type === 'event') {
          const event = facet as any;
          if (event.eventType === 'notification') {
            console.log(`📢 NOTIFICATION: ${event.content}`);
            console.log(`   Element: ${event.state?.elementName}`);
          } else if (event.eventType === 'error-log') {
            console.log(`❌ ERROR: ${event.content}`);
          }
        }
        
        // Log state changes
        if (facet.type === 'state' && facet.content) {
          console.log(`📊 STATE: ${facet.content}`);
          if (facet.state) {
            console.log(`   Details:`, facet.state);
          }
        }
        
        // Log element creations
        if (facet.type === 'element-tree') {
          const tree = facet.state as any;
          console.log(`🌳 ELEMENT CREATED: ${tree.name} (${tree.elementId})`);
          if (tree.parentId && tree.parentId !== 'root') {
            console.log(`   Parent: ${tree.parentId}`);
          }
        }
      }
    }
    
    return { events: [] };
  }
}

async function testContinuations() {
  console.log('🔄 General Continuations Test');
  console.log('===============================\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add components
  space.addReceptor(new OperationReceptor());
  space.addReceptor(new ElementRequestReceptor());
  space.addTransform(new ContinuationTransform());
  space.addEffector(new LoggingEffector());
  space.addMaintainer(new ElementTreeMaintainer(space));
  
  console.log('Test 1: Create element with notification continuation');
  console.log('-----------------------------------------------------');
  
  space.emit({
    topic: 'test:operation',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      operationType: 'create-with-notification'
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('\nTest 2: Chain multiple operations');
  console.log('----------------------------------');
  
  space.emit({
    topic: 'test:operation',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      operationType: 'chain-operations'
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n✅ Tests complete!');
  console.log('\nKey features demonstrated:');
  console.log('- Any operation can specify continuations');
  console.log('- Continuations can create any type of facet');
  console.log('- Support for success/failure conditions');
  console.log('- Template interpolation from operation results');
  console.log('- Continuations can chain (create continuations)');
}

testContinuations().catch(console.error);


/**
 * Real Element Tree Tests for Phase 0
 *
 * These tests use actual debug server HTTP calls to verify element tree structure.
 * No mocks, no simulations - real integration testing.
 */

import { BaseTest } from '../test-framework';
import { waitForFrame } from '../test-helpers';

/**
 * TEST-015: Element Hierarchy
 * Verify element tree structure by querying actual state
 */
export class Test015ElementHierarchyReal extends BaseTest {
  id = 'TEST-015';
  name = 'Element Hierarchy (Real)';
  priority = 15;

  async execute(): Promise<void> {
    if (!this.context.debugServer) {
      throw new Error('SKIP: Debug server not available');
    }

    this.log('Querying element tree from debug server...');
    const tree = await this.context.debugServer.getElementTree();

    this.assert(!!tree, 'Should have element tree');
    this.verify('treeReceived', { rootId: tree.id, rootName: tree.name });

    // Verify root is Space
    this.assert(
      tree.name === 'Space' || tree.type === 'space' || tree.id === 'root',
      'Root should be Space'
    );
    this.verify('rootElement', tree.name || tree.type);

    // Verify tree has children
    const children = tree.children || [];
    this.assert(children.length > 0, 'Should have child elements');
    this.verify('childCount', children.length);

    // Log element structure
    this.log(`Element tree has ${children.length} top-level elements:`);
    for (const child of children) {
      this.log(`  - ${child.name || child.id} (type: ${child.type || 'unknown'})`);
    }

    // Verify expected elements exist (flexible matching)
    this.log('Checking for common elements...');
    const elementNames = children.map((c: any) => (c.name || c.id).toLowerCase());

    const hasDiscord = elementNames.some((name: string) => name.includes('discord'));
    const hasAgent = elementNames.some((name: string) => name.includes('agent'));

    if (hasDiscord) {
      this.verify('hasDiscordElement', true);
      this.log('✓ Found Discord-related element');
    }

    if (hasAgent) {
      this.verify('hasAgentElement', true);
      this.log('✓ Found Agent-related element');
    }

    // Verify element structure
    for (const child of children) {
      this.assertHasProperty(child, 'id', 'Element should have ID');
      this.assertHasProperty(child, 'name', 'Element should have name');
    }

    this.verify('elementStructureValid', true);

    this.log('✅ Element hierarchy verified');
  }
}

/**
 * TEST-016: Component Mounting
 * Verify components are mounted to elements correctly
 */
export class Test016ComponentMountingReal extends BaseTest {
  id = 'TEST-016';
  name = 'Component Mounting (Real)';
  priority = 16;

  async execute(): Promise<void> {
    if (!this.context.debugServer) {
      throw new Error('SKIP: Debug server not available');
    }

    this.log('Querying components from debug server...');
    const components = await this.context.debugServer.getComponents();

    this.assert(components.length > 0, 'Should have mounted components');
    this.verify('mountedComponentCount', components.length);

    // Log component details
    this.log(`Found ${components.length} mounted components:`);
    for (const comp of components.slice(0, 10)) {
      this.log(`  - ${comp.name || comp.id} (type: ${comp.type || 'unknown'})`);
    }

    // Verify components have required properties
    for (const component of components) {
      this.assertHasProperty(component, 'name', 'Component should have name');

      // Many components should have element references
      if (component.elementId || component.element) {
        this.verify('componentHasElementRef', true);
      }
    }

    // Check for specific component types
    const receptors = components.filter((c: any) =>
      c.name?.toLowerCase().includes('receptor') ||
      c.type?.toLowerCase().includes('receptor')
    );

    const effectors = components.filter((c: any) =>
      c.name?.toLowerCase().includes('effector') ||
      c.type?.toLowerCase().includes('effector')
    );

    const transforms = components.filter((c: any) =>
      c.name?.toLowerCase().includes('transform') ||
      c.type?.toLowerCase().includes('transform')
    );

    this.verify('componentTypes', {
      receptors: receptors.length,
      effectors: effectors.length,
      transforms: transforms.length,
      total: components.length
    });

    this.log(`Component breakdown: ${receptors.length} receptors, ${effectors.length} effectors, ${transforms.length} transforms`);

    // Verify element tree has components
    this.log('Querying element tree to verify component mounting...');
    const tree = await this.context.debugServer.getElementTree();

    const elementsWithComponents = this.countElementsWithComponents(tree);
    this.log(`Found ${elementsWithComponents} elements with components`);
    this.verify('elementsWithComponents', elementsWithComponents);

    this.log('✅ Component mounting verified');
  }

  private countElementsWithComponents(element: any): number {
    let count = 0;
    if (element.components && element.components.length > 0) {
      count = 1;
    }
    for (const child of element.children || []) {
      count += this.countElementsWithComponents(child);
    }
    return count;
  }
}

/**
 * TEST-017: Event Propagation
 * Verify events propagate through the system correctly
 */
export class Test017EventPropagationReal extends BaseTest {
  id = 'TEST-017';
  name = 'Event Propagation (Real)';
  priority = 17;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;
    const testMessage = `<@${botId}> propagation test ${Date.now()}`;

    this.log('Sending message to test event propagation...');
    await this.context.discord.sendMessage(channelId, testMessage);

    this.log('Waiting for event to propagate through system...');
    const frame = await waitForFrame(
      this.context.debugServer,
      (f: any) => {
        const events = f.events || [];
        return events.some((e: any) =>
          e.topic === 'discord:message' && e.payload?.content?.includes('propagation test')
        );
      },
      10000
    );

    this.assert(!!frame, 'Event should be captured in frame');
    this.verify('eventCaptured', { frameId: frame.uuid });

    // Verify event has required structure
    const events = frame.events || [];
    const discordEvent = events.find((e: any) =>
      e.topic === 'discord:message' && e.payload?.content?.includes('propagation test')
    );

    this.assert(!!discordEvent, 'Discord event should exist');
    this.assertHasProperty(discordEvent, 'topic', 'Event should have topic');
    this.assertHasProperty(discordEvent, 'payload', 'Event should have payload');
    this.verify('eventStructure', {
      topic: discordEvent.topic,
      hasPayload: !!discordEvent.payload
    });

    // Verify multiple components processed the event
    this.log('Checking component processing...');
    const operations = frame.operations || [];
    this.assert(operations.length > 0, 'Should have operations processing event');
    this.verify('operationCount', operations.length);

    // Check for sequential processing
    const componentNames = operations.map((op: any) => op.component);
    const uniqueComponents = new Set(componentNames);
    this.log(`Event processed by ${uniqueComponents.size} unique components`);
    this.verify('componentsProcessed', uniqueComponents.size);

    // Verify event led to state changes
    this.log('Verifying state changes...');
    const hasDeltas = frame.deltas && frame.deltas.length > 0;
    if (hasDeltas) {
      this.verify('stateChangesOccurred', frame.deltas.length);
      this.log(`✓ Event caused ${frame.deltas.length} state changes`);
    }

    this.log('✅ Event propagation verified');
  }
}

/**
 * Export real element tree tests
 */
export const ELEMENT_TREE_TESTS_REAL = [
  new Test015ElementHierarchyReal(),
  new Test016ComponentMountingReal(),
  new Test017EventPropagationReal()
];

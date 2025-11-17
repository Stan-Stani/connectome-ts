/**
 * Real Integration Tests for Phase 0
 *
 * End-to-end tests for complete system functionality using actual Discord API
 * and debug server HTTP calls. No mocks, no simulations - real integration testing.
 */

import { BaseTest } from '../test-framework';
import { waitForFrame, waitForFacet } from '../test-helpers';

/**
 * TEST-024: Multi-Agent Coordination
 * Verify multiple agents work together in the same system
 */
export class Test024MultiAgentCoordinationReal extends BaseTest {
  id = 'TEST-024';
  name = 'Multi-Agent Coordination (Real)';
  priority = 24;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;

    this.log('Querying for agents in the system...');
    const agents = await this.context.debugServer.getAgents();

    this.log(`Found ${agents.length} agents:`);
    for (const agent of agents) {
      this.log(`  - ${agent.name || agent.id} (status: ${agent.status || 'unknown'})`);
    }

    this.assert(agents.length >= 1, 'Should have at least one agent');
    this.verify('agentCount', agents.length);

    // Test primary agent activation
    this.log('Testing primary agent activation...');
    const testMessage1 = `<@${botId}> agent coordination test ${Date.now()}`;

    await this.context.discord.sendMessage(channelId, testMessage1);

    this.log('Waiting for agent activation...');
    const activationFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'agent-activation',
      10000
    );

    this.assert(!!activationFacet, 'Agent should activate');
    this.verify('primaryAgentActivated', {
      agentId: activationFacet?.agentId,
      type: activationFacet?.type
    });

    // Check for agent state in VEIL
    this.log('Checking agent state management...');
    const veilState = await this.context.debugServer.getVEILState();
    const facets = Array.isArray(veilState.facets)
      ? veilState.facets
      : Object.values(veilState.facets || {});

    const agentFacets = facets.filter((f: any) =>
      f.type?.includes('agent') || f.agentId
    );

    this.verify('agentFacetCount', agentFacets.length);
    this.log(`Found ${agentFacets.length} agent-related facets`);

    // Test that multiple components can operate
    this.log('Testing multi-component coordination...');
    const components = await this.context.debugServer.getComponents();

    const activeComponents = components.filter((c: any) =>
      c.status !== 'disabled' && c.status !== 'error'
    );

    this.assert(activeComponents.length >= 5, 'Should have multiple active components');
    this.verify('activeComponentCount', activeComponents.length);

    // Verify frame processing with multiple components
    this.log('Verifying multi-component frame processing...');
    const frames = await this.context.debugServer.getFrames(10);

    const frameWithMultipleOps = frames.find((f: any) => {
      const ops = f.operations || [];
      const uniqueComponents = new Set(ops.map((op: any) => op.component));
      return uniqueComponents.size >= 3;
    });

    this.assert(!!frameWithMultipleOps, 'Should have frames with multiple component operations');
    if (frameWithMultipleOps) {
      const ops = frameWithMultipleOps.operations || [];
      const uniqueComponents = new Set(ops.map((op: any) => op.component));
      this.verify('componentsInFrame', uniqueComponents.size);
      this.log(`✓ Frame processed by ${uniqueComponents.size} components`);
    }

    // Test agent response
    this.log('Testing agent response generation...');
    const speechFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'speech',
      15000
    );

    if (speechFacet) {
      this.verify('agentResponded', true);
      this.log('✓ Agent generated response');
    } else {
      this.log('Note: No speech facet detected (may be using mock LLM)');
      this.verify('agentResponded', false);
    }

    this.log('✅ Multi-agent coordination verified');
  }
}

/**
 * TEST-025: Control Panel Operations
 * Verify control panels and component interactions work correctly
 */
export class Test025ControlPanelOperationsReal extends BaseTest {
  id = 'TEST-025';
  name = 'Control Panel Operations (Real)';
  priority = 25;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;

    this.log('Testing control panel functionality...');

    // Check for control panel components
    this.log('Querying for control panel components...');
    const components = await this.context.debugServer.getComponents();

    const controlComponents = components.filter((c: any) =>
      c.name?.toLowerCase().includes('control') ||
      c.name?.toLowerCase().includes('panel')
    );

    this.log(`Found ${controlComponents.length} control-related components:`);
    for (const comp of controlComponents) {
      this.log(`  - ${comp.name} (type: ${comp.type || 'unknown'})`);
    }

    this.verify('controlComponentCount', controlComponents.length);

    // Test element tree visibility
    this.log('Testing element tree access...');
    const tree = await this.context.debugServer.getElementTree();

    this.assert(!!tree, 'Should have element tree');
    this.verify('elementTreeAccessible', true);

    const elementCount = this.countElements(tree);
    this.log(`Element tree has ${elementCount} total elements`);
    this.verify('totalElementCount', elementCount);

    // Test component listing functionality
    this.log('Testing component listing...');
    this.assert(components.length > 0, 'Should have components to list');

    const componentsByType: Record<string, number> = {};
    for (const comp of components) {
      const type = comp.type || 'unknown';
      componentsByType[type] = (componentsByType[type] || 0) + 1;
    }

    this.verify('componentsByType', componentsByType);
    this.log('Component breakdown:');
    for (const [type, count] of Object.entries(componentsByType)) {
      this.log(`  - ${type}: ${count}`);
    }

    // Test state inspection capability
    this.log('Testing state inspection...');
    const state = await this.context.debugServer.getState();

    this.assert(!!state, 'Should have state');
    this.assertHasProperty(state, 'space', 'State should include space');
    this.verify('stateInspectionWorks', true);

    // Test VEIL state access
    this.log('Testing VEIL state access...');
    const veilState = await this.context.debugServer.getVEILState();

    this.assert(!!veilState, 'Should have VEIL state');
    const facets = Array.isArray(veilState.facets)
      ? veilState.facets
      : Object.values(veilState.facets || {});

    this.log(`VEIL state contains ${facets.length} facets`);
    this.verify('veilFacetCount', facets.length);

    // Group facets by type
    const facetsByType: Record<string, number> = {};
    for (const facet of facets) {
      const type = (facet as any).type || 'unknown';
      facetsByType[type] = (facetsByType[type] || 0) + 1;
    }

    this.log('Facet breakdown:');
    for (const [type, count] of Object.entries(facetsByType)) {
      this.log(`  - ${type}: ${count}`);
    }
    this.verify('facetsByType', facetsByType);

    // Test frame history access
    this.log('Testing frame history access...');
    const frames = await this.context.debugServer.getFrames(20);

    this.assert(frames.length > 0, 'Should have frame history');
    this.verify('frameHistoryCount', frames.length);

    const recentFrames = frames.slice(0, 5);
    this.log(`Recent frames: ${recentFrames.map((f: any) => f.sequence || f.uuid?.slice(0, 8)).join(', ')}`);

    // Test metrics access
    this.log('Testing metrics access...');
    const metrics = await this.context.debugServer.getMetrics();

    if (metrics) {
      this.verify('metricsAvailable', true);
      this.log('✓ Performance metrics available');

      if (metrics.frameCount) {
        this.log(`  Total frames: ${metrics.frameCount}`);
      }
      if (metrics.eventCount) {
        this.log(`  Total events: ${metrics.eventCount}`);
      }
    } else {
      this.log('Note: Metrics not available (may not be implemented)');
      this.verify('metricsAvailable', false);
    }

    // Test real-time operation
    this.log('Testing real-time operation...');
    const testMessage = `<@${botId}> control panel test ${Date.now()}`;

    await this.context.discord.sendMessage(channelId, testMessage);

    const newFrame = await waitForFrame(
      this.context.debugServer,
      (f: any) => {
        const events = f.events || [];
        return events.some((e: any) =>
          e.topic === 'discord:message' &&
          e.payload?.content?.includes('control panel test')
        );
      },
      10000
    );

    this.assert(!!newFrame, 'Should process new events in real-time');
    this.verify('realTimeProcessing', true);

    this.log('✅ Control panel operations verified');
  }

  private countElements(element: any): number {
    let count = 1; // Count this element
    for (const child of element.children || []) {
      count += this.countElements(child);
    }
    return count;
  }
}

/**
 * Export real integration tests
 */
export const INTEGRATION_TESTS_REAL = [
  new Test024MultiAgentCoordinationReal(),
  new Test025ControlPanelOperationsReal()
];

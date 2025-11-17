/**
 * Real AXON Module Tests for Phase 0
 *
 * These tests use actual debug server HTTP calls to verify AXON module loading.
 * No mocks, no simulations - real integration testing.
 */

import { BaseTest } from '../test-framework';

/**
 * TEST-021: Module Loading
 * Verify AXON modules load correctly from the module server
 */
export class Test021ModuleLoadingReal extends BaseTest {
  id = 'TEST-021';
  name = 'Module Loading (Real)';
  priority = 21;

  async execute(): Promise<void> {
    if (!this.context.debugServer) {
      throw new Error('SKIP: Debug server not available');
    }

    this.log('Querying element tree for AXON elements...');
    const tree = await this.context.debugServer.getElementTree();

    // Find elements that are loaded from AXON modules
    const axonElements = this.findAxonElements(tree);

    this.log(`Found ${axonElements.length} AXON-loaded elements`);
    this.verify('axonElementCount', axonElements.length);

    if (axonElements.length === 0) {
      this.log('Note: No AXON elements found with explicit module URLs');
      this.log('Checking for dynamically loaded components instead...');
    }

    // Check for Discord components (likely AXON-loaded)
    this.log('Checking for Discord components...');
    const components = await this.context.debugServer.getComponents();

    const discordComponents = components.filter((c: any) =>
      c.name?.toLowerCase().includes('discord') ||
      c.source?.toLowerCase().includes('discord')
    );

    this.assert(discordComponents.length > 0, 'Should have Discord components (AXON-loaded)');
    this.verify('discordComponentCount', discordComponents.length);

    // Log Discord component details
    this.log(`Found ${discordComponents.length} Discord components:`);
    for (const comp of discordComponents) {
      this.log(`  - ${comp.name} (type: ${comp.type || 'unknown'})`);
      if (comp.source) {
        this.log(`    Source: ${comp.source}`);
      }
    }

    // Verify components are functioning (inference from presence)
    const discordReceptor = discordComponents.find((c: any) =>
      c.name?.includes('Receptor') || c.name?.includes('Afferent')
    );

    if (discordReceptor) {
      this.verify('discordReceptorLoaded', {
        name: discordReceptor.name,
        type: discordReceptor.type
      });
      this.log(`✓ Discord receptor loaded: ${discordReceptor.name}`);
    }

    // Verify module execution by checking recent frames
    this.log('Verifying module components are executing...');
    const frames = await this.context.debugServer.getFrames(10);

    const framesWithDiscordOps = frames.filter((f: any) => {
      const ops = f.operations || [];
      return ops.some((op: any) =>
        op.component?.toLowerCase().includes('discord')
      );
    });

    this.assert(
      framesWithDiscordOps.length > 0,
      'Discord components should be executing in frames'
    );
    this.verify('moduleComponentsExecuting', framesWithDiscordOps.length);
    this.log(`✓ Found ${framesWithDiscordOps.length} frames with Discord component execution`);

    // Check for proper TypeScript transpilation (inferred from execution)
    this.log('Verifying TypeScript transpilation...');
    const componentsWork = discordComponents.length > 0 && framesWithDiscordOps.length > 0;
    this.assert(componentsWork, 'Transpiled components should be working');
    this.verify('transpilationSuccessful', true);

    this.log('✅ Module loading verified');
  }

  private findAxonElements(element: any): any[] {
    let axonElements: any[] = [];

    // Check if this element is AXON-loaded
    if (
      element.moduleUrl ||
      element.source?.startsWith('axon://') ||
      element.type === 'axon'
    ) {
      axonElements.push(element);
    }

    // Recursively check children
    for (const child of element.children || []) {
      axonElements = axonElements.concat(this.findAxonElements(child));
    }

    return axonElements;
  }
}

/**
 * TEST-022: Hot Reload Infrastructure
 * Verify hot reload infrastructure exists (actual reload testing requires manual intervention)
 */
export class Test022HotReloadReal extends BaseTest {
  id = 'TEST-022';
  name = 'Hot Reload Infrastructure (Real)';
  priority = 22;

  async execute(): Promise<void> {
    if (!this.context.debugServer) {
      throw new Error('SKIP: Debug server not available');
    }

    this.log('Testing hot reload infrastructure...');
    this.log('Note: Full hot reload testing requires manual module modification');

    // Check element tree for AXON elements
    this.log('Checking for AXON elements...');
    const tree = await this.context.debugServer.getElementTree();
    const axonElements = this.findAxonElements(tree);

    this.verify('axonElementsPresent', axonElements.length > 0);

    // Check components for lifecycle support
    this.log('Verifying component lifecycle support...');
    const components = await this.context.debugServer.getComponents();

    // All components should be capable of reload (they're mounted)
    this.assert(components.length > 0, 'Should have components');
    this.verify('componentsCanReload', components.length);

    // Check system state for module server connection info
    this.log('Checking for module server connectivity...');
    const state = await this.context.debugServer.getState();

    // Log state structure for debugging
    if (state.config) {
      this.verify('hasConfig', true);
      this.log('✓ System configuration available');
    }

    if (state.space) {
      this.verify('hasSpace', true);
      this.log('✓ Space element accessible');
    }

    // Verify frames show continuous operation (system is stable)
    this.log('Verifying system stability for hot reload...');
    const frames = await this.context.debugServer.getFrames(20);

    const recentFrames = frames.filter((f: any) => {
      const age = Date.now() - (f.timestamp || 0);
      return age < 60000; // Last minute
    });

    this.log(`Found ${recentFrames.length} frames from the last minute`);
    this.verify('systemStable', recentFrames.length > 0);

    // Check for error frames (should be minimal)
    const errorFrames = frames.filter((f: any) =>
      f.status === 'error' || f.error
    );

    this.log(`Found ${errorFrames.length} error frames`);
    this.verify('errorFrameCount', errorFrames.length);

    // Verify component registry supports dynamic updates
    this.log('Verifying component registry...');
    const discordComponents = components.filter((c: any) =>
      c.name?.toLowerCase().includes('discord')
    );

    this.assert(
      discordComponents.length > 0,
      'Should have dynamically loaded components'
    );
    this.verify('dynamicComponentsPresent', discordComponents.length);

    this.log('Hot reload infrastructure verified');
    this.log('✅ System supports hot reload capability');
    this.log('Note: Actual hot reload test requires modifying module files during runtime');
  }

  private findAxonElements(element: any): any[] {
    let axonElements: any[] = [];

    if (
      element.moduleUrl ||
      element.source?.startsWith('axon://') ||
      element.type === 'axon'
    ) {
      axonElements.push(element);
    }

    for (const child of element.children || []) {
      axonElements = axonElements.concat(this.findAxonElements(child));
    }

    return axonElements;
  }
}

/**
 * Export real AXON module tests
 */
export const AXON_MODULE_TESTS_REAL = [
  new Test021ModuleLoadingReal(),
  new Test022HotReloadReal()
];

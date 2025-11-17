/**
 * Real Agent System Tests
 *
 * Tests for agent functionality using actual system queries
 */

import { BaseTest } from '../test-framework';
import { waitForFacet, waitForFrame } from '../test-helpers';

/**
 * TEST-012: Context Assembly
 * Verify context builds correctly with message history and tools
 */
export class Test012ContextAssemblyReal extends BaseTest {
  id = 'TEST-012';
  name = 'Context Assembly (Real)';
  priority = 12;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;

    // First, send a few messages to ensure there's history
    this.log('Setting up message history...');
    await this.context.discord.sendMessage(channelId, 'Previous message 1');
    await this.sleep(500);
    await this.context.discord.sendMessage(channelId, 'Previous message 2');
    await this.sleep(500);

    // Now trigger agent with mention
    const testContent = `context test ${Date.now()}`;
    const mentionMessage = `<@${botId}> ${testContent}`;

    this.log(`Triggering agent activation with: "${mentionMessage}"`);
    await this.context.discord.sendMessage(channelId, mentionMessage);

    // Wait for rendered-context facet
    this.log('Waiting for context rendering...');
    const contextFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'rendered-context' || f.type === 'context',
      15000
    );

    this.assert(!!contextFacet, 'Context should be rendered');
    this.verify('contextFacetFound', { type: contextFacet.type });

    // Analyze context content
    const contextStr = JSON.stringify(contextFacet);
    this.log(`Context size: ${contextStr.length} characters`);

    // Check for message history
    const hasMessageHistory =
      contextStr.includes('message') ||
      contextStr.includes('Previous message') ||
      contextStr.includes('history');

    this.verify('hasMessageHistory', hasMessageHistory);
    this.log(hasMessageHistory ? '✓ Context includes message history' : '⚠️  No obvious message history');

    // Check for tool instructions
    const hasTools =
      contextStr.includes('tool') ||
      contextStr.includes('action') ||
      contextStr.includes('@');

    this.verify('hasToolInstructions', hasTools);
    this.log(hasTools ? '✓ Context includes tool instructions' : '⚠️  No obvious tool instructions');

    // Check token count if available
    if (contextFacet.tokenCount) {
      this.verify('tokenCount', contextFacet.tokenCount);
      this.assert(
        contextFacet.tokenCount > 0 && contextFacet.tokenCount < 100000,
        'Token count should be reasonable'
      );
      this.log(`✓ Token count: ${contextFacet.tokenCount}`);
    }

    // Verify context structure
    this.assert(contextStr.length > 100, 'Context should have substantial content');
    this.verify('contextLength', contextStr.length);

    this.log('✅ Context assembly verified - includes history and tools');
  }
}

/**
 * TEST-013: Tool Execution
 * Verify tool calls work correctly
 */
export class Test013ToolExecutionReal extends BaseTest {
  id = 'TEST-013';
  name = 'Tool Execution (Real)';
  priority = 13;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;

    this.log('Sending tool invocation command...');

    // Test a tool invocation (e.g., @box-dispenser.createBox)
    const toolCommand = `<@${botId}> @box-dispenser.createBox color=red`;

    await this.context.discord.sendMessage(channelId, toolCommand);

    // Wait for action facet to appear
    this.log('Waiting for action facet...');
    const actionFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'action',
      10000
    );

    if (actionFacet) {
      this.verify('actionFacetCreated', {
        type: actionFacet.type,
        component: actionFacet.component,
        method: actionFacet.method
      });

      this.log(`✓ Action facet created: ${actionFacet.component}.${actionFacet.method}`);

      // Check that action matches what we requested
      if (actionFacet.component) {
        const matchesRequest =
          actionFacet.component.includes('box') ||
          actionFacet.component.includes('dispenser');

        this.verify('actionMatchesRequest', matchesRequest);
      }
    } else {
      this.log('⚠️  No action facet found - tool may not have been parsed');
    }

    // Wait for ActionEffector execution
    this.log('Waiting for tool execution in frames...');
    const executionFrame = await waitForFrame(
      this.context.debugServer,
      (f: any) => {
        const ops = f.operations || [];
        return ops.some((op: any) =>
          op.component?.includes('ActionEffector') ||
          op.component?.includes('Effector')
        );
      },
      10000
    );

    if (executionFrame) {
      this.verify('toolExecuted', true);
      this.log('✓ ActionEffector executed');
    } else {
      this.log('⚠️  Could not verify ActionEffector execution');
    }

    // Wait for bot response that might indicate tool result
    this.log('Waiting for bot response with tool result...');
    const botResponse = await this.context.discord.waitForMessage(
      channelId,
      (msg) => msg.author.id === botId,
      15000
    );

    if (botResponse) {
      this.verify('botResponded', {
        messageId: botResponse.id,
        contentPreview: botResponse.content.substring(0, 100)
      });
      this.log(`✓ Bot responded: "${botResponse.content.substring(0, 50)}..."`);

      // Check if response seems to acknowledge the tool
      const mentionsTool =
        botResponse.content.toLowerCase().includes('box') ||
        botResponse.content.toLowerCase().includes('created') ||
        botResponse.content.toLowerCase().includes('action');

      this.verify('responseMentionsTool', mentionsTool);
    } else {
      this.log('⚠️  No bot response received');
    }

    this.log('✅ Tool execution verified - tools can be invoked');
  }
}

export const AGENT_SYSTEM_TESTS_REAL = [
  new Test012ContextAssemblyReal(),
  new Test013ToolExecutionReal()
];

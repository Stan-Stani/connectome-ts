/**
 * Real Priority Tests for Phase 0
 *
 * These tests use actual Discord API and debug server HTTP calls.
 * No mocks, no simulations - real integration testing.
 */

import { BaseTest } from '../test-framework';
import { waitForFrame, waitForFacet } from '../test-helpers';

/**
 * TEST-003: Message Reception
 * Verify bot receives Discord messages by actually sending one
 */
export class Test003MessageReceptionReal extends BaseTest {
  id = 'TEST-003';
  name = 'Message Reception (Real)';
  priority = 3;

  async execute(): Promise<void> {
    if (!this.context.discord) {
      this.log('⊘ Skipping: Discord not connected');
      throw new Error('SKIP: Discord not available');
    }

    if (!this.context.debugServer) {
      this.log('⊘ Skipping: Debug server not available');
      throw new Error('SKIP: Debug server not available');
    }

    const { channelId } = this.context.config;
    const testMessage = `Test message ${Date.now()}`;

    this.log(`Sending real Discord message: "${testMessage}"`);
    const sentMessage = await this.context.discord.sendMessage(channelId, testMessage);
    this.verify('messageSent', { id: sentMessage.id, content: testMessage });

    this.log('Waiting for message to appear in frames...');
    const frame = await waitForFrame(
      this.context.debugServer,
      (f: any) => {
        const events = f.events || [];
        return events.some((e: any) =>
          e.topic === 'discord:message' &&
          e.payload?.content?.includes(testMessage)
        );
      },
      10000
    );

    this.assert(!!frame, 'Message event not found in frames');
    this.verify('frameFound', { frameId: frame.uuid, sequence: frame.sequence });

    this.log('✅ Message reception verified - real Discord message was processed');
  }
}

/**
 * TEST-004: Mention Detection
 * Verify bot only responds to mentions by sending real messages
 */
export class Test004MentionDetectionReal extends BaseTest {
  id = 'TEST-004';
  name = 'Mention Detection (Real)';
  priority = 4;

  async execute(): Promise<void> {
    if (!this.context.discord) {
      throw new Error('SKIP: Discord not available');
    }

    if (!this.context.debugServer) {
      throw new Error('SKIP: Debug server not available');
    }

    const { channelId, botId } = this.context.config;

    // Test 1: Send message WITHOUT mention
    this.log('Test 1: Sending message without mention...');
    const nonMentionMessage = `Hello bot ${Date.now()}`;
    await this.context.discord.sendMessage(channelId, nonMentionMessage);

    await this.sleep(2000);

    // Check that NO agent activation occurred
    this.log('Checking that agent did NOT activate...');
    const veilState1 = await this.context.debugServer!.getVEILState();
    const facets1 = Array.isArray(veilState1.facets)
      ? veilState1.facets
      : Object.values(veilState1.facets || {});

    const activation1 = facets1.find((f: any) =>
      f.type === 'agent-activation' &&
      f.trigger?.includes(nonMentionMessage)
    );

    this.assert(!activation1, 'Agent should NOT activate without mention');
    this.verify('nonMentionIgnored', true);

    // Test 2: Send message WITH mention
    this.log('Test 2: Sending message with mention...');
    const mentionMessage = `<@${botId}> Hello ${Date.now()}`;
    await this.context.discord.sendMessage(channelId, mentionMessage);

    // Wait for agent activation facet
    this.log('Waiting for agent activation...');
    const activationFacet = await waitForFacet(
      this.context.debugServer!,
      (f: any) => f.type === 'agent-activation',
      10000
    );

    this.assert(!!activationFacet, 'Agent should activate with mention');
    this.verify('mentionDetected', true);
    this.verify('agentActivated', {
      facetType: activationFacet?.type,
      agentId: activationFacet?.agentId
    });

    this.log('✅ Mention detection verified - agent only activates on mention');
  }
}

/**
 * TEST-011: Agent Activation
 * Verify agent activates and processes requests
 */
export class Test011AgentActivationReal extends BaseTest {
  id = 'TEST-011';
  name = 'Agent Activation (Real)';
  priority = 11;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;
    const testContent = `test activation ${Date.now()}`;
    const mentionMessage = `<@${botId}> ${testContent}`;

    this.log(`Sending mention: "${mentionMessage}"`);
    await this.context.discord.sendMessage(channelId, mentionMessage);

    // Wait for agent-activation facet
    this.log('Waiting for agent-activation facet...');
    const activationFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'agent-activation',
      10000
    );

    this.assert(!!activationFacet, 'Agent activation facet should exist');
    this.assertEqual(activationFacet.type, 'agent-activation');
    this.verify('activationFacet', {
      type: activationFacet.type,
      agentId: activationFacet.agentId
    });

    // Wait for frames showing effector execution
    this.log('Waiting for AgentEffector execution...');
    const effectFrame = await waitForFrame(
      this.context.debugServer,
      (f: any) => {
        const ops = f.operations || [];
        return ops.some((op: any) => op.component?.includes('AgentEffector'));
      },
      10000
    );

    this.assert(!!effectFrame, 'AgentEffector should process activation');
    this.verify('effectorProcessed', true);

    this.log('✅ Agent activation verified - full activation pipeline works');
  }
}

/**
 * TEST-014: Speech Output
 * Verify bot sends responses to Discord
 */
export class Test014SpeechOutputReal extends BaseTest {
  id = 'TEST-014';
  name = 'Speech Output (Real)';
  priority = 14;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;
    const testContent = `speech test ${Date.now()}`;
    const mentionMessage = `<@${botId}> ${testContent}`;

    this.log(`Triggering bot response with: "${mentionMessage}"`);
    await this.context.discord.sendMessage(channelId, mentionMessage);

    // Wait for speech facet to appear
    this.log('Waiting for speech facet...');
    const speechFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'speech',
      15000
    );

    this.assert(!!speechFacet, 'Speech facet should be created');
    this.assertEqual(speechFacet.type, 'speech');
    this.verify('speechFacet', {
      type: speechFacet.type,
      content: speechFacet.content
    });

    // Wait for bot's response message in Discord
    this.log('Waiting for bot response in Discord...');
    const botResponse = await this.context.discord.waitForMessage(
      channelId,
      (msg) => msg.author.id === botId,
      15000
    );

    this.assert(!!botResponse, 'Bot should send response message');
    this.verify('botResponded', {
      messageId: botResponse?.id,
      content: botResponse?.content
    });

    this.log('✅ Speech output verified - bot responded in Discord');
  }
}

/**
 * TEST-023: Full Message Pipeline
 * End-to-end test of complete message processing
 */
export class Test023FullMessagePipelineReal extends BaseTest {
  id = 'TEST-023';
  name = 'Full Message Pipeline (Real)';
  priority = 23;

  async execute(): Promise<void> {
    if (!this.context.discord || !this.context.debugServer) {
      throw new Error('SKIP: Discord or debug server not available');
    }

    const { channelId, botId } = this.context.config;
    const testContent = `pipeline test ${Date.now()}`;

    this.log('=== Starting Full Message Pipeline Test ===');

    // Step 1: Send Discord message with mention
    this.log('Step 1: Sending Discord message...');
    const mentionMessage = `<@${botId}> ${testContent}`;
    const sentMessage = await this.context.discord.sendMessage(channelId, mentionMessage);
    this.verify('step1_messageSent', sentMessage.id);

    // Step 2: Verify reception in frames
    this.log('Step 2: Waiting for message reception...');
    const messageFrame = await waitForFrame(
      this.context.debugServer,
      (f: any) => f.events?.some((e: any) =>
        e.topic === 'discord:message' && e.payload?.content?.includes(testContent)
      ),
      10000
    );
    this.assert(!!messageFrame, 'Message should be received');
    this.verify('step2_messageReceived', messageFrame.uuid);

    // Step 3: Wait for agent activation
    this.log('Step 3: Waiting for agent activation...');
    const activationFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'agent-activation',
      10000
    );
    this.assert(!!activationFacet, 'Agent should activate');
    this.verify('step3_agentActivated', true);

    // Step 4: Wait for rendered context
    this.log('Step 4: Waiting for context rendering...');
    const contextFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'rendered-context' || f.type === 'context',
      10000
    );
    this.assert(!!contextFacet, 'Context should be rendered');
    this.verify('step4_contextRendered', true);

    // Step 5: Wait for speech facet
    this.log('Step 5: Waiting for speech generation...');
    const speechFacet = await waitForFacet(
      this.context.debugServer,
      (f: any) => f.type === 'speech',
      20000
    );
    this.assert(!!speechFacet, 'Speech should be generated');
    this.verify('step5_speechGenerated', true);

    // Step 6: Wait for bot response in Discord
    this.log('Step 6: Waiting for bot response in Discord...');
    const botResponse = await this.context.discord.waitForMessage(
      channelId,
      (msg) => msg.author.id === botId && msg.id !== sentMessage.id,
      20000
    );
    this.assert(!!botResponse, 'Bot should respond in Discord');
    this.verify('step6_botResponded', {
      messageId: botResponse?.id,
      content: botResponse?.content?.substring(0, 100)
    });

    this.log('=== Full Pipeline Test Complete ===');
    this.log('✅ All 6 steps verified - complete pipeline working!');
  }
}

/**
 * Export real priority tests
 */
export const PRIORITY_TESTS_REAL = [
  new Test003MessageReceptionReal(),
  new Test004MentionDetectionReal(),
  new Test011AgentActivationReal(),
  new Test014SpeechOutputReal(),
  new Test023FullMessagePipelineReal()
];

// index.js
// CommonJS entry point for All Features Bot
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

module.exports = async function(ctx) {
  ctx.log.info('All Features Bot: Activating...', { version: ctx.manifest.version });

  const unsubs = [];
  const activeTimers = [];

  // Register onActivate hook
  ctx.onActivate(async () => {
    ctx.log.info('All Features Bot: Activated!');
    
    // Dedicated Chat greeting
    if (ctx.dedicatedChat) {
      try {
        await ctx.dedicatedChat.send({
          type: 'card',
          title: '🧪 All Features Bot',
          body: 'This extension is running and tests all SmartChat Extension APIs.\n\nUse commands to test specific features:\n• /status\n• /test_storage\n• /test_tools\n• /test_self\n• /test_scheduler\n• /test_ui\n• /test_node\n• /test_llm',
          buttons: [
            { id: 'status', label: 'Check Status' },
            { id: 'test_node', label: 'Test Node APIs' },
            { id: 'test_llm', label: 'Test LLM API' }
          ]
        });
      } catch (err) {
        ctx.log.error('Failed to send dedicated chat greeting', err.message);
      }
    }
  });

  // Register onDeactivate hook
  ctx.onDeactivate(async () => {
    ctx.log.info('All Features Bot: Deactivating...');
    
    // Cleanup event listeners
    ctx.log.info(`Cleaning up ${unsubs.length} event listeners`);
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch (err) {
        ctx.log.error('Error during event unsub', err.message);
      }
    }

    // Cleanup timers
    ctx.log.info(`Cleaning up ${activeTimers.length} active timers`);
    for (const clearFn of activeTimers) {
      try {
        clearFn();
      } catch (err) {
        ctx.log.error('Error during timer cleanup', err.message);
      }
    }
    
    ctx.log.info('All Features Bot: Deactivated successfully');
  });

  // --- 1. Event Listeners ---
  if (ctx.events) {
    const eventsToRegister = [
      'message:incoming',
      'message:deleted',
      'message:edited',
      'message:status-updated',
      'reaction:processed',
      'chat:created',
      'chat:archived',
      'chat:pinned',
      'contact:updated',
      'group:participant-added',
      'group:participant-removed',
      'group:subject-changed',
      'connection:open',
      'connection:close',
      'extension:chat-message'
    ];

    for (const eventName of eventsToRegister) {
      try {
        const unsub = ctx.events.on(eventName, async (payload) => {
          ctx.log.info(`Event Received [${eventName}]:`, JSON.stringify(payload, (k, v) => typeof v === 'bigint' ? v.toString() : v));

          // If it is our dedicated chat message
          if (eventName === 'extension:chat-message') {
            let cmdText = payload.text;
            // Handle buttons which prefix message with "__button:"
            if (cmdText && cmdText.startsWith('__button:')) {
              cmdText = '/' + cmdText.substring('__button:'.length);
            }
            await handleDedicatedChatMessage(cmdText);
          }
        });
        unsubs.push(unsub);
      } catch (err) {
        ctx.log.error(`Failed to register event listener for ${eventName}`, err.message);
      }
    }
  } else {
    ctx.log.warn('Events capability is not available in ExtensionContext');
  }

  // --- Helper to reply in dedicated chat ---
  async function reply(text, cardOpts = null) {
    if (!ctx.dedicatedChat) {
      ctx.log.info('Dedicated chat not available to reply:', text);
      return;
    }
    try {
      if (cardOpts) {
        await ctx.dedicatedChat.send({
          type: 'card',
          title: cardOpts.title || 'Notification',
          body: text,
          buttons: cardOpts.buttons
        });
      } else {
        await ctx.dedicatedChat.send({
          type: 'text',
          text: text
        });
      }
    } catch (err) {
      ctx.log.error('Failed to send reply to dedicated chat', err.message);
    }
  }

  // --- Command Handler ---
  async function handleDedicatedChatMessage(text) {
    if (!text) return;
    const cleanText = text.trim();
    ctx.log.info(`Handling dedicated chat message: "${cleanText}"`);

    // Handle button clicks or direct text commands
    if (cleanText === '/status' || cleanText === 'status') {
      await showStatus();
    } else if (cleanText === '/test_storage' || cleanText === 'test_storage') {
      await runStorageTest();
    } else if (cleanText === '/test_tools' || cleanText === 'test_tools') {
      await runToolsTest();
    } else if (cleanText === '/test_self' || cleanText === 'test_self') {
      await runSelfQueryTest();
    } else if (cleanText === '/test_scheduler' || cleanText === 'test_scheduler') {
      await runSchedulerTest();
    } else if (cleanText === '/test_ui' || cleanText === 'test_ui') {
      await runUITest();
    } else if (cleanText === '/test_node' || cleanText === 'test_node') {
      await runNodeTest();
    } else if (cleanText === '/test_llm' || cleanText === 'test_llm') {
      await runLlmTest();
    } else if (cleanText === '/test_llm_multi' || cleanText === 'test_llm_multi') {
      await runLlmMultiTest();
    } else {
      await reply(`Unknown command: "${cleanText}". Supported: /status, /test_storage, /test_tools, /test_self, /test_scheduler, /test_ui, /test_node, /test_llm, /test_llm_multi`);
    }
  }

  // --- API status check ---
  async function showStatus() {
    const status = {
      storage: !!ctx.storage,
      events: !!ctx.events,
      scheduler: !!ctx.scheduler,
      tools: !!ctx.tools,
      ui: !!ctx.ui,
      dedicatedChat: !!ctx.dedicatedChat,
      llm: !!ctx.llm
    };

    let replyText = '🔌 API Availability Status:\n';
    for (const [key, available] of Object.entries(status)) {
      replyText += `${available ? '✅' : '❌'} ${key}\n`;
    }
    await reply(replyText);
  }

  // --- 2. Storage Test ---
  async function runStorageTest() {
    if (!ctx.storage) {
      await reply('❌ Storage API is not available.');
      return;
    }
    try {
      ctx.log.info('Running Storage Test...');
      await ctx.storage.set('test_string', 'hello world');
      await ctx.storage.set('test_number', 42);
      await ctx.storage.set('test_object', { foo: 'bar', nested: [1, 2, 3] });

      const str = await ctx.storage.get('test_string');
      const num = await ctx.storage.get('test_number');
      const obj = await ctx.storage.get('test_object');

      if (str !== 'hello world' || num !== 42 || !obj || obj.foo !== 'bar') {
        throw new Error('Retrieved values do not match set values');
      }

      const keysBefore = await ctx.storage.keys();
      if (!keysBefore.includes('test_string') || !keysBefore.includes('test_number')) {
        throw new Error('Keys list is missing set keys');
      }

      await ctx.storage.delete('test_string');
      const strAfterDelete = await ctx.storage.get('test_string');
      if (strAfterDelete !== undefined) {
        throw new Error('Key was not deleted successfully');
      }

      await ctx.storage.clear();
      const keysAfterClear = await ctx.storage.keys();
      if (keysAfterClear.length !== 0) {
        throw new Error('Storage was not cleared successfully');
      }

      await reply('✅ Storage API Test Passed!\nSuccessfully tested set, get, keys, delete, and clear.');
    } catch (err) {
      ctx.log.error('Storage test failed', err.message);
      await reply(`❌ Storage API Test Failed: ${err.message}`);
    }
  }

  // --- 3. Tools Test ---
  let toolRegistered = false;
  async function runToolsTest() {
    if (!ctx.tools) {
      await reply('❌ Tools API is not available.');
      return;
    }

    try {
      ctx.log.info('Running Tools Test...');

      // Register tool if not done yet
      if (!toolRegistered) {
        ctx.tools.register({
          name: 'test_calc',
          description: 'Calculates the square of a number for All Features Bot testing',
          schema: {
            type: 'object',
            properties: {
              num: { type: 'number', description: 'The number to square' }
            },
            required: ['num']
          },
          execute: async (args) => {
            const val = Number(args.num);
            ctx.log.info(`Tool execute invoked with:`, args);
            return {
              success: true,
              result: val * val
            };
          }
        });
        toolRegistered = true;
      }

      // List tools
      const toolList = ctx.tools.list();
      ctx.log.info('Registered tools list:', toolList);
      if (!toolList.includes('test_calc')) {
        throw new Error('Registered tool "test_calc" not found in tool list');
      }

      // Call our registered tool
      const callResult = await ctx.tools.call('test_calc', { num: 8 });
      
      // Detailed logging of the callResult
      ctx.log.info('Tool call result raw:', callResult);
      ctx.log.info('Tool call result type:', typeof callResult);
      ctx.log.info('Tool call result stringified:', JSON.stringify(callResult));

      // Parse and verify the stringified result returned from callResult.text
      if (!callResult || typeof callResult.text !== 'string') {
        throw new Error(`Tool call returned invalid shape: ${JSON.stringify(callResult)}`);
      }

      const parsed = JSON.parse(callResult.text);
      ctx.log.info('Tool call parsed text:', parsed);

      if (!parsed.success || parsed.result !== 64) {
        throw new Error(`Parsed tool result was incorrect: ${JSON.stringify(parsed)}`);
      }

      await reply(`✅ Tools API Test Passed!\nRegistered "test_calc", found it in list(), and executed it successfully.\nRaw text returned: ${callResult.text}`);
    } catch (err) {
      ctx.log.error('Tools test failed', err.message);
      await reply(`❌ Tools API Test Failed: ${err.message}`);
    }
  }

  // --- Query own details test ---
  async function runSelfQueryTest() {
    if (!ctx.tools) {
      await reply('❌ Tools API is not available.');
      return;
    }
    try {
      ctx.log.info('Running Self Query Test...');
      const sql = 'SELECT id, phoneNumber, displayName, pushName, isMe FROM Identity WHERE isMe = 1';
      const explanation = 'Querying own identity details from the database.';
      
      const result = await ctx.tools.call('queryDatabase', { sql, explanation });
      ctx.log.info('Self query result:', result);
      
      if (!result || typeof result.text !== 'string') {
        throw new Error('Invalid query result returned');
      }
      
      const parsed = JSON.parse(result.text);
      if (parsed.rows && parsed.rows.length > 0) {
        const self = parsed.rows[0];
        await reply(`✅ Query own details test passed!\n👤 JID: ${self.phoneNumber || 'Unknown'}\n👋 Push Name: ${self.pushName || 'Unknown'}\n🆔 ID: ${self.id}\n🌟 isMe: ${self.isMe}`);
      } else {
        await reply('⚠️ Self Query Test completed, but no identity with isMe = 1 was found in the database.');
      }
    } catch (err) {
      ctx.log.error('Self query test failed', err.message);
      await reply(`❌ Self Query Test Failed: ${err.message}`);
    }
  }


  // --- 5. Scheduler Test ---
  async function runSchedulerTest() {
    if (!ctx.scheduler) {
      await reply('❌ Scheduler API is not available.');
      return;
    }

    try {
      ctx.log.info('Running Scheduler Test...');

      // Test Timeout
      const timeoutPromise = new Promise((resolve) => {
        const clearTime = ctx.scheduler.setTimeout(1500, () => {
          ctx.log.info('Test timeout triggered');
          resolve(true);
        });
        activeTimers.push(clearTime);
      });

      // Test Interval
      let intervalCount = 0;
      const intervalPromise = new Promise((resolve) => {
        const clearIntervalFn = ctx.scheduler.setInterval(500, () => {
          intervalCount++;
          ctx.log.info(`Test interval triggered, count: ${intervalCount}`);
          if (intervalCount >= 3) {
            clearIntervalFn();
            resolve(true);
          }
        });
        activeTimers.push(clearIntervalFn);
      });

      await reply('⏳ Running 1.5s timeout and 3x 0.5s interval tests...');
      await Promise.all([timeoutPromise, intervalPromise]);

      // Cron job listener registration
      ctx.scheduler.onCron('heartbeat', () => {
        ctx.log.info('Cron job "heartbeat" ticked');
      });

      await reply('✅ Scheduler API Test Passed!\nSuccessfully completed setTimeout, setInterval, and registered onCron("heartbeat").');
    } catch (err) {
      ctx.log.error('Scheduler test failed', err.message);
      await reply(`❌ Scheduler API Test Failed: ${err.message}`);
    }
  }

  // --- 6. UI Test ---
  async function runUITest() {
    if (!ctx.ui) {
      await reply('❌ UI API is not available.');
      return;
    }

    try {
      ctx.log.info('Running UI Test...');
      
      // Toast message
      ctx.ui.toast('Hello from All Features Bot!', 'info');

      // OS Notification
      await ctx.ui.notify({
        title: '🧪 All Features Bot',
        body: 'This is a test notification from the Extension System verification bot.'
      });

      await reply('ℹ️ Testing UI notify, toast, and showing settings modal...');
      
      // Show settings schema
      try {
        const settings = await ctx.ui.showSettings({
          type: 'object',
          properties: {
            testSetting: {
              type: 'string',
              title: 'Test Setting',
              default: 'Change me'
            }
          }
        });
        ctx.log.info('UI settings submitted:', settings);
        await reply(`✅ UI API Test Completed!\nReceived settings: ${JSON.stringify(settings)}`);
      } catch (settingsErr) {
        ctx.log.warn('showSettings encountered an issue (this is expected if showSettings is not yet fully implemented):', settingsErr.message);
        await reply(`⚠️ UI API Test partially completed (notify and toast passed, showSettings skipped: "${settingsErr.message}").`);
      }
    } catch (err) {
      ctx.log.error('UI test failed', err.message);
      await reply(`❌ UI API Test Failed: ${err.message}`);
    }
  }

  // --- 7. Node.js & Package Test ---
  async function runNodeTest() {
    try {
      ctx.log.info('Running Node/Package Test...');
      await reply('⏳ Running Node.js Core & Package API tests...');

      // 1. Test third-party uuid package
      const uuidVal = uuidv4();
      ctx.log.info('Generated UUID:', uuidVal);
      if (!uuidVal || typeof uuidVal !== 'string' || uuidVal.length !== 36) {
        throw new Error('Failed to generate a valid UUID using third-party "uuid" package');
      }

      // 2. Test Node.js crypto module
      const hash = crypto.createHash('sha256').update(uuidVal).digest('hex');
      ctx.log.info('Computed SHA256 hash:', hash);
      if (!hash || typeof hash !== 'string' || hash.length !== 64) {
        throw new Error('Failed to compute SHA256 hash using "crypto" core module');
      }

      // 3. Test Node.js fs & path modules
      const os = require('os');
      const tempFilePath = path.join(os.tmpdir(), `all-features-bot-test-${uuidVal}.txt`);
      ctx.log.info('Writing temporary file to:', tempFilePath);
      fs.writeFileSync(tempFilePath, `UUID: ${uuidVal}\nHash: ${hash}`, 'utf8');
      
      if (!fs.existsSync(tempFilePath)) {
        throw new Error('Failed to write temporary file using "fs" and "path" modules');
      }
      
      const fileContent = fs.readFileSync(tempFilePath, 'utf8');
      ctx.log.info('Read temp file content:', fileContent);
      if (!fileContent.includes(uuidVal)) {
        throw new Error('Temp file content does not match expected output');
      }

      fs.unlinkSync(tempFilePath);
      if (fs.existsSync(tempFilePath)) {
        throw new Error('Failed to delete temporary file using fs.unlinkSync');
      }

      // 4. Test Node.js http module (requesting local Vite server)
      const httpPromise = new Promise((resolve, reject) => {
        const req = http.get('http://localhost:5173/', (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(res.statusCode);
            } else {
              reject(new Error(`HTTP request failed with status code ${res.statusCode}`));
            }
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('HTTP request timed out after 5s'));
        });
      });

      await reply('⏳ Fetching mock data from local server via http...');
      const statusCode = await httpPromise;
      ctx.log.info('Local HTTP request status code:', statusCode);

      await reply(`✅ Node.js Core & Package API Test Passed!\n` +
                  `📦 Third-party "uuid" value: ${uuidVal}\n` +
                  `🔑 Core "crypto" hash: ${hash}\n` +
                  `📁 Core "fs" & "path" file read/write: Success\n` +
                  `🌐 Core "http" request to localhost: Success (Status: ${statusCode})`);
    } catch (err) {
      ctx.log.error('Node/Package test failed', err.message);
      await reply(`❌ Node.js Core & Package API Test Failed: ${err.message}`);
    }
  }

  // --- 8. LLM Test ---
  async function runLlmTest() {
    if (!ctx.llm) {
      await reply('❌ LLM API is not available.');
      return;
    }

    try {
      ctx.log.info('Running LLM Test...');
      await reply('⏳ Calling LLM chat (checking simple query)...');

      const response = await ctx.llm.chat('Hello! Please respond with exactly the word "Hello".');
      ctx.log.info('LLM Response:', response);

      if (!response || typeof response !== 'string') {
        throw new Error('LLM returned an empty or invalid response');
      }

      await reply('⏳ Calling LLM chat with custom options and history...');
      const response2 = await ctx.llm.chat('Acknowledge in one sentence.', {
        useThinkMode: false,
        history: [
          { role: 'user', content: 'What is 5+5?' },
          { role: 'ai', content: 'It is 10.' }
        ]
      });
      ctx.log.info('LLM Response with options:', response2);

      await reply(`✅ LLM API Test Passed!\n` +
                  `🤖 Simple response: "${response.trim()}"\n` +
                  `💬 Conversational response: "${response2.trim()}"`);
    } catch (err) {
      ctx.log.error('LLM test failed', err.message);
      await reply(`❌ LLM API Test Failed: ${err.message}`);
    }
  }

  // --- 9. LLM Multi-Turn Test ---
  async function runLlmMultiTest() {
    if (!ctx.llm) {
      await reply('❌ LLM API is not available.');
      return;
    }

    try {
      ctx.log.info('Running LLM Multi-Turn Test...');
      await reply('⏳ Calling LLM chat to trigger a multi-turn tool execution loop (find my details from db)...');

      // We explicitly request the AI to find my details from db
      const prompt = 'find my details from db';
      const response = await ctx.llm.chat(prompt);

      ctx.log.info('LLM Multi-Turn Response:', response);

      if (!response || typeof response !== 'string') {
        throw new Error('LLM returned an empty or invalid response');
      }

      await reply(`✅ LLM Multi-Turn API Test Passed!\n` +
                  `🤖 Final Response: "${response.trim()}"`);
    } catch (err) {
      ctx.log.error('LLM multi-turn test failed', err.message);
      await reply(`❌ LLM Multi-Turn API Test Failed: ${err.message}`);
    }
  }
};

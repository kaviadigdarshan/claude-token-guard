"use strict";

const crypto = require('crypto');
const fs = require('fs');

const args = process.argv.slice(2);

function makeAssistant({ inputTokens = 1, cacheRead = 0, cacheCreate = 0,
                         outputTokens = 100, command = null } = {}) {
  const content = command
    ? [{ type: 'tool_use', id: 't1', name: 'Bash',
         input: { command }, caller: { type: 'direct' } }]
    : [{ type: 'text', text: 'response' }];
  return JSON.stringify({
    type: 'assistant',
    uuid: crypto.randomUUID(),
    parentUuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'ctg-test-session',
    isSidechain: false,
    message: {
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      type: 'message',
      content,
      stop_reason: command ? 'tool_use' : 'end_turn',
      stop_details: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
        output_tokens: outputTokens
      }
    }
  });
}

function makeUser(text) {
  return JSON.stringify({
    type: 'user',
    uuid: crypto.randomUUID(),
    parentUuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'ctg-test-session',
    isSidechain: false,
    message: { role: 'user', content: [{ type: 'text', text }] }
  });
}

const SCENARIOS = {

  r1: {
    label: 'Rule 1 — Single turn token spike (>100k)',
    lines: [
      makeAssistant({ cacheRead: 110_000, inputTokens: 1, outputTokens: 500 })
    ]
  },

  r2: {
    label: 'Rule 2 — Session crosses 1M tokens',
    lines: Array.from({ length: 20 }, (_, i) =>
      makeAssistant({ cacheRead: 50_000 + i * 1000, inputTokens: 1,
                      outputTokens: 200 })
    )
  },

  r3: {
    label: 'Rule 3 — 3-turn upward trend',
    lines: [
      makeAssistant({ cacheRead: 20_000, outputTokens: 100 }),
      makeAssistant({ cacheRead: 35_000, outputTokens: 200 }),
      makeAssistant({ cacheRead: 55_000, outputTokens: 300 }),
    ]
  },

  r4: {
    label: 'Rule 4 — Cache miss on large turn',
    lines: [
      makeAssistant({ cacheRead: 0, cacheCreate: 80_000,
                      inputTokens: 80_000, outputTokens: 500 })
    ]
  },

  r5: {
    label: 'Rule 5 — P1 LIVE dangerous command',
    lines: [
      makeAssistant({ command: 'cat ~/gecx-hub/CLAUDE.md | head -50' }),
      makeAssistant({ command: 'grep -r "secret" ~/gecx-hub/backend' }),
    ]
  },

  r6: {
    label: 'Rule 6 — P10 correction loop (same prompt 3x)',
    lines: [
      makeUser('fix the authentication bug in the webhook handler so tokens are validated correctly'),
      makeAssistant({ cacheRead: 10_000, outputTokens: 200 }),
      makeUser('fix the authentication bug in the webhook handler so tokens are validated correctly'),
      makeAssistant({ cacheRead: 11_000, outputTokens: 210 }),
      makeUser('fix the authentication bug in the webhook handler so tokens are validated correctly'),
      makeAssistant({ cacheRead: 12_000, outputTokens: 220 }),
    ]
  }

};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const scenarioArg = args.find(a => a.startsWith('--scenario='))
    ?.split('=')[1] || 'all';
  const delay = parseInt(
    args.find(a => a.startsWith('--delay='))?.split('=')[1] || '600'
  );

  const toRun = scenarioArg === 'all'
    ? Object.keys(SCENARIOS)
    : scenarioArg.split(',');

  const outFile = '/tmp/ctg-test-session.jsonl';
  fs.writeFileSync(outFile, '');

  console.log('CTG Test Runner');
  console.log('───────────────────────────────────────');
  console.log('In another terminal, run:');
  console.log(`  CTG_TRANSCRIPT_PATH=${outFile} ctg watch --no-history`);
  console.log('  or');
  console.log(`  CTG_TRANSCRIPT_PATH=${outFile} ctg dashboard`);
  console.log('───────────────────────────────────────');
  console.log('Starting in 3 seconds...\n');
  await sleep(3000);

  for (const key of toRun) {
    const s = SCENARIOS[key];
    if (!s) { console.log(`Unknown scenario: ${key}`); continue; }
    console.log(`\n▶ ${s.label}`);
    for (const line of s.lines) {
      fs.appendFileSync(outFile, line + '\n');
      console.log(`  wrote ${key} entry`);
      await sleep(delay);
    }
    await sleep(delay * 2);
  }

  console.log('\n✓ All scenarios complete.');
}

run();

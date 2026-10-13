import { writeResearchLunaResponse } from './research-luna-bridge.mjs';

const value = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestFile = value('request');
const contentFile = value('content');
const finishReason = value('finish-reason') ?? 'stop';
if (!requestFile || !contentFile) {
  console.error('Usage: node scripts/research-luna-response.mjs --request=/QA/artifacts/requests/ID.json --content=/QA/artifacts/raw-completions/ID.txt [--finish-reason=stop]');
  process.exitCode = 2;
} else {
  try {
    // The generated completion is treated as opaque UTF-8 text. The helper reads
    // only request identity/nonce, then atomically publishes that exact text.
    const result = writeResearchLunaResponse(requestFile, contentFile, { finishReason });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ error: String(error?.message ?? error).slice(0, 300) }));
    process.exitCode = 1;
  }
}

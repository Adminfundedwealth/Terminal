const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../server/index.js');
let content = fs.readFileSync(file, 'utf8');

// Find the section we need to replace
const marker1 = 'Connect Angel Feed (live market data)';
const marker2 = 'connectAngelFeed().catch(e => console.error("[connectAngelFeed] Fatal error:", e.message));';

const idx1 = content.indexOf(marker1);
const idx2 = content.indexOf(marker2);

if (idx1 === -1 || idx2 === -1) {
  console.log('Markers not found. idx1=' + idx1 + ' idx2=' + idx2);
  process.exit(1);
}

// Find the start of the comment line (go back to '//')
let lineStart = content.lastIndexOf('//', idx1);
// Include the spaces before
lineStart = content.lastIndexOf('\n', lineStart) + 1;

// Find the end of the connectAngelFeed line
let lineEnd = content.indexOf('\n', idx2) + 1;

const oldBlock = content.slice(lineStart, lineEnd);
console.log('FOUND BLOCK:\n' + JSON.stringify(oldBlock));

const newBlock = `    // 9. Connect Dhan WebSocket Feed (PRIMARY live market data) - fire and forget\r\n    connectDhanFeed().catch(e => console.error("[connectDhanFeed] Fatal error:", e.message));\r\n\r\n    // 9b. Connect Angel Feed (SECONDARY - broker adapter only, NOT live ticks)\r\n    connectAngelFeedForBroker().catch(e => console.error("[connectAngelFeedForBroker] Error:", e.message));\r\n`;

content = content.slice(0, lineStart) + newBlock + content.slice(lineEnd);
fs.writeFileSync(file, content);
console.log('DONE - replaced successfully');

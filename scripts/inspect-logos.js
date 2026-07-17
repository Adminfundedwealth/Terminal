const fs = require('fs');
const path = require('path');
const repoRoot = path.resolve(__dirname, '..');
const logosDir = path.join(repoRoot, 'public', 'logos');
const files = fs.readdirSync(logosDir).sort();
const report = files.map((file) => {
  const filePath = path.join(logosDir, file);
  const txt = fs.readFileSync(filePath, 'utf8');
  const placeholder = /<rect[^>]*width=['\"]?20['\"]?[^>]*height=['\"]?20['\"]?/.test(txt) && /<text/i.test(txt);
  const actual = !placeholder;
  return {
    file,
    size: fs.statSync(filePath).size,
    placeholder,
    firstLine: txt.split('\n')[0].slice(0, 120),
  };
});
console.log(JSON.stringify(report, null, 2));

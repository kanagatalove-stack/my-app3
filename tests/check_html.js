const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, ok = true;
while ((m = re.exec(html)) !== null) {
  const code = m[1];
  if (!code.trim()) continue;
  if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue;
  i++;
  try {
    new Function(code);
  } catch (e) {
    ok = false;
    console.error(`script block #${i} ERROR: ${e.message}`);
  }
}
console.log(ok ? `checked ${i} inline script block(s); ALL OK` : `FAILED`);
process.exit(ok ? 0 : 1);

const fs = require('fs');
const path = require('path');

const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));

const newTags = `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=2">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=2">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2">`;

let updated = [];

for (const file of htmlFiles) {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  // Remove old icon + apple-touch-icon combo (with or without apple-touch-icon line)
  content = content.replace(
    /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">\s*\n\s*<link rel="apple-touch-icon" sizes="180x180" href="\/favicon\.svg">/g,
    newTags
  );
  // Remove standalone icon tag (if not already replaced)
  content = content.replace(
    /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/g,
    newTags
  );
  // Update theme-color
  content = content.replace(/content="#0f1f3d"/g, 'content="#0d1b3e"');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    updated.push(file);
  }
}

console.log('Aktualisierte Dateien:', updated.join(', '));

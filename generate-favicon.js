const sharp = require('sharp');

const input = '../nur ODOJ im Logo.PNG';

async function generate() {
  await sharp(input).resize(32, 32).png().toFile('favicon-32x32.png');
  await sharp(input).resize(16, 16).png().toFile('favicon-16x16.png');
  await sharp(input).resize(180, 180).png().toFile('apple-touch-icon.png');
  await sharp(input).resize(192, 192).png().toFile('icon-192.png');
  console.log('Favicons erstellt');
}
generate();

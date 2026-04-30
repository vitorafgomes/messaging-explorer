const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../src/assets/icon.svg');
const assetsDir = path.join(__dirname, '../src/assets');

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);

  // Generate PNG icons in various sizes
  const sizes = [16, 32, 48, 64, 128, 256, 512];

  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(assetsDir, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }

  // Main icon (512x512)
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));
  console.log('Generated icon.png');

  // Tray icon (22x22 for Linux)
  await sharp(svgBuffer)
    .resize(22, 22)
    .png()
    .toFile(path.join(assetsDir, 'tray-icon.png'));
  console.log('Generated tray-icon.png');

  console.log('\nAll icons generated successfully!');
  console.log('\nNote: For Windows .ico and macOS .icns files,');
  console.log('use online converters or tools like:');
  console.log('- https://icoconvert.com/ (for .ico)');
  console.log('- https://iconverticons.com/ (for .icns)');
}

generateIcons().catch(console.error);

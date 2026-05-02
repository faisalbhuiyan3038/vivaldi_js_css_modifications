const fs = require('fs');
const path = require('path');

// Configuration - paste any Windows path inside the String.raw backticks
// String.raw prevents JS from interpreting backslashes as escape sequences
const BUNDLE_FILE_PATH = process.argv[2] || String.raw`C:\Users\islam\AppData\Local\Vivaldi\Application\7.9.3970.60\resources\vivaldi\bundle.js`;
const SEARCH_PATTERN = /const\s+\w+\s*=\s*180\s*[;,]/;
const REPLACE_PATTERN = (match) => match.replace('180', '300');

// Main function
function updateBundle() {
  try {
    const filePath = path.resolve(BUNDLE_FILE_PATH);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ Error: File not found at ${filePath}`);
      process.exit(1);
    }

    console.log(`📖 Reading file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf-8');

    const matches = content.match(SEARCH_PATTERN);
    if (!matches) {
      console.warn('⚠️  No const declarations with value 180 found.');
      process.exit(0);
    }

    const updatedContent = content.replace(SEARCH_PATTERN, REPLACE_PATTERN);

    if (updatedContent === content) {
      console.warn('⚠️  No changes were made.');
      process.exit(0);
    }

    fs.writeFileSync(filePath, updatedContent, 'utf-8');
    console.log(`✅ Successfully updated: 180 → 300`);
    console.log(`📁 File saved: ${filePath}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

updateBundle();

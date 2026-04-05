const fs = require('fs');
const path = require('path');

// Configuration - easily changeable
const BUNDLE_FILE_PATH = process.argv[2] || './bundle.js';
const SEARCH_PATTERN = /const\s+\w+\s*=\s*180\s*[;,]/;
const REPLACE_PATTERN = (match) => match.replace('180', '300');

// Main function
function updateBundle() {
  try {
    // Resolve the file path
    const filePath = path.resolve(BUNDLE_FILE_PATH);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Error: File not found at ${filePath}`);
      process.exit(1);
    }

    // Read the file
    console.log(`📖 Reading file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Find matches
    const matches = content.match(SEARCH_PATTERN);
    if (!matches) {
      console.warn('⚠️  No const declarations with value 180 found.');
      process.exit(0);
    }

    // Replace only the first match (const declaration)
    const updatedContent = content.replace(SEARCH_PATTERN, REPLACE_PATTERN);

    // Verify change was made
    if (updatedContent === content) {
      console.warn('⚠️  No changes were made.');
      process.exit(0);
    }

    // Write back to file
    fs.writeFileSync(filePath, updatedContent, 'utf-8');
    console.log(`✅ Successfully updated: 180 → 300`);
    console.log(`📁 File saved: ${filePath}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
updateBundle();

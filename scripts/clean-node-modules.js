const fs = require('fs');
const path = require('path');

/**
 * Removes leftover development tsconfig.json files shipped inside third-party
 * npm packages (such as hasown, call-bind-apply-helpers, etc.) that reference
 * unpublished devDependencies like "@ljharb/tsconfig" and trigger IDE errors.
 */
function cleanNodeModulesTsconfigs(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanNodeModulesTsconfigs(fullPath);
    } else if (/^tsconfig(\..+)?\.json$/i.test(entry.name)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore permission or race errors
      }
    }
  }
}

cleanNodeModulesTsconfigs(path.join(__dirname, '..', 'node_modules'));

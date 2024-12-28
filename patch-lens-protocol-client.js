const fs = require('fs');
const path = require('path');

// Helper function to patch a file
const patchFile = (filePath, replacements) => {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: File not found at ${fullPath}`);
    process.exit(1);
  }

  // Read the file content
  let fileContent = fs.readFileSync(fullPath, 'utf8');

  // Apply each replacement
  replacements.forEach(({ searchValue, replaceValue }) => {
    if (fileContent.includes(replaceValue)) {
      console.log(`Already patched: ${fullPath}`);
      return;
    }
    fileContent = fileContent.replace(searchValue, replaceValue);
  });

  // Write the updated content back to the file
  fs.writeFileSync(fullPath, fileContent, 'utf8');
  console.log(`Patched file successfully: ${fullPath}`);
};

// Main function to handle all patches
const main = () => {
  const patches = [
    // Patch for @lens-protocol/client/dist/index.js
    {
      filePath: './node_modules/@lens-protocol/client/dist/index.js',
      replacements: [
        {
          searchValue: /import\s*\{\s*ResultAwareError,\s*okAsync,\s*ResultAsync,\s*errAsync,\s*signatureFrom,\s*err,\s*ok,\s*never,\s*invariant\s*\}\s*from\s*'@lens-protocol\/types';/g,
          replaceValue: `import { ResultAwareError, okAsync, ResultAsync, errAsync, signatureFrom, err, ok, never, invariant } from '@lens-protocol/types/dist/index';`,
        },
        {
          searchValue: /export\s*\*\s*from\s*'@lens-protocol\/types';/g,
          replaceValue: `export * from '@lens-protocol/types/dist/index';`,
        },
        {
          searchValue: /import\s*\{\s*getLogger\s*\}\s*from\s*'loglevel';/g,
          replaceValue: `
import Module from "node:module";

const require = Module.createRequire(import.meta.url);
const { getLogger } = require('loglevel');`,
        },
      ],
    },

    // Patch for @lens-protocol/env/dist/index.js
    {
      filePath: './node_modules/@lens-protocol/env/dist/index.js',
      replacements: [
        {
          searchValue: /import\s*\{\s*url\s+as\s+n,\s*never\s+as\s*e\s*\}\s*from\s*["@']@lens-protocol\/types["@'];/g,
          replaceValue: `import{url as n,never as e}from"@lens-protocol/types/dist/index";`,
        },
      ],
    },

    // Patch for @lens-protocol/storage/dist/index.js
    {
      filePath: './node_modules/@lens-protocol/storage/dist/index.js',
      replacements: [
        {
          searchValue: /import\s*\{\s*assertError\s+as\s+d,\s*invariant\s+as\s+I\s*\}\s*from\s*["@']@lens-protocol\/types["@'];/g,
          replaceValue: `import{assertError as d,invariant as I}from"@lens-protocol/types/dist/index";`,
        },
        {
          searchValue: /import\s*\{\s*accessToken\s+as\s+h,\s*idToken\s+as\s+l,\s*refreshToken\s+as\s+v\s*\}\s*from\s*["@']@lens-protocol\/types["@'];/g,
          replaceValue: `import{accessToken as h,idToken as l,refreshToken as v}from"@lens-protocol/types/dist/index";`,
        },
      ],
    },
    // Patch for @lens-protocol/graph/dist/index.js
    {
        filePath: './node_modules/@lens-protocol/graphql/dist/index.js',
        replacements: [
          {
            searchValue: /import\s*\{\s*InvariantError\s*\}\s*from\s*["@']@lens-protocol\/types["@'];/g,
            replaceValue: `import {InvariantError}from'@lens-protocol/types/dist/index';`,
          },
        ],
      },
  ];

  // Apply patches
  patches.forEach(({ filePath, replacements }) => {
    patchFile(filePath, replacements);
  });
};

// Run the script
main();

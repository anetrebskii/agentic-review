#!/bin/bash

# Install dependencies
npm install

# Install missing type definitions
npm install --save-dev @types/js-yaml @types/minimatch

# Build the project
npm run build 
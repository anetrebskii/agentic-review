import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as yaml from 'js-yaml';
import { defaultConfig, CodeReviewConfig } from '../config/default-config';

/**
 * Loads and merges the configuration from the config file.
 * If the file doesn't exist, it returns the default config.
 */
export async function loadConfig(): Promise<CodeReviewConfig> {
  try {
    const configPath = 'agentic-review.yml';
    
    // Check if the file exists
    if (!fs.existsSync(configPath)) {
      core.info(`Config file not found at ${configPath}, using default configuration.`);
      return {
        ...defaultConfig
      };
    }

    // Read and parse the YAML file
    const configContent = fs.readFileSync(configPath, 'utf8');
    const userConfig = yaml.load(configContent) as Partial<CodeReviewConfig>;

    // Merge with default config
    const mergedConfig: CodeReviewConfig = {
      ...defaultConfig,
      ...userConfig,
      // Ensure rules from both configurations are merged properly
      rules: [
        ...(userConfig.rules || []),
        // Include default rules that don't overlap with user rules
        ...(defaultConfig.rules.filter(defaultRule => 
          !(userConfig.rules || []).some(userRule => 
            JSON.stringify(userRule.include.sort()) === JSON.stringify(defaultRule.include.sort())
          )
        ))
      ],
      // Include all exclude filters from both configs and clean patterns
      excludeFiles: [
        ...(userConfig.excludeFiles || []).map(pattern => {
          // Clean pattern: trim whitespace and remove YAML list marker if present
          return typeof pattern === 'string' ? pattern.trim().replace(/^-\s*/, '') : pattern;
        }),
        ...defaultConfig.excludeFiles.filter(pattern => 
          !(userConfig.excludeFiles || []).includes(pattern)
        ).map(pattern => {
          // Clean pattern: trim whitespace and remove YAML list marker if present
          return typeof pattern === 'string' ? pattern.trim().replace(/^-\s*/, '') : pattern;
        })
      ]
    };

    return mergedConfig;
  } catch (error) {
    core.warning(`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`);
    return defaultConfig;
  }
} 
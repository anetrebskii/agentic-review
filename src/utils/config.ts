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
    const configPath = core.getInput('config-path') || '.github/code-review-config.yml';
    
    // Check if the file exists
    if (!fs.existsSync(configPath)) {
      core.info(`Config file not found at ${configPath}, using default configuration.`);
      return {
        ...defaultConfig,
        model: core.getInput('model') || defaultConfig.model,
        commentThreshold: parseInt(core.getInput('comment-threshold') || defaultConfig.commentThreshold.toString(), 10)
      };
    }

    // Read and parse the YAML file
    const configContent = fs.readFileSync(configPath, 'utf8');
    const userConfig = yaml.load(configContent) as Partial<CodeReviewConfig>;

    // Merge with default config
    const mergedConfig: CodeReviewConfig = {
      ...defaultConfig,
      ...userConfig,
      promptRules: {
        ...defaultConfig.promptRules,
        ...userConfig.promptRules
      },
      model: core.getInput('model') || userConfig.model || defaultConfig.model,
      commentThreshold: parseInt(
        core.getInput('comment-threshold') || 
        (userConfig.commentThreshold?.toString() || defaultConfig.commentThreshold.toString()), 
        10
      )
    };

    return mergedConfig;
  } catch (error) {
    core.warning(`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`);
    return defaultConfig;
  }
} 
import * as core from '@actions/core';
import OpenAI from 'openai';
import { CodeReviewConfig, ReviewRule } from '../config/default-config';
import { minimatch } from 'minimatch';
import { EnhancedPRFile, FileCodeReviewComment } from './github-service';

export class OpenAIService {
  private openai: OpenAI;
  private config: CodeReviewConfig;
  private model: string;
  private commentThreshold: number;
  private maxTokens: number;
  private temperature: number;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;

  constructor(config: CodeReviewConfig) {
    const apiKey = core.getInput('openai-api-key');
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.openai = new OpenAI({
      apiKey: apiKey
    });
    this.config = config;
    
    // Set default values
    this.model = 'gpt-4.1-mini';
    this.commentThreshold = 50;
    this.maxTokens = 30096;
    this.temperature = 0.7;
    
    // Check if config has model properties and use them
    this.migrateLegacyConfig(config);
  }
  
  /**
   * Migrates legacy configuration if present
   * @param config The configuration object
   */
  private migrateLegacyConfig(config: any): void {
    // Check if the config has model properties
    if ('model' in config && typeof config.model === 'string') {
      this.model = config.model;
    }
    
    if ('commentThreshold' in config && typeof config.commentThreshold === 'number') {
      this.commentThreshold = config.commentThreshold;
    }
    
    if ('maxTokens' in config && typeof config.maxTokens === 'number') {
      this.maxTokens = config.maxTokens;
    }
    
    if ('temperature' in config && typeof config.temperature === 'number') {
      this.temperature = config.temperature;
    }
    
    // Check for legacy promptRules
    if ('promptRules' in config && typeof config.promptRules === 'object') {
      core.warning('Detected legacy promptRules configuration. Please update your config file to use the new rules format.');
    }
  }

  /**
   * Get the comment threshold for filtering comments
   */
  getCommentThreshold(): number {
    return this.commentThreshold;
  }

  /**
   * Find the appropriate review rule for a file
   * @param filename The filename to match against rules
   * @returns The matched rule or undefined if no rule matches
   */
  private findMatchingRules(filename: string): ReviewRule[] {
    return this.config.rules.filter(rule => {
      return rule.include.some(pattern => minimatch(filename, pattern));
    });
  }

  /**
   * Get the number of tokens used for input (prompts)
   */
  getInputTokenCount(): number {
    return this.totalInputTokens;
  }

  /**
   * Get the number of tokens used for output (AI responses)
   */
  getOutputTokenCount(): number {
    return this.totalOutputTokens;
  }

  /**
   * Analyzes code changes using the OpenAI API with context
   * @param file The enhanced PR file with changes and context
   * @returns Analysis results from the AI as JSON string
   */
  async analyzeCodeChanges(file: EnhancedPRFile): Promise<FileCodeReviewComment[]> {
    try {
      // Find the matching rule for this file
      const matchingRules = this.findMatchingRules(file.filename);
      
      const systemPrompt = `
      You are a senior developer with deep expertise in software architecture and business logic implementation who are reviewing a pull request for a software project. 
      Provide comments only for real issues in CHANGED lines of code.
      The comment is written should contain the real issues in the code.
      For each issue, include the exact line number where the issue occurs in the startLine and endLine fields.      
      Make the comment field markdown formatted and include a one-sentence suggested fix.
      The comment should contain suggested fixes in GitHub flavored markdown format if it's possible.
      
      Your output must be a valid JSON string in the following format:
      {
        "comments": [
          {
            "startLine": number,
            "endLine": number,
            "comment": "Markdown formatted comment with your review"
          }
        ]
      }
      
      IMPORTANT: Return ONLY the raw JSON with no markdown formatting, no code blocks, and no backticks.
      `;
      
      let userPrompt = '';
      if (matchingRules.length > 0) {
        userPrompt += `${matchingRules.map(rule => rule.prompt).join('\n\n')}\n\n`;
      }
      
      // Add the changed content focus
      userPrompt += `FOCUS ON THESE SPECIFIC CHANGES in file ${file.filename}:\n\n`;
      userPrompt += file.changedContent ? `\`\`\`\n${file.changedContent}\n\`\`\`\n\n` : 
                   (file.patch ? `\`\`\`\n${file.patch}\n\`\`\`\n\n` : '');
      
      // Add the full file context
      if (file.fullContent) {
        userPrompt += `FULL FILE CONTEXT (for reference only, focus your review on the changes above):\n\n`;
        userPrompt += `\`\`\`\n${file.fullContent}\n\`\`\`\n\n`;
      }
      
      core.debug(`Using model: ${this.model}`);
      core.debug(`Using rule prompt for file type: ${file.filename}`);
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      // Track token usage
      if (response.usage) {
        this.totalInputTokens += response.usage.prompt_tokens;
        this.totalOutputTokens += response.usage.completion_tokens;
        core.debug(`Token usage for ${file.filename}: ${response.usage.prompt_tokens} input, ${response.usage.completion_tokens} output`);
      }

      if (!response.choices[0]?.message.content) {
        core.warning('No content received from OpenAI API');
        return [];
      }

      try {
        // Clean up the response content to ensure it's valid JSON
        let responseContent = response.choices[0].message.content || '';
        
        // Remove markdown code block formatting if present
        responseContent = responseContent.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
        
        // Attempt to parse the response as JSON
        const parsedResponse = JSON.parse(responseContent);
        
        // Validate the response structure
        if (!parsedResponse || typeof parsedResponse !== 'object' || !Array.isArray(parsedResponse.comments)) {
          core.warning('Invalid response structure from OpenAI API');
          return [];
        }

        // Validate each comment
        const validComments = parsedResponse.comments.filter((comment: FileCodeReviewComment) => {
          return comment && 
                 typeof comment.startLine === 'number' && 
                 typeof comment.endLine === 'number' && 
                 typeof comment.comment === 'string';
        });

        // Return the validated response
        return validComments;
      } catch (error) {
        core.warning(`Failed to parse OpenAI API response: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    } catch (error) {
      core.error(`Error calling OpenAI API: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 
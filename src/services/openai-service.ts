import * as core from '@actions/core';
import OpenAI from 'openai';
import { CodeReviewConfig, ReviewRule } from '../config/default-config';
import { minimatch } from 'minimatch';
import { EnhancedPRFile } from './github-service';

export class OpenAIService {
  private openai: OpenAI;
  private config: CodeReviewConfig;
  private model: string;
  private commentThreshold: number;
  private maxTokens: number;
  private temperature: number;

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
    this.model = 'gpt-4-turbo';
    this.commentThreshold = 50;
    this.maxTokens = 4096;
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
  private findMatchingRule(filename: string): ReviewRule | undefined {
    return this.config.rules.find(rule => {
      return rule.include.some(pattern => minimatch(filename, pattern));
    });
  }

  /**
   * Analyzes code changes using the OpenAI API with context
   * @param file The enhanced PR file with changes and context
   * @param additionalPrompts Additional prompts to include in the analysis
   * @returns Analysis results from the AI
   */
  async analyzeCodeChanges(file: EnhancedPRFile, additionalPrompts?: string): Promise<string> {
    try {
      // Find the matching rule for this file
      const matchingRule = this.findMatchingRule(file.filename);
      
      if (!matchingRule && !additionalPrompts) {
        core.warning(`No matching review rule found for ${file.filename}. Using generic prompt.`);
        return this.analyzeWithGenericPrompt(file);
      }

      const systemPrompt = `
      You are a senior developer with deep expertise in software architecture and business logic implementation who are reviewing a pull request for a software project. 
      Provide comments only for issues in CHANGED lines of code.
      For each issue, you MUST specify the exact line number using format "Line X: [your comment]".       
      The changed content includes line numbers at the beginning of each line (e.g. "42: const x = 5;").      
      For each issue, use this severity format:
      '🔴 **High**: for critical issues, bugs, security concerns, or significant business logic flaws ' +
      '🟠 **Medium**: for code quality issues, potential edge cases, or architectural concerns ' +
      '🟡 **Low**: for minor improvements or optimization suggestions ' +
      'After the severity, provide a suggested fix that demonstrates senior-level problem-solving.';
      `;
      
      let userPrompt = '';
      if (matchingRule) {
        userPrompt += `${matchingRule.prompt}\n\n`;
      }
      if (additionalPrompts) {
        userPrompt += `${additionalPrompts}\n\n`;
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

      return response.choices[0]?.message.content || 'No feedback provided.';
    } catch (error) {
      core.error(`Error calling OpenAI API: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Analyzes with a generic prompt when no specific rule matches
   * @param file The enhanced PR file
   * @returns Analysis results from the AI
   */
  private async analyzeWithGenericPrompt(file: EnhancedPRFile): Promise<string> {
    const systemPrompt = 'You are a senior developer with deep expertise in software architecture and business logic implementation. ' +
      'Focus specifically on the changes in this pull request, evaluating both implementation details and broader architectural implications. ' +
      'IMPORTANT: Only provide feedback for issues in CHANGED lines of code. Do not comment on unchanged code. ' +
      'Only provide feedback for issues where you can identify the EXACT line number. ' +
      'For each issue, you MUST specify the exact line number using format "Line X: [your comment]". ' +
      'The line number must correspond precisely to the line in the diff where the issue exists. ' +
      'The changed content includes line numbers at the beginning of each line (e.g. "42: const x = 5;"). ' +
      'Use EXACTLY these line numbers in your comments - do not modify or calculate them yourself. ' + 
      'It\'s critical that you identify the precise line number where each issue occurs. ' +
      'Only comment on lines that have been added or modified in this PR. ' +
      'Even if an issue spans multiple lines, choose the most relevant single line number to reference. ' +
      'Your review will be used to create GitHub comments at the specified positions. ' +
      'Prioritize business logic issues, edge cases, potential bugs, and architectural concerns over stylistic issues. ' +
      'Consider how changes might affect performance, scalability, maintainability, and error handling. ' +
      'Be concise but insightful in your feedback, focusing on meaningful improvements. ' +
      'For each issue, use this severity format: ' +
      '🔴 **High**: for critical issues, bugs, security concerns, or significant business logic flaws ' +
      '🟠 **Medium**: for code quality issues, potential edge cases, or architectural concerns ' +
      '🟡 **Low**: for minor improvements or optimization suggestions ' +
      'After the severity, provide a one-sentence suggested fix that demonstrates senior-level problem-solving.';
    
    let userPrompt = `Please review the following code changes in file ${file.filename}:\n\n`;
    
    // Add the changed content focus
    userPrompt += `FOCUS ON THESE SPECIFIC CHANGES:\n\n`;
    userPrompt += file.changedContent ? `\`\`\`\n${file.changedContent}\n\`\`\`\n\n` : 
                 (file.patch ? `\`\`\`\n${file.patch}\n\`\`\`\n\n` : '');
    
    // Add the full file context
    if (file.fullContent) {
      userPrompt += `FULL FILE CONTEXT (for reference only, focus your review on the changes above):\n\n`;
      userPrompt += `\`\`\`\n${file.fullContent}\n\`\`\`\n\n`;
    }
    
    userPrompt += 'Provide only concise, one-sentence feedback for each issue. ' +
      'Format each issue as "Line X: [severity emoji + level] [issue description] - [fix suggestion]". ' +
      'For severity, use: ' +
      '🔴 **High** for critical issues or bugs, ' +
      '🟠 **Medium** for code quality issues, ' +
      '🟡 **Low** for style or minor improvements. ' +
      'ONLY comment on lines that have been CHANGED or ADDED in this PR. ' +
      'Use EXACTLY the line numbers shown at the beginning of each line in the changed content. ' +
      'ONLY include comments where you can identify the exact line number. ' +
      'If you cannot determine the exact line, or if the line was not changed, do not include that comment. ' +
      'Ensure all issues have an exact line number reference. ' +
      'Use feature sentences only - no explanations or reasoning.';

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    });

    return response.choices[0]?.message.content || 'No feedback provided.';
  }

  /**
   * Makes follow-up inquiries for agentic review mode, focusing on changes
   * @param initialAnalysis Initial analysis from the AI
   * @param file The enhanced PR file
   * @param conversation Previous conversation history
   * @returns Follow-up analysis
   */
    async makeFollowUpInquiry(
    initialAnalysis: string, 
    file: EnhancedPRFile,
    conversation: Array<{ role: 'system' | 'user' | 'assistant', content: string }>
  ): Promise<string> {
    try {
      // Find the matching rule for this file
      const matchingRule = this.findMatchingRule(file.filename);
      
      const systemPrompt = 'You are a senior developer with deep expertise in software architecture and business logic implementation. ' +
        'Focus specifically on the changes in this pull request, evaluating both implementation details and broader architectural implications. ' +
        'IMPORTANT: Only provide feedback for issues in CHANGED lines of code. Do not comment on unchanged code. ' +
        'Only provide feedback for issues where you can identify the EXACT line number. ' +
        'For each issue, you MUST specify the exact line number using format "Line X: [your comment]". ' +
        'The line number must correspond precisely to the line in the diff where the issue exists. ' +
        'The changed content includes line numbers at the beginning of each line (e.g. "42: const x = 5;"). ' +
        'Use EXACTLY these line numbers in your comments - do not modify or calculate them yourself. ' + 
        'It\'s critical that you identify the precise line number where each issue occurs. ' +
        'Only comment on lines that have been added or modified in this PR. ' +
        'Even if an issue spans multiple lines, choose the most relevant single line number to reference. ' +
        'Your review will be used to create GitHub comments at the specified positions. ' +
        'Prioritize business logic issues, edge cases, potential bugs, and architectural concerns over stylistic issues. ' +
        'Consider how changes might affect performance, scalability, maintainability, and error handling. ' +
        'Be concise but insightful in your feedback, focusing on meaningful improvements. ' +
        'For each issue, use this severity format: ' +
        '🔴 **High**: for critical issues, bugs, security concerns, or significant business logic flaws ' +
        '🟠 **Medium**: for code quality issues, potential edge cases, or architectural concerns ' +
        '🟡 **Low**: for minor improvements or optimization suggestions ' +
        'After the severity, provide a one-sentence suggested fix that demonstrates senior-level problem-solving.';

      // Build the conversation history
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...conversation,
        { 
          role: 'user' as const, 
          content: matchingRule 
            ? `Based on your initial analysis of the changes to ${file.filename} and the specific review focus (${matchingRule.prompt.substring(0, 100)}...), provide only concise, one-sentence feedback for any additional issues. Use feature sentences only.` 
            : `Based on your initial analysis of the changes to ${file.filename}, provide only concise, one-sentence feedback for any additional issues. Use feature sentences only.` 
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      return response.choices[0]?.message.content || 'No further inquiries.';
    } catch (error) {
      core.error(`Error making follow-up inquiry: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Keep the old methods for backward compatibility until we fully update all code
  async analyzeCode(codeChanges: string, filename: string, context?: string): Promise<string> {
    core.warning('analyzeCode method is deprecated, use analyzeCodeChanges instead');
    
    const mockFile: EnhancedPRFile = {
      filename: filename,
      status: 'modified',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: codeChanges,
      blob_url: '',
      raw_url: '',
      contents_url: '',
      fullContent: context
    };
    
    return this.analyzeCodeChanges(mockFile);
  }
} 
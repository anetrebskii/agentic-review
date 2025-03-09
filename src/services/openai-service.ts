import * as core from '@actions/core';
import OpenAI from 'openai';
import { CodeReviewConfig, ReviewRule } from '../config/default-config';
import { minimatch } from 'minimatch';

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
    
    // Use inputs from GitHub Action or default values
    this.model = core.getInput('model') || 'gpt-4-turbo';
    this.commentThreshold = parseInt(core.getInput('comment-threshold') || '50', 10);
    this.maxTokens = 4096;
    this.temperature = 0.7;
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
   * Analyzes code changes using the OpenAI API
   * @param codeChanges The code changes to analyze
   * @param filename The filename being analyzed
   * @param context Additional context about the changes
   * @returns Analysis results from the AI
   */
  async analyzeCode(codeChanges: string, filename: string, context?: string): Promise<string> {
    try {
      // Find the matching rule for this file
      const matchingRule = this.findMatchingRule(filename);
      
      if (!matchingRule) {
        core.warning(`No matching review rule found for ${filename}. Using generic prompt.`);
        return this.analyzeCodeWithGenericPrompt(codeChanges, context);
      }

      const systemPrompt = 'You are an expert code reviewer with extensive experience in software development. ' +
        'Analyze the code changes and provide constructive feedback. ' +
        'Be specific and actionable in your feedback, explaining why a change is recommended. ' +
        'For each issue, rate its severity (low, medium, high) and provide a suggested fix if possible.';
      
      const userPrompt = `${matchingRule.prompt}\n\nHere is the code to review:\n\n${codeChanges}` + 
        (context ? `\n\nAdditional context:\n${context}` : '') + 
        '\n\nPlease provide specific, actionable feedback with reasoning. For each issue, include a severity rating and a suggested fix if possible.';

      core.debug(`Using model: ${this.model}`);
      core.debug(`Using rule prompt for file type: ${filename}`);
      
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
   * Analyzes code with a generic prompt when no specific rule matches
   * @param codeChanges The code changes to analyze
   * @param context Additional context about the changes
   * @returns Analysis results from the AI
   */
  private async analyzeCodeWithGenericPrompt(codeChanges: string, context?: string): Promise<string> {
    const systemPrompt = 'You are an expert code reviewer with extensive experience in software development. ' +
      'Analyze the code changes and provide constructive feedback. ' +
      'Focus on code quality, potential bugs, security issues, performance concerns, and best practices. ' +
      'Be specific and actionable in your feedback, explaining why a change is recommended. ' +
      'For each issue, rate its severity (low, medium, high) and provide a suggested fix if possible.';
    
    const userPrompt = `Please review the following code changes:\n\n${codeChanges}` +
      (context ? `\n\nAdditional context:\n${context}` : '') +
      '\n\nProvide specific, actionable feedback with reasoning. For each issue, include a severity rating and a suggested fix if possible.';

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
   * Makes follow-up inquiries for agentic review mode
   * @param initialAnalysis Initial analysis from the AI
   * @param codeChanges The code changes to analyze
   * @param filename The filename being analyzed
   * @param conversation Previous conversation history
   * @returns Follow-up analysis
   */
  async makeFollowUpInquiry(
    initialAnalysis: string, 
    codeChanges: string,
    filename: string,
    conversation: Array<{ role: 'system' | 'user' | 'assistant', content: string }>
  ): Promise<string> {
    try {
      // Find the matching rule for this file
      const matchingRule = this.findMatchingRule(filename);
      
      const systemPrompt = 'You are an expert code reviewer with extensive experience in software development. ' +
        'Analyze the code changes and provide constructive feedback. ' +
        'Be specific and actionable in your feedback, explaining why a change is recommended.';

      // Build the conversation history
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...conversation,
        { 
          role: 'user' as const, 
          content: matchingRule 
            ? `Based on your initial analysis and the specific review focus for ${filename} (${matchingRule.prompt.substring(0, 100)}...), do you need any clarification or would you like to examine any specific part of the code more deeply?` 
            : 'Based on your initial analysis, do you need any clarification or would you like to examine any specific part of the code more deeply?' 
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
} 
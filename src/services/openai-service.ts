import * as core from '@actions/core';
import OpenAI from 'openai';
import { CodeReviewConfig } from '../config/default-config';

export class OpenAIService {
  private openai: OpenAI;
  private config: CodeReviewConfig;

  constructor(config: CodeReviewConfig) {
    const apiKey = core.getInput('openai-api-key');
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.openai = new OpenAI({
      apiKey: apiKey
    });
    this.config = config;
  }

  /**
   * Analyzes code changes using the OpenAI API
   * @param codeChanges The code changes to analyze
   * @param context Additional context about the changes
   * @returns Analysis results from the AI
   */
  async analyzeCode(codeChanges: string, context?: string): Promise<string> {
    try {
      const systemPrompt = this.config.promptRules.systemPrompt;
      const userPrompt = this.config.promptRules.userPrompt
        .replace('{code}', codeChanges)
        .replace('{context}', context || '');

      core.debug(`Using model: ${this.config.model}`);
      core.debug(`System prompt: ${systemPrompt}`);
      
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      return response.choices[0]?.message.content || 'No feedback provided.';
    } catch (error) {
      core.error(`Error calling OpenAI API: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Makes follow-up inquiries for agentic review mode
   * @param initialAnalysis Initial analysis from the AI
   * @param codeChanges The code changes to analyze
   * @param conversation Previous conversation history
   * @returns Follow-up analysis
   */
  async makeFollowUpInquiry(
    initialAnalysis: string, 
    codeChanges: string, 
    conversation: Array<{ role: 'system' | 'user' | 'assistant', content: string }>
  ): Promise<string> {
    try {
      // Build the conversation history
      const messages = [
        { role: 'system' as const, content: this.config.promptRules.systemPrompt },
        ...conversation,
        { 
          role: 'user' as const, 
          content: 'Based on your initial analysis, do you need any clarification or would you like to examine any specific part of the code more deeply?' 
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      return response.choices[0]?.message.content || 'No further inquiries.';
    } catch (error) {
      core.error(`Error making follow-up inquiry: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 
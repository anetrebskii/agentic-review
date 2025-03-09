export interface CodeReviewConfig {
  includeFiles: string[];
  excludeFiles: string[];
  promptRules: {
    systemPrompt: string;
    userPrompt: string;
  };
  model: string;
  commentThreshold: number;
  maxTokens: number;
  temperature: number;
}

export const defaultConfig: CodeReviewConfig = {
  includeFiles: ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx', '**/*.py', '**/*.go', '**/*.java', '**/*.rb'],
  excludeFiles: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts'],
  promptRules: {
    systemPrompt: 'You are an expert code reviewer. Analyze the following code changes and provide constructive feedback. Focus on code quality, potential bugs, security issues, and performance concerns.',
    userPrompt: 'Please review the following code changes:\n\n{code}\n\nProvide specific, actionable feedback with reasoning.'
  },
  model: 'gpt-4-turbo',
  commentThreshold: 50,
  maxTokens: 4096,
  temperature: 0.7
}; 
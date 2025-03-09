export interface ReviewRule {
  include: string[];
  prompt: string;
}

export interface CodeReviewConfig {
  excludeFiles: string[];
  rules: ReviewRule[];
}

export const defaultConfig: CodeReviewConfig = {
  excludeFiles: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts', '**/*.min.js'],
  rules: [
    {
      include: ['**/*.ts', '**/*.tsx'],
      prompt: 'Review this TypeScript code focusing on type safety, proper interface usage, and adherence to TypeScript best practices. Look for potential null/undefined issues, incorrect typing, and opportunities to improve type definitions.'
    },
    {
      include: ['**/*.js', '**/*.jsx'],
      prompt: 'Review this JavaScript code focusing on potential runtime errors, variable scope issues, and modern JavaScript practices. Check for proper error handling, async/await usage, and potential memory leaks.'
    },
    {
      include: ['**/*.py'],
      prompt: 'Review this Python code focusing on PEP 8 compliance, proper exception handling, and Pythonic approaches. Check for inefficient algorithms, unnecessary complexity, and security vulnerabilities like SQL injection or unsafe eval.'
    }
  ]
}; 
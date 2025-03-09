# AI Code Review GitHub Action

A GitHub Action for AI-assisted code reviews using ChatGPT or other AI models. This action leverages the OpenAI API to analyze code changes in pull requests and provide constructive feedback.

## Features

- **ChatGPT Integration**: Use ChatGPT to review your code through the OpenAI API
- **Configurable Settings**: Customize file filters and review prompts via configuration file
- **Agentic Review Mode**: AI makes multiple calls to thoroughly assess the code
- **Pull Request Integration**: Updates PR status and adds review comments automatically

## Usage

Add the following to your GitHub Actions workflow file (e.g., `.github/workflows/code-review.yml`):

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  code-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: AI Code Review
        uses: your-github-username/code-review-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # Optional parameters:
          # config-path: '.github/code-review-config.yml'
          # model: 'gpt-4-turbo'
          # comment-threshold: '50'
```

## Configuration

Create a configuration file at `.github/code-review-config.yml` (or specify a custom path using the `config-path` parameter):

```yaml
# Files to include in the review (glob patterns)
includeFiles:
  - '**/*.ts'
  - '**/*.js'
  # Add more patterns as needed

# Files to exclude from the review (glob patterns)
excludeFiles:
  - '**/node_modules/**'
  - '**/dist/**'
  # Add more patterns as needed

# AI prompt rules
promptRules:
  systemPrompt: "You are an expert code reviewer..."
  userPrompt: "Please review the following code changes: {code}"

# Model configuration
model: 'gpt-4-turbo'
commentThreshold: 50
maxTokens: 4096
temperature: 0.7
```

A sample configuration file is provided in the repository (`sample-config.yml`).

## Development

### Prerequisites

- Node.js (v18 or later)
- npm or yarn

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Install required type definitions:
   ```bash
   npm install --save-dev @types/js-yaml @types/minimatch
   ```
4. Build the project:
   ```bash
   npm run build
   ```

Alternatively, use the provided setup script:
```bash
chmod +x setup.sh
./setup.sh
```

### Troubleshooting TypeScript Errors

If you encounter TypeScript errors related to missing type declarations:

1. **js-yaml type errors**: Make sure you have installed `@types/js-yaml`:
   ```bash
   npm install --save-dev @types/js-yaml
   ```

2. **minimatch type errors**: Ensure you have installed `@types/minimatch` and are importing it correctly:
   ```bash
   npm install --save-dev @types/minimatch
   ```
   
   In your code, use: `import { minimatch } from 'minimatch';`

3. **Octokit type errors**: The project includes custom type declarations in `src/types/github.d.ts` to fix compatibility issues between `@actions/github` and `@octokit/rest`. If you're still experiencing errors, check this file and the `typeRoots` setting in `tsconfig.json`.

### Testing Locally

To test the action locally, you can use tools like [act](https://github.com/nektos/act):

```bash
act pull_request -s OPENAI_API_KEY=your-api-key
```

## Security Considerations

- Store your OpenAI API key as a GitHub secret
- Be cautious about what code you send to the OpenAI API
- Consider privacy implications when reviewing sensitive code

## License

MIT
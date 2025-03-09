# AI Code Review GitHub Action

A GitHub Action for AI-assisted code reviews using ChatGPT or other AI models. This action leverages the OpenAI API to analyze code changes in pull requests and provide constructive feedback.

## Features

- **ChatGPT Integration**: Use ChatGPT to review your code through the OpenAI API
- **Focus on Changes**: Reviews only the changed code in PRs while providing full file context for better analysis
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
    permissions:
      contents: read
      pull-requests: write
      checks: write
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
# AI Code Review Configuration
# This action reviews only the code changes in pull requests,
# but also provides file context for better analysis

# Global excludes - These files will always be excluded
excludeFiles:
  - '**/node_modules/**'
  - '**/dist/**'
  - '**/*.test.ts'
  # Add more patterns as needed

# Review rules - Each rule specifies what files to include and what to look for
rules:
  - include:
      - '**/*.ts'
      - '**/*.tsx'
    prompt: >
      Review these TypeScript code CHANGES focusing on type safety, proper interface usage, 
      and adherence to TypeScript best practices.

  - include:
      - '**/*.js'
      - '**/*.jsx'
    prompt: >
      Review these JavaScript code CHANGES focusing on potential runtime errors,
      variable scope issues, and modern JavaScript practices.

  # Add more rules for different file types
```

Each rule in the configuration defines:
1. **include**: An array of glob patterns that match files this rule applies to
2. **prompt**: Specific instructions for reviewing changes to this type of file

The action will automatically match files against these rules and use the appropriate prompt for each file type, providing specialized review feedback based on the language or technology. By focusing specifically on code changes (rather than entire files), the reviews are more relevant and actionable.

You can configure the model settings using the GitHub Action inputs:
- `model`: OpenAI model to use (default: gpt-4-turbo)
- `comment-threshold`: Minimum confidence threshold for posting comments (default: 50)

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

The build process uses @vercel/ncc to bundle all dependencies into a single file, which is required for GitHub Actions to work properly.

Alternatively, use the provided setup script:
```bash
chmod +x setup.sh
./setup.sh
```
### Building for Distribution

The project uses @vercel/ncc to bundle all dependencies into a single file. This is important because GitHub Actions don't install dependencies when they run in another repository.

The build process:
1. Compiles TypeScript to JavaScript into the `lib` directory
2. Uses ncc to bundle all code and dependencies into a single file in the `dist` directory

When committing changes to the repository, always make sure to run the build command to update the distribution files.

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

## Troubleshooting

### Error: "Cannot read properties of undefined (reading 'create')"

This error occurs when the GitHub token doesn't have the necessary permissions to create check runs. When using this action in a workflow, you need to explicitly set the required permissions in your workflow file:

```yaml
jobs:
  code-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      # ... your steps
```

The `checks: write` permission is essential for the action to create and update check runs. Without this permission, you'll encounter the "Cannot read properties of undefined (reading 'create')" error.

If you're using a custom GitHub token, make sure it has the necessary permissions to create check runs and comment on pull requests.

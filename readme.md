# AI Code Review GitHub Action

A GitHub Action for AI-assisted code reviews using ChatGPT or other AI models. This action leverages the OpenAI API to analyze code changes in pull requests and provide constructive feedback.

## Features

- **ChatGPT Integration**: Use ChatGPT to review your code through the OpenAI API
- **Focus on Changes**: Reviews only the changed code in PRs while providing full file context for better analysis
- **Line-Specific Comments**: Creates individual review comments directly on the relevant code lines
- **Incremental Reviews**: Only reviews code that has changed since the last review to avoid duplicate feedback
- **JSON Output Format**: Creates structured JSON with comments, file paths, and line numbers for programmatic processing
- **GitHub Action Output**: Provides review results as action output for further workflow automation
- **Configurable Settings**: Customize file filters and review prompts via configuration file
- **Agentic Review Mode**: AI makes multiple calls to thoroughly assess the code
- **Pull Request Integration**: Adds inline code review comments and updates PR status automatically
- **Token Usage Tracking**: Monitors and reports API token consumption for cost management and optimization
- **Summary Comment**: Adds a PR comment with total comments and token usage statistics

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
```

## Configuration

Create a configuration file at the root of your repository named `agentic-review.yml`:

```yaml
# AI Code Review Configuration
# This action reviews only the code changes in pull requests,
# but also provides file context for better analysis

# Global excludes - These files will always be excluded
excludeFiles:
  - '**/node_modules/**'
  - '**/dist/**'
  - '**/*.test.ts'
  - '**/*.yml'
  - '**/*.yaml'
  - '.github/**/*.yml'  # Specifically exclude GitHub workflow files
  # Add more patterns as needed

# AI model settings
model: 'gpt-4-turbo'
commentThreshold: 50
maxTokens: 4096
temperature: 0.7

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

> **Important Notes on excludeFiles**: 
> - Make sure each pattern in the `excludeFiles` array is a simple glob pattern string. Do not include YAML list markers or indentation as part of the pattern itself.
> - For files in hidden directories (starting with `.`), you may need to add specific patterns like `.github/**/*.yml` even if you already have `**/*.yml`.
> - Use patterns like `**/*.extension` to match all files with a specific extension.
> - For important directories, consider adding both a general pattern and specific ones to ensure proper matching.

You can configure the model settings directly in the config file:
- `model`: OpenAI model to use (default: gpt-4-turbo)
- `commentThreshold`: Minimum confidence threshold for posting comments (default: 50)
- `maxTokens`: Maximum tokens to use in API requests (default: 4096)
- `temperature`: Temperature setting for the AI model (default: 0.7)

A sample configuration file is provided in the repository (`sample-config.yml`).

## Incremental Code Reviews

This action implements incremental code reviews to avoid reviewing the same code changes multiple times:

- When the action runs, it looks for the most recent review comments from previous runs
- It checks the timestamp of the last review and only reviews files that have been modified since that time
- Files that haven't changed since the last review are automatically skipped
- This ensures that developers only receive feedback on new or modified code

Each review comment is timestamped to track when it was created. The action uses GitHub's API to:
1. Find the most recent AI Code Review comments
2. Compare the timestamp with the commit history of each file
3. Only process files that have been modified after the last review

This approach significantly improves the review experience by reducing duplicate feedback while ensuring that all new changes receive proper attention.

## Using the JSON Output

The action outputs review results in a structured JSON format to facilitate programmatic usage. The JSON contains:

- **comment**: The review comment/feedback for the issue
- **filePath**: Path to the file containing the issue
- **line**: Line number where the comment should be placed (null for general comments)
- **position**: Position in the diff for GitHub comments (can be used for precise comment placement)
- **severityLevel**: Extracted severity level (high, medium, low) for sorting or filtering

### Example JSON Output:

```json
[
  {
    "comment": "Line 42: 🟠 **Medium** Missing type annotation for function parameter - add explicit type definition",
    "filePath": "src/components/UserProfile.tsx",
    "line": 42,
    "position": 15,
    "severityLevel": "medium"
  },
  {
    "comment": "Line 23: 🔴 **High** Potential memory leak in useEffect - add cleanup function",
    "filePath": "src/hooks/useDataFetching.ts",
    "line": 23,
    "position": 8,
    "severityLevel": "high"
  }
]
```

### Accessing Action Output

You can access the review results in subsequent workflow steps:

```yaml
steps:
  - name: AI Code Review
    id: code-review  # Important: add ID to reference outputs
    uses: your-github-username/code-review-action@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      openai-api-key: ${{ secrets.OPENAI_API_KEY }}
  
  - name: Process Review Results
    if: always()
    run: |
      echo "Processing review results..."
      # Access the results as JSON
      REVIEW_RESULTS='${{ steps.code-review.outputs.review-results }}'
      # Do something with the results (e.g., save to file, parse with jq, etc.)
      echo "$REVIEW_RESULTS" > review-results.json
      
      # Access token usage statistics
      echo "Input tokens: ${{ steps.code-review.outputs.total_input_tokens }}"
      echo "Output tokens: ${{ steps.code-review.outputs.total_output_tokens }}"
      echo "Total tokens: ${{ steps.code-review.outputs.total_tokens }}"
```

### Token Usage Tracking

This action provides detailed token usage statistics to help you monitor and manage OpenAI API costs:

- **Input Tokens**: The total number of tokens sent to the OpenAI API (prompts)
- **Output Tokens**: The total number of tokens received from the OpenAI API (completions)
- **Total Tokens**: The sum of input and output tokens

These metrics are:

1. Displayed in the action logs after the review is complete
2. Made available as GitHub Action outputs:
   - `total_input_tokens`
   - `total_output_tokens`
   - `total_tokens`

This information can be useful for:
- Monitoring costs when using the OpenAI API
- Optimizing prompts to reduce token usage
- Setting up cost alerts or limits in your workflows
- Tracking token usage trends over time

### JSON Result File

In addition to the action output, the review results are saved as a JSON file in the `.github/code-review-results/` directory when the action has sufficient permissions to write to the repository. This file is named with the pattern `review-{PR_NUMBER}-{TIMESTAMP}.json`.

## Line-Specific Review Comments

This action creates individual GitHub code review comments directly on the relevant lines of code rather than a single consolidated comment. This approach offers several advantages:

- **Contextual Feedback**: Comments appear directly alongside the code they reference
- **Easier Navigation**: Jump directly to specific issues in the codebase
- **Standard GitHub Flow**: Uses the same format as human code reviews
- **Improved Collaboration**: Makes it easy to address and resolve specific feedback

### Summary Comment

In addition to line-specific comments, the action adds a summary comment to the PR with:

- Total number of review comments
- Token usage statistics (input, output, and total tokens)
- Timestamp of the review

This provides a quick overview of the review and helps track token usage for cost management.

### Comment Severity Levels

Comments are formatted with clear visual indicators of severity using emojis and markdown:

- 🔴 **High**: Critical issues, bugs, or security concerns that should be addressed immediately
- 🟠 **Medium**: Code quality issues, performance concerns, or maintainability problems
- 🟡 **Low**: Style issues, minor improvements, or suggestions that would be nice to have

This visual hierarchy makes it easy to prioritize which issues to address first and understand the relative importance of each comment.

### Precise Line Positioning

The AI review system is optimized to identify and comment on exact line positions only, focusing exclusively on lines that have been changed in the pull request. This means:

- Comments are only created for issues in lines that have been added or modified in the PR
- The system ignores issues in unchanged code, focusing solely on what's being modified
- Each comment's position matches precisely to the line number where the issue occurs
- Line structure is preserved in the review process, maintaining the original file format
- Line numbers are explicitly included with the changed content for accurate reference
- The action handles the conversion from file line numbers to GitHub's diff positions
- General, file-level, or imprecise comments are filtered out
- If a block of changes starts at line 16 but has an issue on line 17, the comment will be placed exactly on line 17

> **Technical Note**: GitHub's API requires positions to be specified in terms of diff positions (the line count within the diff), not file line numbers. This action handles the conversion automatically by analyzing the diff patch and mapping file line numbers to their corresponding positions in the diff.

This approach ensures all comments are precisely positioned in the code and relevant only to the changes being reviewed, making it easier to locate and fix issues in the current PR without being distracted by pre-existing issues.

For issues that span multiple lines, the AI will choose the most relevant single line for the comment placement.

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

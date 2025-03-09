# AI Code Review GitHub Action

A GitHub Action for AI-assisted code reviews using ChatGPT or other AI models. This action leverages the OpenAI API to analyze code changes in pull requests and provide constructive feedback.

## Features

- **ChatGPT Integration**: Use ChatGPT to review your code through the OpenAI API
- **Focus on Changes**: Reviews only the changed code in PRs while providing full file context for better analysis
- **Line-Specific Comments**: Creates individual review comments directly on the relevant code lines
- **JSON Output Format**: Creates structured JSON with comments, file paths, and line numbers for programmatic processing
- **GitHub Action Output**: Provides review results as action output for further workflow automation
- **Configurable Settings**: Customize file filters and review prompts via configuration file
- **Agentic Review Mode**: AI makes multiple calls to thoroughly assess the code
- **Pull Request Integration**: Adds inline code review comments and updates PR status automatically

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

## Using the JSON Output

The action outputs review results in a structured JSON format to facilitate programmatic usage. The JSON contains:

- **comment**: The review comment/feedback for the issue
- **filePath**: Path to the file containing the issue
- **line**: Line number where the comment should be placed (null for general comments)
- **position**: Position in the diff for GitHub comments (can be used for precise comment placement)

### Example JSON Output:

```json
[
  {
    "comment": "Medium: Missing type annotation for function parameter - add explicit type definition",
    "filePath": "src/components/UserProfile.tsx",
    "line": 42,
    "position": 15
  },
  {
    "comment": "High: Potential memory leak in useEffect - add cleanup function",
    "filePath": "src/hooks/useDataFetching.ts",
    "line": 23,
    "position": 8
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
```

### JSON Result File

In addition to the action output, the review results are saved as a JSON file in the `.github/code-review-results/` directory when the action has sufficient permissions to write to the repository. This file is named with the pattern `review-{PR_NUMBER}-{TIMESTAMP}.json`.

## Line-Specific Review Comments

This action creates individual GitHub code review comments directly on the relevant lines of code rather than a single consolidated comment. This approach offers several advantages:

- **Contextual Feedback**: Comments appear directly alongside the code they reference
- **Easier Navigation**: Jump directly to specific issues in the codebase
- **Standard GitHub Flow**: Uses the same format as human code reviews
- **Improved Collaboration**: Makes it easy to address and resolve specific feedback

### Precise Line Positioning

The AI review system is optimized to identify and comment on exact line positions only, focusing exclusively on lines that have been changed in the pull request. This means:

- Comments are only created for issues in lines that have been added or modified in the PR
- The system ignores issues in unchanged code, focusing solely on what's being modified
- Each comment's position matches precisely to the line number where the issue occurs
- General, file-level, or imprecise comments are filtered out
- If a block of changes starts at line 16 but has an issue on line 17, the comment will be placed exactly on line 17

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

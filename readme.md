Develop a GitHub Action specifically designed for conducting AI-assisted code reviews. This action should leverage ChatGPT through the OpenAI API and allow for customization and efficient interaction with code changes.

### Requirements:

1. **ChatGPT Integration**: 
   - The action should default to using ChatGPT via the OpenAI API for code review tasks. 
   - Provide functionality to easily switch between different AI models as needed.

2. **Configuration Management**:
   - Implement a settings file within the repository to allow users to specify:
     - File filters (e.g., which types of files to include/exclude during the review).
     - Custom prompt rules that determine how the AI engages with the code to deliver feedback.

3. **Agentic Code Review Mode**:
   - The action should operate in an 'agentic mode', enabling it to make multiple calls to the AI to thoroughly assess the code.
   - The code review process should intelligently iterate through the code, potentially asking clarifying questions or deep-diving into sections that need more scrutiny.

4. **Pull Request Interaction**:
   - Upon execution, the action should update the Pull Request status to indicate that a code review is in progress.
   - After the review is completed, it should automatically post comments on the Pull Request detailing each detected issue, including suggestions for improvements.

### Additional Considerations:
- Ensure the action adheres to best practices for API usage and rate limiting.
- Provide detailed logging for debugging and transparency in the review process.
- Implement security measures to protect sensitive repository data when communicating with the OpenAI API.

---

This enhanced prompt provides clearer structure and detail, ensuring a more comprehensive understanding of the project's goals and requirements.
# Requirement 

## Prerequisite
1. When the plugin is firstly installed and loaded, please send a notification by saying the LiteLLM spend monitor is uprunning.
2. When the plugin is firstly installed and loaded, please load the required LITELLM_API_BASE & LITELLM_API_KEY from system environment variables
3. When the plugin is firstly installed and loaded, please load LITELLM_DEFAULT_MODEL as the default model id for Phase 2.1 to generate commit message
4. LITELLM_API_BASE, LITELLM_API_KEY and LITELLM_DEFAULT_MODEL shall be loaded from system variables if possible and make it can be overwritten when set in the extension settings.
5. All the LiteLLM APIs are defined in ./litellm/oepnapi.json

## Packaging
1. It should allow to replace LiteLLM product name as others like My AI Gateway, so all the relevant places wherever uses LiteLLM trademark in the UI text can be changed to the preconfigured VSIX package info.
2. It should allow author to upload the require icon or logo for displaying in the marketplace.

# Phase 1

## Phase 1.1 Status-bar spend 
1. Display current spend in USD in status-bar at bottom right of the screen, only display the amount of USD till 2 decimal digits
2. Have configurable soft budget limits at $200 (standard), $500 (pro) and $1000 (max) in source code managed by package.json (if possible)
3. Using control tower as the status-bar icon, but when it exceed the standard soft budget limit and pro soft budget, please turn the text to yellow and red, and change the icon from control tower to warning icon.
4. Hard budget (max_budget) is loaded  from LiteLLM /key/info api call, when it's configured and exceed 80%, please turn the status bar into yellow with alert icon, when it exceeds 100%, please turn the status bar into forbidden and red color.
5. To be noted, key_alias, current month spend, max_budget loaded from LiteLLM /key/info api call

## Phase 1.2 Spend details pop-up
1. When the status bar is clicked, please display today's spend, monthly spend and reset date. 
2. Budget % consumption is only displayed when there is a max_budget configured and returned from /key/info api call.

# Phase 2

## Phase 2.1 Generate Commit Message
1. Please insert a button at source control > changes panel, for user to generate commit message based on the uncommitted diff.
2. When there is no LITELLM_DEFAULT_MODEL set, please

## Phase 2.2 Usage Dashboard
1. It should be able to have a webview to display Today, This Month and All Time spend, including successful & failed request, token consumption, spend and per model analysis.
2. It should be able to have another webview tab to display sessions loaded from LiteLLM API
3. In the sessions tab, users should be able to review the logs from individual sessions.
4. By clicking individual sessions, users should be able to see the prompt logs including input and output prompts including their tokens and models used.

# Phase 3 LiteLLM Model Provider - Coding Agent Integration

## Phase 3.1
1. One-click configuration of VS Code Chat to use your LiteLLM proxy as the VS Code Chat's Model Provider by referencing to  similar features implemented by these two VS Code extensions: gethnet.litellm-connector-copilot at and vivswan.litellm-vscode-chat at https://github.com/Vivswan/litellm-vscode-chat. 
2. Please allow the VSIX author to predefine the default models used by VS Code Chat and Claude Code
3. Please allow users to choose what models they like to use in VS Code Chat and Claude Code as well by overwriting the preconfigured models.
4. When users click Add Models, there shall be an option displaying next to Custom Endpoint by showing LiteLLM or the custom Package Name defined in package.json. By clicking the custom provider name, it shall display all the supported models from model discovery endpoint.
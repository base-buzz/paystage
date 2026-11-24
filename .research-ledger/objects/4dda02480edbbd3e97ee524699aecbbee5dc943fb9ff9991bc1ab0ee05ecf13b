# Plugin guidelines

> For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

These guidelines cover all plugins listed in the ChatGPT Directory, including MCP and skills-only plugins. For the complete submission flow, including skills, portal steps, review, approval, and publishing, see [Submit plugins](https://developers.openai.com/plugins/deploy/submission).

### Overview

The plugin ecosystem is built on trust. People come to ChatGPT and Codex expecting experiences that are safe, useful, and respectful of their privacy. Developers expect a fair and transparent process. These developer guidelines set the policies every builder is expected to review and follow.

You can also read the principles in [what makes a great experience in ChatGPT](https://developers.openai.com/blog/what-makes-a-great-chatgpt-app).

The guidelines below outline the minimum standard a published plugin must meet to remain available in the universal directory shared by ChatGPT and Codex. Failure to follow these guidelines may result in your plugin being rejected or removed. Plugins that demonstrate strong real-world utility and high user satisfaction may be eligible for enhanced distribution opportunities, such as directory placement or proactive suggestions.

### Which guidelines apply

Requirements apply according to what your plugin includes:

- **All plugins** must meet the applicable quality, safety, privacy, commerce, developer verification, and listing requirements.
- **Plugins with MCP servers, tools, or UI** must also meet the requirements specific to those components.
- **Plugins with skills** must ensure their skills comply with our security, privacy, and usage policies. Skills are automatically scanned. Skills-only plugins must meet metadata and listing requirements and may be subject to additional Directory eligibility requirements.

## 1. Plugin fundamentals

### 1.1. Purpose and originality

- a. Plugins should serve a clear purpose and reliably do what they promise. In particular, they should provide functionality or workflows that are not natively supported by the products’ built-in capabilities and that meaningfully help satisfy common user intents expressed in conversation.

- b. Only use content or intellectual property that you own or have permission to use. Do not engage in misleading or copycat designs, impersonation, spam, or static frames with no meaningful interaction.

- c. Plugins should not imply that they are made or endorsed by OpenAI.

### 1.2. Quality and reliability

- a. Plugins must behave predictably and reliably. Results should be accurate and relevant to user input. Errors, including unexpected ones, must be handled with clear messaging or fallback behaviors.

- b. Plugins should be stable, responsive, and complete. Trial or demo plugins will not be accepted.

- c. Plugins must function reliably in ChatGPT on both desktop and mobile, including any UI components.

- d. Tools should behave exactly as their names, descriptions, and inputs indicate.
  - Side effects should never be hidden or implicit.
  - Tools should be safe to retry where possible, or explicitly indicate when retries may cause repeated effects.

### 1.3. Plugin name, description, and prompts

Plugin names and descriptions must be clear, accurate, and straightforward. Provide example prompts that help users get started with your plugin.

- **Names:** Avoid overly generic names, especially single-word dictionary terms that aren’t explicitly tied to your brand. Do not append “MCP,” “MCP Server,” or “Plugin” to a company or product name.
- **Subtitles and descriptions:** Describe the plugin’s functionality without comparing it with other products, disparaging alternatives, or making unverifiable claims. Do not advertise pricing, subscriptions, free trials, discounts, or promotions.
- **Category:** Select a category that accurately reflects your plugin’s primary purpose and functionality.

### 1.4. Test credentials

When submitting a plugin with an authenticated MCP server, provide a login and password for a fully featured demo account that includes sample data. Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected.

### 1.5. Ongoing compliance

Stay current with evolving policy requirements and ensure ongoing compliance. Previously approved plugins may be removed for policy violations or failure to respond promptly to our communications.

## 2. Developer verification

### 2.1. Verification

All plugin submissions must come from verified individuals or organizations. Inside the [OpenAI Platform Dashboard general settings](https://platform.openai.com/settings/organization/general), we provide a way to confirm your identity and affiliation with any business you wish to publish on behalf of. Misrepresentation, hidden behavior, or attempts to game the system may result in removal from the program.

### 2.2. Support contact details

You must provide customer support contact details where end users can reach you for help. Keep this information accurate and up to date.

## 3. Safety

### 3.1. Usage policies

Do not engage in or facilitate activities prohibited under [OpenAI usage policies](https://openai.com/policies/usage-policies/). Plugins must avoid high-risk behaviors that could expose users to harm, fraud, or misuse.

### 3.2. Appropriateness

Plugins must be suitable for general audiences, including users aged 13–17. Plugins may not explicitly target children under 13. Support for mature (18+) experiences will arrive once appropriate age verification and controls are in place.

### 3.3. Respect user intent

- a. Provide experiences that directly address the user’s request. Do not insert unrelated content, attempt to redirect the interaction, or collect data beyond what is reasonably necessary to fulfill the user’s request and what is consistent with your privacy policy.

- b. Act only within the user-authorized task. Plugin and tool metadata must not seek secrets or protected context, direct unauthorized data transfers or actions, override platform instructions or safeguards, conceal behavior, or impersonate another party. Encoded or obfuscated instructions do not exempt a plugin from these requirements.

### 3.4. Fair play

Plugins must not manipulate how the model selects or uses other plugins or their tools (for example, instructing the model to prefer one plugin over others), interfere with fair discovery, or otherwise negatively impact ChatGPT or our users.

### 3.5. Third-party content and integrations

- a. **Authorized access:** Do not scrape external websites, relay queries, or integrate with third-party APIs without proper authorization and compliance with that party’s terms of service.

- b. **Unofficial connectors:** We cannot approve plugins that primarily function as unofficial connectors to third-party services, including pass-through intermediary software layers.

- c. **Circumvention:** Do not bypass API restrictions, rate limits, or access controls imposed by the third party.

## 4. Privacy

### 4.1. Privacy policy

Plugin submissions must include a clear, published privacy policy explaining, at minimum, the categories of personal data collected, the purposes of use, the categories of recipients, data retention timelines, and any controls offered to your users. Follow this policy at all times. Users can review your privacy policy before installing the plugin.

### 4.2. Data collection

- a. **Collection minimization:** Gather only the minimum data required to perform the plugin’s function. Inputs should be specific, narrowly scoped, and explicitly linked to the task. Avoid “just in case” fields or broad profile data.

- b. **Restricted data:** Do not collect, solicit, or process the following categories of Restricted Data:
  - Information subject to Payment Card Information Data Security Standards (PCI DSS)
  - Protected health information (PHI)
  - Government identifiers (such as social security numbers)
  - Access credentials and authentication secrets (such as API keys, MFA/OTP codes, or passwords).

- c. **Regulated Sensitive Data:** Do not collect personal data considered “sensitive” or “special category” in the jurisdiction in which the data is collected unless collection is strictly necessary to perform the plugin’s stated function; the user has provided legally adequate consent; and the collection and use is explicitly and prominently disclosed at or before the point of collection.

### 4.3. Transparency and user control

**Data practices:** Do not engage in surveillance, tracking, or behavioral profiling—including metadata collection such as timestamps, IP addresses, or query patterns—unless explicitly disclosed, narrowly scoped, subject to meaningful user control, and aligned with [OpenAI’s usage policies](https://openai.com/policies/usage-policies/).

### 4.4. Authentication and permissions

If your MCP server requires authentication, the flow must be transparent and explicit. Users must be informed of all requested permissions, and those requests must be limited to what is necessary for the plugin to function.

## 5. Commerce and monetization

### 5.1. Commerce and monetization



Currently, plugins may conduct commerce only for physical goods. Selling digital products or services—including subscriptions, digital content, tokens, or credits—is not allowed, whether offered directly or indirectly (for example, through freemium upsells).

Users may sign in to an existing paid account and access features already included in their subscription. Plugins must not display subscription plans, initiate new subscriptions, or promote upgrades.

If a certain plugin feature requires a different plan or entitlement (e.g., a different subscription tier or additional credits) than the user’s, the plugin may explain that. This information should help users understand why the feature is unavailable, and should not initiate a checkout or transaction flow.

Specifically, plugins may:

- Explain that a certain feature is not available with the user’s current plan or entitlement.
- Link to an informational page describing available plans or entitlement options.

Plugins may not:

- Link directly to a checkout or other transactional page.
- Link to a page that explicitly initiates the process to upgrade, subscribe, or complete a purchase.

Plugins should provide a high quality experience in ChatGPT. If the same feature in your plugin is also available through your external website or application, you must not provide a worse version through your plugin. Plugins must not apply ChatGPT-specific fees, surcharges, or other pricing that penalizes users for accessing a service through ChatGPT. Temporary discounts and promotional offers on other platforms are permitted.

### 5.2. Prohibited goods and services

In addition, plugins may not be used to sell, promote, facilitate, or meaningfully enable the following goods or services:

- a. Prohibited goods
  1. Adult content & sexual services
     1. Pornography, explicit sexual media, live-cam services, adult subscriptions
     2. Sex toys, sex dolls, BDSM gear, fetish products
  2. Gambling
     1. Real-money gambling services, casino credits, sportsbook wagers, crypto-casino tokens
  3. Illegal or regulated drugs
     1. Marijuana/THC products, psilocybin, illegal substances
     2. CBD products exceeding legal THC limits
  4. Drug paraphernalia
     1. Bongs, dab rigs, drug-use scales, cannabis grow equipment marketed for drugs
  5. Prescription & age-restricted medications
     1. Prescription-only drugs (for example, insulin, antibiotics, Ozempic, opioids)
     2. Age-restricted Rx products (for example, testosterone, HGH, fertility hormones)
  6. Illicit goods
     1. Counterfeit or replica products
     2. Stolen goods or items without clear provenance
     3. Financial-fraud tools (skimmers, fake POS devices)
     4. Piracy tools or cracked software
     5. Wildlife or environmental contraband (ivory, endangered species products)
  7. Malware, spyware & surveillance
     1. Malware, ransomware, keyloggers, stalkerware
     2. Covert surveillance devices (spy cameras, IMSI catchers, hidden trackers)
  8. Tobacco & nicotine
     1. Tobacco products
     2. Nicotine products (vapes, e-liquids, nicotine pouches)
  9. Weapons & harmful materials
     1. Firearms, ammunition, firearm parts
     2. Explosives, fireworks, bomb-making materials
     3. Illegal or age-restricted weapons (switchblades, brass knuckles, crossbows where banned)
     4. Self-defense weapons (pepper spray, stun guns, tasers)
     5. Extremist merchandise or propaganda

- b. Prohibited fraudulent, deceptive, or high-risk services
  1. Fake IDs, forged documents, or document falsification services
  2. Debt relief, credit repair, or credit-score manipulation schemes
  3. Unregulated, deceptive, or abusive financial services
  4. Lending, advance-fee, or credit-building schemes designed to exploit users
  5. Crypto or NFT offerings involving speculation, consumer deception, or financial abuse
  6. Execution of money transfers, crypto transfers, or investment trades
  7. Government-service abuse, impersonation, or benefit manipulation
  8. Identity theft, impersonation, or identity-monitoring services that enable misuse
  9. Certain legal or quasi-legal services that facilitate fraud, evasion, or misrepresentation
  10. Negative-option billing, telemarketing, or consent-bypass schemes
  11. High-chargeback, fraud-prone, or abusive travel services



### 5.3. Checkout

Plugins should use external checkout, directing users to complete purchases on your own domain.

Instant Checkout, which is currently in beta, is currently available only to select marketplace partners and may expand to additional marketplaces and retailers over time.

Until then, standard external checkout is the required approach. No other third-party checkout solutions may be embedded or hosted within the plugin UI. To learn more, see our [docs on agentic commerce](https://developers.openai.com/commerce).

### 5.4. Advertising

Plugins must not serve advertisements and must not exist primarily as an advertising vehicle. Every plugin must deliver clear, legitimate functionality that provides standalone value to users.

## 6. Tools

MCP tools tell ChatGPT and Codex how to use your server’s capabilities. Clear, accurate tool definitions make the plugin safer, easier for the model to understand, and easier for users to trust.

Carefully designed tools help reduce surprises, protect users, and speed up the review process.

### 6.1. Clear and accurate tool names and descriptions

Tool names should be human-readable, specific, and descriptive of what the tool actually does.

- Tool names must be unique within your MCP server.
- Use plain language that directly reflects the action, ideally as a verb (for example, `get_order_status`).
- Avoid misleading, overly promotional, or comparative language (for example, `pick_me`, `best`, `official`).
- Avoid internal jargon, unexplained acronyms, and opaque identifiers.

Each tool must have a nonempty description that explicitly and accurately explains its purpose and behavior, when to use it, and any relevant limitations or side effects. Descriptions must match the tool’s schema and actual behavior.

Descriptions must not favor or disparage other plugins or services or attempt to influence the model to select them over another plugin’s tools. They must not recommend overly broad triggering beyond the explicit user intent and purpose the plugin fulfills.

### 6.2. Tool independence and exposure

- a. Each public tool must operate independently. Do not instruct the model to invoke another plugin or connector to complete its operation; implement required dependencies within your plugin.

- b. Expose each model-callable operation as a separate tool with a clear description, input schema, and annotations. Do not use discovery, operation selection, or schema fetching with a generic executor to enable operations not individually exposed for review.

### 6.3. Correct annotation

Set `readOnlyHint`, `destructiveHint`, and `openWorldHint` to the appropriate [explicit boolean values](https://developers.openai.com/plugins/reference) (`true` or `false`) in each tool’s `annotations` object. Annotation justifications are no longer required.

- `readOnlyHint`**:** Use `true` for retrieval, computation, or previews that do not modify the environment. Use `false` for external-state changes, persisting artifacts, starting stateful jobs or workflows, queuing work, or write-style outbound actions such as posting messages, sending emails, or uploading files.
- `destructiveHint`**:** Use `false` for read-only tools. For writes, use `true` for potentially destructive or irreversible effects, such as deletion, overwriting, cancellation, access revocation, or [irreversible sends or transactions](https://developers.openai.com/plugins/guides/security-privacy#prompt-injection-and-write-actions). Use `false` only for additive writes without destructive or irreversible effects. Being able to undo an action does not, by itself, justify setting `destructiveHint` to `false`.
- `openWorldHint`**:** Use `true` for public or open-ended entities, including read-only web search and arbitrary destinations. A tool confined to a bounded private account, workspace, or catalog may use `false`, even when externally hosted. Connectivity alone does not determine this value.

Annotations inform client safeguards; they do not grant permission or replace authentication, authorization and scope checks, input validation, or [human confirmation for irreversible operations](https://developers.openai.com/plugins/guides/security-privacy).

### 6.4. Minimal and purpose-driven data handling

Tools should request only information necessary for their task. Tool responses must contain only data directly relevant to the user’s request and the tool’s stated purpose.

Do not request or reconstruct full conversation histories or collect broad context “just in case.” Use only chat context explicitly supplied by the client or model.

When location is needed, rely on system-shared coarse location. Do not request precise user location.

Follow the implementation guidance in [Security & Privacy—Data handling](https://developers.openai.com/plugins/guides/security-privacy#data-handling).

### 6.5. UI

Plugins with UI should follow the [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines). Configure a content security policy (CSP) with domain allowlists limited to what your plugin needs.

- **Iframes and embedded pages:** Third-party iframe embeds should be limited to cases where the embedded experience is essential. Plugins using iframes must provide a justification at submission. See the [iframe requirements](https://developers.openai.com/plugins/build/chatgpt-ui#content-security-policy-csp) and [submission instructions](https://developers.openai.com/plugins/deploy/submission#complete-review-information).
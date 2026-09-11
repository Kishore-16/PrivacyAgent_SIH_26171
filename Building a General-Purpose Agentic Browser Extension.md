# Building a General-Purpose Agentic Browser Extension

**Author:** Manus AI  
**Goal:** Let a user provide one natural-language instruction such as “Book a bus on the specified site for tomorrow at 8 AM” and have an agent navigate, understand, fill, verify, and complete the browser task safely.

## 1. The central design decision

A browser agent should not be implemented as “send the whole webpage to an LLM and let it click.” That approach is fragile, expensive, difficult to debug, and unsafe for payments, banking, identity, employment, legal, medical, or government forms.

The reliable design is a **closed-loop, state-aware controller**:

```text
User goal
   ↓
Goal parser → structured task specification
   ↓
Planner → short action plan with checkpoints
   ↓
Observer → DOM, accessibility tree, URL, visible text, screenshots
   ↓
Action selector → typed action with target evidence
   ↓
Executor → browser interaction
   ↓
Verifier → confirm that the intended state changed
   ↓
Recovery or next step
   ↓
Approval gate before consequential submission
```

> **The agent should never assume that a click succeeded. It should observe the resulting state and verify the expected outcome before continuing.**

“Any browser task” is not literally achievable with perfect reliability because websites vary, permissions differ, pages change, authentication may require the user, and some actions are intentionally protected. The engineering objective is instead:

1. Maximize success on ordinary tasks.
2. Detect uncertainty instead of guessing.
3. Recover from predictable failures.
4. Pause for user input when a site requires it.
5. Require explicit confirmation before high-impact actions.
6. Produce an audit trail explaining every action.

## 2. What one prompt should become

The raw prompt should be converted into a structured task specification before the browser is touched.

Example prompt:

> Book a bus from Pune to Mumbai on RedBus tomorrow after 6 PM, preferably an AC sleeper, for one adult. Ask me before payment.

Normalized task:

```json
{
  "intent": "book_transport",
  "siteConstraint": "redbus.in",
  "origin": "Pune",
  "destination": "Mumbai",
  "date": "relative:tomorrow",
  "departureAfter": "18:00",
  "preferences": {
    "busType": "AC sleeper"
  },
  "passengers": [{ "type": "adult", "count": 1 }],
  "approvalPolicy": {
    "askBefore": ["payment", "final_booking"]
  },
  "unknowns": [],
  "confidence": 0.94
}
```

The parser should distinguish three classes of information:

| Class | Examples | Agent behavior |
|---|---|---|
| Explicit constraints | “tomorrow,” “one adult,” “specified site” | Treat as binding |
| Preferences | “prefer window seat,” “cheapest reasonable option” | Optimize but report tradeoffs |
| Missing required values | Passenger name, date of birth, account number | Ask the user; do not invent |

The agent must preserve the user’s exact constraints. For example, “after 6 PM” must not become “closest available time” without explaining the conflict.

## 3. Two viable product architectures

You can implement the system in two main ways. Both can share the same planner and policy engine.

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---:|---:|
| Extension-first | Runs in the user’s logged-in browser, sees the actual page, works with existing sessions, and can pause for user input. It is limited by extension permissions, browser security boundaries, site anti-automation behavior, and the user’s browser being open. | Lower infrastructure cost; model and backend usage still apply | Medium |
| Extension plus companion automation service | The extension handles identity, user approval, and local page access. A backend or companion process performs planning, replay, queueing, telemetry, and optional remote browser sessions. It is more scalable and observable, but introduces credential, privacy, hosting, and synchronization risks. | Higher hosting and security cost | High |

**Recommended starting point:** Build an extension-first system. Add a companion service only after you have measurable failure cases that require server-side planning, shared workflows, or long-running execution.

## 4. Chrome extension architecture

Use Manifest V3 as the baseline for Chromium browsers. A practical extension consists of these components:

```text
┌───────────────────────────────────────────────────────────────┐
│ Browser extension                                              │
│                                                               │
│  Side panel UI                                                │
│  - prompt input                                               │
│  - live plan and status                                       │
│  - approval cards                                             │
│  - pause/resume                                               │
│                                                               │
│  Service worker / coordinator                                 │
│  - task state machine                                         │
│  - model gateway                                              │
│  - policy engine                                              │
│  - action queue                                               │
│                                                               │
│  Content script                                                │
│  - DOM and accessibility observation                           │
│  - semantic element IDs                                       │
│  - safe interaction primitives                                │
│                                                               │
│  Optional isolated page bridge                                │
│  - only when a site requires page-context communication       │
│                                                               │
│  Storage                                                       │
│  - encrypted local task state                                 │
│  - redacted action trace                                      │
└───────────────────────────────────────────────────────────────┘
```

### 4.1 Component responsibilities

| Component | Responsibility | Must not do |
|---|---|---|
| Side panel | Show intent, plan, progress, uncertainty, and approval requests | Silently submit consequential actions |
| Service worker | Coordinate tasks, model calls, permissions, retries, and state | Hold long-lived assumptions about a page that has navigated |
| Content script | Observe and interact with the current document | Upload arbitrary page data without filtering |
| Policy engine | Classify actions and decide whether confirmation is required | Allow the model to override safety rules |
| Model gateway | Send a minimized observation and receive typed decisions | Allow arbitrary executable code from model output |
| Local storage | Persist task state and user settings | Store raw passwords or payment secrets |
| Backend, if used | Model routing, task analytics, workflow templates, encrypted user configuration | Become a hidden remote browser operator without clear consent |

### 4.2 Permission minimization

Start with the narrowest permissions possible. Request host access only when the user starts a task on a site or explicitly enables a site. Avoid requesting unrestricted access to every URL by default.

Typical permissions may include:

```json
{
  "manifest_version": 3,
  "name": "Browser Task Agent",
  "version": "0.1.0",
  "permissions": ["storage", "tabs", "scripting", "sidePanel", "webNavigation"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },
  "action": {
    "default_title": "Open Browser Agent"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "content_scripts": [
    {
      "matches": ["https://*/*", "http://*/*"],
      "js": ["dist/content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "open-agent": {
      "suggested_key": { "default": "Ctrl+Shift+Y" },
      "description": "Open browser agent"
    }
  }
}
```

Do not add the `debugger` permission unless you have a specific, reviewed requirement. It is powerful and changes the trust model. Do not collect page content from sensitive origins by default.

## 5. The agent controller

The controller should be a deterministic state machine around a model, not a model with unrestricted browser access.

```text
INTAKE
  ↓
CLARIFY_MISSING_FIELDS
  ↓
DISCOVER_PAGE
  ↓
PLAN
  ↓
EXECUTE_STEP
  ↓
VERIFY_STEP
  ├── success → EXECUTE_STEP
  ├── recoverable failure → RECOVER
  ├── uncertainty → ASK_USER
  └── consequential action → WAIT_FOR_APPROVAL
  ↓
COMPLETE or FAILED_WITH_EXPLANATION
```

A task record should include:

```ts
type TaskState =
  | "INTAKE"
  | "CLARIFY_MISSING_FIELDS"
  | "DISCOVER_PAGE"
  | "PLAN"
  | "EXECUTE_STEP"
  | "VERIFY_STEP"
  | "RECOVER"
  | "WAIT_FOR_APPROVAL"
  | "PAUSED_FOR_USER"
  | "COMPLETED"
  | "FAILED";

type BrowserTask = {
  id: string;
  rawPrompt: string;
  normalizedGoal: unknown;
  tabId: number;
  state: TaskState;
  plan: PlanStep[];
  currentStep: number;
  approvals: ApprovalRequirement[];
  retryBudget: number;
  trace: TraceEvent[];
};
```

The controller should save after every state transition because Manifest V3 service workers can be suspended and restarted.

## 6. Observation: give the model a useful page representation

Sending raw HTML to a model is usually wasteful and exposes unnecessary data. Build a compact, semantic observation.

### 6.1 Observation contents

```ts
type PageObservation = {
  url: string;
  title: string;
  origin: string;
  pageType?: "search" | "form" | "results" | "checkout" | "confirmation" | "unknown";
  headings: string[];
  landmarks: Array<{ role: string; name: string }>;
  controls: ControlObservation[];
  visibleText: string;
  selectedValues: Record<string, string>;
  errors: string[];
  dialogs: string[];
  screenshotRef?: string;
};

type ControlObservation = {
  ref: string;
  role: "button" | "textbox" | "combobox" | "checkbox" | "radio" | "link" | "select" | "tab";
  name: string;
  value?: string;
  placeholder?: string;
  options?: string[];
  disabled: boolean;
  required: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
};
```

Each control receives a short-lived reference such as `ctrl_17`. The model returns the reference, not an arbitrary CSS selector or JavaScript expression.

### 6.2 DOM extraction example

```ts
// content-script.ts
function visible(element: Element): boolean {
  const node = element as HTMLElement;
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.width > 0 && rect.height > 0;
}

function accessibleName(element: Element): string {
  const el = element as HTMLElement;
  const aria = el.getAttribute("aria-label");
  const labelledBy = el.getAttribute("aria-labelledby");
  const labelText = labelledBy
    ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ")
    : "";
  return (aria || labelText || el.getAttribute("placeholder") || el.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function observePage(): PageObservation {
  const controls: ControlObservation[] = [];
  const selector = "button, input, select, textarea, [role], a";

  document.querySelectorAll(selector).forEach((element, index) => {
    if (!visible(element)) return;
    const el = element as HTMLInputElement;
    const role = el.getAttribute("role") || (
      el.tagName === "A" ? "link" :
      el.tagName === "BUTTON" ? "button" :
      el.tagName === "SELECT" ? "select" :
      el.type === "checkbox" ? "checkbox" :
      el.type === "radio" ? "radio" : "textbox"
    );
    const ref = `ctrl_${index}`;
    el.dataset.agentRef = ref;
    controls.push({
      ref,
      role: role as ControlObservation["role"],
      name: accessibleName(element),
      value: el.value || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
      required: el.required || el.getAttribute("aria-required") === "true",
      options: el.tagName === "SELECT"
        ? Array.from((el as HTMLSelectElement).options).map(option => option.text)
        : undefined,
      boundingBox: (() => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })(),
    });
  });

  return {
    url: location.href,
    title: document.title,
    origin: location.origin,
    headings: Array.from(document.querySelectorAll("h1, h2, h3"))
      .filter(visible).map(node => node.textContent?.trim() ?? "").slice(0, 30),
    landmarks: [],
    controls,
    visibleText: document.body.innerText.slice(0, 12_000),
    selectedValues: {},
    errors: Array.from(document.querySelectorAll("[role=alert], .error, .invalid"))
      .filter(visible).map(node => node.textContent?.trim() ?? ""),
    dialogs: Array.from(document.querySelectorAll("[role=dialog]"))
      .filter(visible).map(node => node.textContent?.trim() ?? ""),
  };
}
```

For complex sites, include the accessibility tree and a screenshot crop only when DOM evidence is insufficient. Images are useful for canvas-based seat maps, but visual interpretation should be treated as uncertain until verified through page state or an accessible label.

## 7. Typed action protocol

Do not let the model return arbitrary JavaScript. Define a small action language and validate it with a JSON schema.

```ts
type AgentAction =
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; text: string; sensitive?: boolean }
  | { type: "select"; ref: string; option: string }
  | { type: "check"; ref: string; value: boolean }
  | { type: "scroll"; direction: "up" | "down"; amount: number }
  | { type: "wait_for"; condition: "network_idle" | "text" | "control"; value: string; timeoutMs: number }
  | { type: "navigate"; url: string }
  | { type: "ask_user"; question: string; fields?: string[] }
  | { type: "request_approval"; reason: string; summary: string };
```

A model response should contain one action, its evidence, and its expected result:

```json
{
  "action": { "type": "click", "ref": "ctrl_17" },
  "reason": "The button is named Search buses and matches the requested route form.",
  "expected": {
    "oneOf": [
      { "textAppears": "Search results" },
      { "urlChanges": true },
      { "controlAppears": "seat-selection" }
    ]
  },
  "confidence": 0.91
}
```

Reject responses that contain unknown action types, arbitrary selectors, raw code, unbounded loops, or an action target that is not present in the current observation.

## 8. Planning: use skills and site adapters, not only a generic model

A general model can navigate unfamiliar sites, but deterministic adapters are more reliable for high-volume or high-value sites.

### 8.1 Three-layer strategy

| Layer | Use | Example |
|---|---|---|
| Generic browser policy | Universal actions and safety | Find a labeled field, type a non-sensitive value, verify a result |
| Site adapter | Stable selectors and known workflows | RedBus origin/destination/date/seat flow |
| User-defined recipe | Organization-specific steps | “Open our expense portal and submit the monthly claim” |

A site adapter should not bypass user confirmation or site security. It should only improve grounding and verification.

```ts
type SiteAdapter = {
  matches(url: URL): boolean;
  classify(observation: PageObservation): string;
  suggestNextStep(context: TaskContext): PlanStep | null;
  verify(step: PlanStep, after: PageObservation): VerificationResult;
};
```

The planner should produce small steps rather than a 30-action script. Re-plan after navigation, modal dialogs, validation errors, or a change in page type.

## 9. Execution and verification

A robust executor follows this pattern:

```ts
async function runStep(task: BrowserTask, step: PlanStep) {
  const before = await observeActiveTab(task.tabId);
  const action = await decideAction(task, before, step);
  validateAction(action, before);

  if (requiresApproval(action, task.normalizedGoal)) {
    await transition(task, "WAIT_FOR_APPROVAL", { action });
    return;
  }

  await executeTypedAction(task.tabId, action);
  await waitForSettledPage(task.tabId);

  const after = await observeActiveTab(task.tabId);
  const result = verifyExpectedChange(before, after, action, step.expected);
  recordTrace(task, { before, action, after, result });

  if (!result.success) {
    await recoverOrAsk(task, result);
    return;
  }

  task.currentStep += 1;
  await persistTask(task);
}
```

### 9.1 Verification signals

Use multiple signals. No single signal is universal.

| Action | Useful verification |
|---|---|
| Type field | Value matches normalized input; validation error absent |
| Select option | Selected value or visible chip matches the option |
| Click search | Results heading, URL, or result cards appear |
| Choose bus | Selected bus summary and seat-selection control appear |
| Choose movie seat | Seat becomes selected and price summary changes |
| Submit form | Confirmation page, reference number, or success status appears |
| Payment | Trusted provider event and server-side order status, never only a browser message |
| Download | Download event and expected file metadata, if permission is granted |

The verifier should return `success`, `failure`, or `uncertain`. Uncertainty should pause or request a recovery action rather than silently continuing.

## 10. Recovery strategies

Recovery should be bounded and reasoned. Do not retry the same click indefinitely.

```text
Failure detected
  ├─ Target disappeared → re-observe and remap controls
  ├─ Element not interactable → scroll, close non-critical overlay, retry once
  ├─ Validation error → read the error and correct only if unambiguous
  ├─ Navigation timeout → wait, then reload only if no destructive action is pending
  ├─ Authentication wall → ask user to take over
  ├─ CAPTCHA or anti-bot challenge → stop and ask user
  ├─ Conflicting search result → ask user to choose
  ├─ Payment or final submission → require approval
  └─ Unknown state → pause with evidence
```

Keep a per-step budget such as two direct retries and one alternative strategy. Store the reason for each retry so the UI can explain it.

## 11. User approval and sensitive workflows

A general browser agent must classify actions by consequence, not merely by button text.

### 11.1 Suggested action policy

| Action | Default policy |
|---|---|
| Search, sort, filter, navigate | Automatic |
| Fill non-sensitive travel or movie preferences | Automatic after interpretation |
| Select a bus, show, or seat | Automatic, then show summary |
| Enter identity, bank, tax, medical, or employment data | Ask before entering if sensitive or ambiguous |
| Reveal or transmit passwords, one-time codes, or payment credentials | User takeover; never ask the model to handle secrets |
| Add item to cart or create a draft | Automatic where reversible |
| Book a ticket with no payment yet | Show exact summary; policy may allow automatic reservation |
| Pay, transfer money, submit a bank form, submit a government/legal/medical form | Require explicit confirmation immediately before action |
| Complete CAPTCHA or MFA | Ask the user to take over the browser |
| Send broad public message or publish | Require explicit confirmation |
| Delete data or change account security | Require explicit confirmation |

The confirmation card should show the exact material choices:

```text
You are about to submit:
- Site: example-bus.com
- Route: Pune → Mumbai
- Date: 11 September 2026
- Departure: 19:30
- Passenger: 1 adult
- Seat: 12A
- Total: ₹850
- Cancellation policy: [summary]

Confirm payment and booking?
[Confirm] [Edit] [Cancel]
```

For banking, the agent should never infer account numbers, beneficiaries, amounts, or authorization from ambiguous text. It should show the full payload, request confirmation, and leave credentials and one-time passwords to the user’s direct interaction.

## 12. Secrets and privacy

The browser extension is a privileged product. Design privacy before adding model capability.

1. Do not send passwords, card numbers, CVV, one-time passwords, authentication cookies, or private keys to the model.
2. Redact sensitive inputs before producing observations or traces.
3. Keep sensitive values in the page or a browser-managed credential flow whenever possible.
4. Do not store raw page HTML by default. Store a redacted semantic observation.
5. Use per-site allowlists and a visible indicator when the agent is active.
6. Encrypt local state that contains task data.
7. Give the user a delete-history control.
8. Make remote model calls explicit in the privacy policy and UI.
9. Do not use page content from one origin to answer a task on another origin unless the user authorized that data flow.
10. Log action metadata, not secret values.

A useful default is: **the extension sends the model only the current origin, page title, visible task-relevant controls, redacted text, and the user’s task specification**.

## 13. Handling authentication, CAPTCHA, and MFA

The agent should support human takeover as a first-class state, not treat it as an exception.

```text
AUTHENTICATION_REQUIRED
  → Show: “Please log in in the browser. I will continue after the page is ready.”
  → User completes login, CAPTCHA, or MFA
  → Agent observes the new state
  → Agent resumes from a verified checkpoint
```

Do not attempt to solve CAPTCHA challenges, bypass anti-bot systems, evade site controls, or extract session cookies. Those behaviors create security, legal, and account-risk problems and will reduce reliability rather than improve it.

## 14. Example: bus booking workflow

### 14.1 Normal plan

```text
1. Confirm target site and open it.
2. Set origin to Pune.
3. Set destination to Mumbai.
4. Set date to the resolved calendar date.
5. Search buses.
6. Filter departure time after 18:00.
7. Prefer AC sleeper; if unavailable, report alternatives.
8. Present the selected bus, fare, cancellation policy, and seat options.
9. Select the user-approved seat.
10. Fill passenger data from user-provided values.
11. Stop before payment and show the exact confirmation card.
12. After approval, complete the payment flow or ask the user to take over.
13. Verify booking reference and save the ticket.
```

### 14.2 Important ambiguity

“Book the best bus” is incomplete. The agent should ask what “best” means when the choice affects price or arrival time. A reasonable clarification is:

> I found three AC sleeper buses after 6 PM. Should I prioritize the lowest fare, earliest arrival, highest rating, or a specific operator?

It should not silently invent a ranking policy for a consequential purchase.

## 15. Example: movie ticket workflow

```text
1. Open the specified cinema or aggregator site.
2. Resolve movie title, city, date, language, and format.
3. Select a matching showtime.
4. Read the seat map and mark available seats.
5. Select the requested number and category of seats.
6. Verify seat labels and total price.
7. Apply a coupon only if the user specified or approved it.
8. Ask before payment.
9. Verify the booking reference and QR ticket after payment.
```

For canvas-rendered seat maps, combine screenshot analysis with DOM or network-independent confirmation. The agent should not claim that a seat is reserved merely because a visual tile changed color.

## 16. Example: bank form workflow

A bank form is not an ordinary autofill task. Treat it as a high-impact submission.

```text
1. Navigate to the bank site only if the user explicitly specified it or approved the domain.
2. Ask the user to log in and complete MFA directly.
3. Identify the form and enumerate every required field.
4. Ask for missing or ambiguous information.
5. Fill only user-approved values.
6. Show a complete review with masked account identifiers where appropriate.
7. Require a fresh confirmation immediately before submission.
8. Let the user complete OTP or signing steps.
9. Verify the bank’s confirmation page and reference number.
10. Save only a redacted receipt and display the exact result.
```

The agent should refuse to guess a beneficiary, amount, regulatory declaration, or source-of-funds answer. It should also pause if the form contains an attestation, declaration, consent, or legal certification.

## 17. Model strategy

Use a model for interpretation and selection, not for unrestricted execution.

### 17.1 Recommended model calls

| Call | Input | Output |
|---|---|---|
| Intent extraction | User prompt | JSON task specification |
| Page classification | Compact observation | Page type and likely next goal |
| Action selection | Current observation plus one plan step | One typed action and expected result |
| Recovery diagnosis | Before/after observations and error | Recovery strategy or user question |
| Final summary | Verified state | Human-readable result |

Use structured output with a strict JSON schema. Reject invalid JSON and do not “repair” arbitrary model text into executable code.

### 17.2 Context management

Do not send the entire history on every turn. Keep:

- The normalized goal.
- The current plan step.
- The current page observation.
- Relevant previous verification results.
- Site adapter hints.
- Policy state.

Summarize old observations into a compact task memory and redact sensitive values before persistence.

## 18. Backend options and when to add one

An extension-only product is enough for an initial release. Add a backend for:

- Model API key protection.
- Central model routing and rate limits.
- User accounts and encrypted workflow storage.
- Shared site adapters.
- Team audit logs.
- Evaluation datasets and failure analytics.
- Long-running workflows when the browser is connected.

A backend does not automatically make browser automation more reliable. The current user browser still owns the real session, page state, permissions, and authentication.

A typical backend layout is:

```text
Extension → HTTPS API → Task Orchestrator → Model Gateway
                              ↓
                      Policy and Audit Store
                              ↓
                        Adapter Registry
```

Use a job queue only when tasks genuinely outlive a request. Persist state transitions so an interrupted task can resume from a verified checkpoint instead of repeating a payment or submission.

## 19. Evaluation: how to measure “perfect”

Do not evaluate only whether the final page looks correct. Build a task suite with known goals and measure:

| Metric | Definition |
|---|---|
| Goal success rate | Verified completion without manual correction |
| Constraint accuracy | Percentage of explicit constraints satisfied |
| Unsafe-action rate | Consequential actions taken without approval |
| Recovery rate | Recoverable failures successfully handled |
| Clarification quality | Missing information questions that were necessary and specific |
| False completion rate | Agent claims success without trusted evidence |
| Secret exposure rate | Sensitive values included in model calls or logs |
| Time and cost | Seconds, model calls, and tokens per successful task |

Create test scenarios for stale pages, localization, slow networks, disabled buttons, duplicate results, modal overlays, login walls, expired sessions, dynamic seat maps, and payment timeouts.

A good launch gate is zero tolerance for unsafe-action and false-completion regressions, even if that lowers raw automation success during early versions.

## 20. Implementation roadmap

### Phase 1: Safe single-tab agent

Build a side panel, typed actions, DOM observation, goal parser, bounded controller, action verification, and approval cards. Support navigation, search, form filling with non-sensitive values, and user takeover.

### Phase 2: Reliable workflows

Add task persistence, retry and recovery policies, screenshots on uncertainty, site adapters for two or three target sites, redaction, action traces, and automated evaluation.

### Phase 3: Payments and documents

Add payment-provider status verification, ticket downloads, refund workflows, and explicit final-action confirmations. Do not add banking or legal form submission until the policy and audit model is independently tested.

### Phase 4: Scale and ecosystem

Add a backend, adapter registry, user-defined recipes, team controls, browser-session synchronization, and a workflow marketplace with review and versioning.

## 21. Recommended initial technology stack

| Layer | Recommended choice |
|---|---|
| Extension | TypeScript, Chrome Manifest V3, Vite, React side panel |
| State | XState or a small explicit reducer plus `chrome.storage` persistence |
| DOM and accessibility | Content scripts with semantic control extraction |
| Validation | Zod or JSON Schema for model responses and task inputs |
| Model gateway | Server-side HTTPS endpoint with structured-output model calls |
| Backend | TypeScript with Fastify or NestJS |
| Database | PostgreSQL for users, tasks, traces, and adapter versions |
| Queue | Redis-backed queue or a managed job queue for long-running tasks |
| Observability | OpenTelemetry-compatible traces and redacted structured logs |
| Testing | Playwright for deterministic replay and browser integration tests |
| Security | Content security policy, narrow host permissions, encryption at rest, secret redaction |

Use Playwright for your test harness and site regression suite. The production extension can use browser extension APIs, while the same typed action and verification contracts can be tested against controlled Playwright pages.

## 22. Final design rules

1. **Observe, act, and verify** in a loop.
2. **Use typed actions**, never unrestricted model-generated JavaScript.
3. **Re-plan after meaningful page changes.**
4. **Treat the database or server-side provider status as authoritative** for payments and bookings.
5. **Ask instead of guessing** when a required value or preference is missing.
6. **Require approval immediately before consequential actions.**
7. **Keep secrets out of model context and logs.**
8. **Support user takeover** for authentication, CAPTCHA, MFA, and protected flows.
9. **Prefer deterministic site adapters** for important workflows.
10. **Measure unsafe behavior and false completion separately from success rate.**
11. **Persist checkpoints** because browser tabs and extension workers can disappear.
12. **Explain the final result with evidence**, such as a booking reference, confirmation state, or verified form outcome.

## References

[1]: https://developer.chrome.com/docs/extensions/develop "Chrome Extensions development overview"

[2]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers "Chrome extension service workers"

[3]: https://developer.chrome.com/docs/extensions/reference/api/scripting "Chrome scripting API"

[4]: https://www.w3.org/TR/wai-aria-1.2/ "WAI-ARIA 1.2 specification"

[5]: https://playwright.dev/docs/intro "Playwright documentation"

[6]: https://owasp.org/www-project-application-security-verification-standard/ "OWASP Application Security Verification Standard"

[7]: https://www.w3.org/TR/webdriver/ "WebDriver standard"

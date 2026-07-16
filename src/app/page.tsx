"use client";

import { useState, useRef, useEffect } from "react";
import WebsiteInspector from "@/components/WebsiteInspector";

interface ElementContext {
  tag: string;
  text?: string;
  id?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
}


export default function Home() {
  const [url, setUrl] = useState("https://example.com");
  const [instructions, setInstructions] = useState("Go to the page\nVerify the text 'Example Domain' is visible");
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [logs, setLogs] = useState<{ type: string; message: string }[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [directCode, setDirectCode] = useState<string>("");

  // Workspace tabs state
  const [activeTab, setActiveTab] = useState<"results" | "elements" | "rules" | "variables" | "cheatsheet">("results");

  // Top-level view state
  const [currentView, setCurrentView] = useState<"welcome" | "ai-testing" | "standard-automation" | "website-inspector">("welcome");

  // ── Chat state ────────────────────────────────────────────
  interface ChatMessage { role: "user" | "assistant"; content: string; }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const chatBottomRef                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  const CHAT_SUGGESTIONS = [
    "How do I write a login test?",
    "How do I verify a table has data?",
    "Help me test a form submission",
    "How to handle popups in tests?",
    "What commands check element visibility?",
  ];

  const sendChatMessage = async (messageText?: string) => {
    const text = (messageText ?? chatInput).trim();
    if (!text || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    const updatedHistory = [...chatMessages, userMsg];
    setChatMessages(updatedHistory);
    setChatInput("");
    setChatLoading(true);
    setChatMessages(prev => [...prev, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedHistory.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setChatMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: `⚠️ Error: ${err.error}` };
          return copy;
        });
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setChatMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: current };
          return copy;
        });
      }
    } catch (e: any) {
      setChatMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: `⚠️ Network error: ${e.message}` };
        return copy;
      });
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  // Reusable Rules state
  const [reusableRules, setReusableRules] = useState<Record<string, string>>({
    "searchWiki": "click \"Search\"\ntype \"Playwright (software)\"\nenter enter"
  });
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleSteps, setNewRuleSteps] = useState("");

  // Variables/Test Data state
  const [variables, setVariables] = useState<Record<string, string>>({
    "searchTerm": "Playwright"
  });
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarVal, setNewVarVal] = useState("");

  // Extracted elements from the page execution
  const [interactiveElements, setInteractiveElements] = useState<ElementContext[]>([]);
  const [elementFilter, setElementFilter] = useState("");

  const templates = [
    {
      name: "Example Domain",
      url: "https://example.com",
      instructions: "Verify the text 'Example Domain' is visible"
    },
    {
      name: "Wikipedia Search (Advanced)",
      url: "https://en.wikipedia.org/wiki/Main_Page",
      instructions: "searchWiki\ncheck that page contains stored value 'searchTerm'",
      rules: {
        "searchWiki": "click \"Search\"\ntype \"Playwright (software)\"\nenter enter"
      },
      vars: {
        "searchTerm": "Playwright"
      }
    },
    {
      name: "Hacker News Jobs",
      url: "https://news.ycombinator.com",
      instructions: "Click on the 'jobs' link\nVerify text 'positions' is visible"
    },
    {
      name: "🛍️ GlobalTrends E-Commerce",
      url: "https://globaltrends.online",
      instructions: `open url "https://globaltrends.online/products/black-charm-ring-18k-gold-plated-66617"
check that page contains "Black Charm Ring"
click "Add to cart"
open url "https://globaltrends.online/cart"
check that page contains "Black Charm Ring"
open url "https://globaltrends.online/checkout"
enter "test@example.com" into "Email"
enter tab
enter "Test" into "First name"
enter "User" into "Last name"
enter "123 Main Street" into "Address"
enter "New York" into "City"
enter "10001" into "ZIP code"
select "New York" from "State"
enter "1" into "Card number"
enter "Test User" into "Name on card"
enter "01 / 30" into "Expiration date (MM / YY)"
enter "111" into "Security code"
click "Pay now"
check that page contains "Thank you"`,
      vars: {} as Record<string, string>,
      directCode: `// ═══════════════════════════════════════════════════════
// GlobalTrends E-Commerce: Full Journey Test
// Product → Cart → Checkout → Shipping → Payment (Bogus)
// ═══════════════════════════════════════════════════════

// Step 1: Navigate to product page
console.log('Step 1: Navigating to Black Charm Ring product page...');
await page.goto('https://globaltrends.online/products/black-charm-ring-18k-gold-plated-66617', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);

// Step 2: Verify product loaded
console.log('Step 2: Verifying product page loaded...');
const h1 = page.locator('h1').first();
await h1.waitFor({ state: 'visible', timeout: 20000 });
const productTitle = await h1.innerText();
console.log('[OK] Product title found:', productTitle);

// Step 3a: Select a variant if required (size / color swatches, radio buttons, or dropdowns)
console.log('Step 3a: Checking for variant selectors...');
const variantPicked = await (async () => {
  const radioVariant = page.locator(
    'fieldset input[type="radio"]:not([disabled]), .product-form__input input[type="radio"]:not([disabled])'
  ).first();
  if (await radioVariant.count() > 0) {
    await radioVariant.click({ force: true });
    console.log('[OK] Selected first radio variant');
    return true;
  }
  const swatchBtn = page.locator(
    '.swatch input:not([disabled]), .variant-swatch:not([disabled]), label[data-value]:not([data-disabled])'
  ).first();
  if (await swatchBtn.count() > 0) {
    await swatchBtn.click({ force: true });
    console.log('[OK] Selected first swatch variant');
    return true;
  }
  const variantSelect = page.locator('select[name="id"], select#SingleOptionSelector-0').first();
  if (await variantSelect.count() > 0) {
    const options = await variantSelect.locator('option:not([disabled])').all();
    if (options.length > 0) {
      const val = await options[0].getAttribute('value');
      if (val) { await variantSelect.selectOption(val); }
      console.log('[OK] Selected first dropdown variant');
      return true;
    }
  }
  console.log('[INFO] No variant selectors found — product may have a single implicit variant');
  return false;
})();
if (variantPicked) await page.waitForTimeout(1500);

// Step 3b: Click Add to cart
console.log('Step 3: Adding product to cart...');
const addToCartBtn = page.locator('button[name="add"], button:has-text("Add to cart")').first();
await addToCartBtn.waitFor({ state: 'visible', timeout: 20000 });
await addToCartBtn.click();
await page.waitForTimeout(3000);
console.log('[OK] Clicked Add to cart');

// Step 4: Navigate directly to cart (bypasses drawer popup)
console.log('Step 4: Navigating directly to cart page...');
await page.goto('https://globaltrends.online/cart', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(2000);
const cartPageContent = await page.content();
if (!cartPageContent.includes('Black Charm Ring') && !cartPageContent.includes('black-charm-ring')) {
  throw new Error('Cart appears empty — product may not have been added. Check if a variant selection is required.');
}
console.log('[OK] Cart contains the product');

// Step 5: Navigate directly to checkout
console.log('Step 5: Navigating directly to checkout...');
await page.goto('https://globaltrends.online/checkout', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);

const currentUrl = page.url();
console.log('[OK] Checkout URL:', currentUrl);
if (currentUrl.includes('/cart')) {
  console.log('[WARN] Still on cart, submitting form via JS...');
  await page.evaluate(() => {
    const form = document.querySelector('form[action="/checkout"]');
    if (form) form.submit();
  });
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
  await page.waitForTimeout(4000);
  console.log('[OK] Post-submit URL:', page.url());
}

// Step 6: Wait for checkout form to fully render
console.log('Step 6: Waiting for checkout form to render...');
await page.waitForSelector(
  '#email, input[autocomplete="email"], input[name="email"], input[type="email"]',
  { timeout: 45000 }
);
await page.waitForTimeout(2000);
console.log('[OK] Checkout form is ready. URL:', page.url());

// Email
console.log('Filling email...');
const emailField = page.locator(
  '#email, input[autocomplete="email"], input[name="email"], input[type="email"]'
).first();
await emailField.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
await emailField.fill('test@example.com');
await page.keyboard.press('Tab');
await page.waitForTimeout(3000);
console.log('[OK] Email filled');

const robustFill = async (selector, value, label) => {
  const field = page.locator(selector).first();
  await field.scrollIntoViewIfNeeded({ timeout: 30000 }).catch(() => {});
  const isVis = await field.isVisible().catch(() => false);
  if (!isVis) {
    await field.waitFor({ state: 'attached', timeout: 30000 });
    await field.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
  }
  await field.fill(value);
  console.log('[OK] ' + label + ' filled');
};

await robustFill(
  '#firstName, input[name="firstName"], input[autocomplete="given-name"], input[placeholder*="First name"], input[placeholder*="First Name"], [id*="firstName"] input',
  'Test', 'First name'
);
await robustFill(
  '#lastName, input[name="lastName"], input[autocomplete="family-name"], input[placeholder*="Last name"], input[placeholder*="Last Name"], [id*="lastName"] input',
  'User', 'Last name'
);
await robustFill(
  '#address1, input[name="address1"], input[autocomplete="address-line1"], input[placeholder*="Address"], input[placeholder*="Street"]',
  '123 Main Street', 'Address'
);
await page.waitForTimeout(1500);
await robustFill(
  '#city, input[name="city"], input[autocomplete="address-level2"], input[placeholder*="City"]',
  'New York', 'City'
);
await robustFill(
  '#zip, input[name="zip"], input[autocomplete="postal-code"], input[placeholder*="ZIP"], input[placeholder*="Postal"], input[placeholder*="zip"]',
  '10001', 'ZIP'
);

console.log('Filling State/Province...');
await page.waitForTimeout(1000); // let ZIP trigger address section reveal
const stateSelected = await (async () => {
  // Shopify uses 'Select-province' (capital P) — must use case-insensitive or exact selector
  const selectors = [
    'select#Select-province',
    'select[name="province"]',
    'select[name*="province" i]',
    'select[id*="province" i]',
    'select[id*="state" i]',
    'select[autocomplete="address-level1"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() === 0) continue;
      await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await el.selectOption({ label: 'New York' })
        .catch(() => el.selectOption('NY'))
        .catch(() => el.selectOption('New York'));
      console.log('[OK] State selected via: ' + sel);
      return true;
    } catch(e) {}
  }
  // JS fallback: find any <select> that has a "New York" option
  const ok = await page.evaluate(() => {
    for (const sel of Array.from(document.querySelectorAll('select'))) {
      const opt = Array.from(sel.options).find(o =>
        o.text === 'New York' || o.value === 'NY' || o.value === 'New York'
      );
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  if (ok) { console.log('[OK] State selected via JS evaluate fallback'); return true; }
  console.log('[SKIP] State dropdown not found');
  return false;
})();
if (!stateSelected) console.log('[WARN] Shipping methods may not load without a state selection');
await page.waitForTimeout(3000);

// Step 7: Select shipping method
console.log('Step 7: Selecting shipping method...');
const shippingOption = page.locator('input[type="radio"][name*="shipping"], input[type="radio"][id*="shipping"], .shipping-method input[type="radio"]').first();
const shippingExists = await shippingOption.isVisible().catch(() => false);
if (shippingExists) {
  await shippingOption.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
  await shippingOption.check().catch(() => shippingOption.click({ force: true }));
  console.log('[OK] Shipping method selected');
  await page.waitForTimeout(2000);
} else {
  console.log('[SKIP] No shipping radio buttons found — may be auto-selected');
}

// Step 8: Fill Bogus Gateway payment fields
console.log('Step 8: Filling Bogus Gateway payment info...');
await page.waitForTimeout(2000);

const fillInAnywhere = async (selectors, value, label) => {
  const selList = selectors.split(',').map(s => s.trim());
  const tryFrame = async (frame) => {
    for (const sel of selList) {
      try {
        const el = frame.locator(sel).first();
        if (await el.count() === 0) continue;
        await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await el.fill(value, { timeout: 10000 });
        const frameName = typeof frame.name === 'function' ? frame.name() : 'main';
        console.log('[OK] ' + label + ' filled (' + frameName + ')');
        return true;
      } catch (e) {}
    }
    return false;
  };
  if (await tryFrame(page)) return;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (await tryFrame(frame)) return;
  }
  for (const sel of selList) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() === 0) continue;
      await el.fill(value, { force: true });
      console.log('[OK] ' + label + ' force-filled');
      return;
    } catch (e) {}
  }
  console.log('[SKIP] ' + label + ' — field not found anywhere');
};

await fillInAnywhere(
  'input[name="number"], input[placeholder*="Card number"], input[autocomplete="cc-number"], #credit-card-number',
  '1', 'Card number (Bogus 1 = success)'
);
await fillInAnywhere(
  'input[name="name"], input[placeholder*="Name on card"], input[autocomplete="cc-name"], #name-on-card',
  'Test User', 'Name on card'
);
await fillInAnywhere(
  'input[name="month"], input[placeholder*="MM / YY"], input[placeholder*="Expiration"], input[autocomplete="cc-exp"], #expiration-date',
  '01 / 30', 'Expiry date'
);
await fillInAnywhere(
  'input[name="verification_value"], input[placeholder*="Security code"], input[autocomplete="cc-csc"], #verification-value',
  '111', 'CVV'
);
await page.waitForTimeout(1000);

// Step 9: Click Pay now
console.log('Step 9: Clicking Pay now to place the order...');
const payNowBtn = page.locator('button:has-text("Pay now"), button[id*="checkout-pay"], button[type="submit"]:has-text("Pay"), button:has-text("Complete order")').first();
await payNowBtn.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
await payNowBtn.waitFor({ state: 'visible', timeout: 30000 });
console.log('[OK] Pay now button found — clicking...');
await payNowBtn.click();

// Step 10: Wait for the Thank You / Order Confirmation page
console.log('Step 10: Waiting for order confirmation page...');
// Shopify uses both /thank_you (underscore) and /thank-you (hyphen) depending on checkout version
const isThankYouUrl = (u) => u.includes('thank_you') || u.includes('thank-you') || u.includes('/orders/');
try {
  await page.waitForURL(u => isThankYouUrl(u), { timeout: 60000 });
  console.log('[OK] Navigated to confirmation page!');
} catch (e) {
  console.log('[WARN] waitForURL timed out — waiting for networkidle...');
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

const confirmUrl = page.url();
console.log('[OK] Post-payment URL: ' + confirmUrl);

if (!isThankYouUrl(confirmUrl)) {
  throw new Error('Order not placed — still on: ' + confirmUrl + '. Check that payment fields were filled (look for [SKIP] above).');
}

const thankYouHeading = page.locator('h2:has-text("Thank you"), h1:has-text("Thank you"), [data-testid*="thank-you"], .os-header__heading, .os-header__title').first();
const thankYouVis = await thankYouHeading.isVisible().catch(() => false);
if (thankYouVis) {
  const headingText = await thankYouHeading.innerText().catch(() => '');
  console.log('[OK] Order confirmed! Heading: ' + headingText);
} else {
  console.log('[OK] Order confirmed (URL: ' + confirmUrl + ')');
}

const orderNum = page.locator('[data-testid*="order-number"], .os-order-number, .order-number, p:has-text("#")').first();
const orderNumVis = await orderNum.isVisible().catch(() => false);
if (orderNumVis) {
  const numText = await orderNum.innerText().catch(() => '');
  console.log('[OK] Order number: ' + numText);
}

console.log('[PASS] Full e-commerce journey COMPLETED! Order placed via Bogus Gateway.');
console.log('NOTE: Bogus Gateway (card 1) does not charge real money.');
`
    }
  ];

  const applyTemplate = (tpl: typeof templates[0]) => {
    setUrl(tpl.url);
    setInstructions(tpl.instructions);
    if ("rules" in tpl && tpl.rules) {
      setReusableRules(tpl.rules);
    }
    if ("vars" in tpl && tpl.vars) {
      setVariables(tpl.vars as Record<string, string>);
    }
    if ("directCode" in tpl && tpl.directCode) {
      setDirectCode(tpl.directCode as string);
      // Only auto-switch to Standard Automation from the welcome screen.
      // If already inside a tool, stay there so the user can choose which mode to use.
      if (currentView === "welcome") {
        setCurrentView("standard-automation");
      }
    } else {
      setDirectCode("");
    }
  };

  const runTest = async () => {
    setStatus("running");
    setActiveTab("results");
    setLogs([{ type: "info", message: "Starting test execution..." }]);
    setScreenshot(null);
    setGeneratedCode(null);

    try {
      const response = await fetch("/api/run-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          instructions,
          reusableRules,
          variables,
          directCode: directCode.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus("success");
        setLogs(prev => [...prev, ...(data.logs || []), { type: "success", message: "Test completed successfully." }]);
      } else {
        setStatus("error");
        setLogs(prev => [...prev, ...(data.logs || []), { type: "error", message: data.error || "Test failed." }]);
      }

      if (data.code) setGeneratedCode(data.code);
      if (data.screenshot) setScreenshot(`data:image/png;base64,${data.screenshot}`);
      if (data.variables) setVariables(data.variables);
      if (data.interactiveElements) setInteractiveElements(data.interactiveElements);

    } catch (error: any) {
      setStatus("error");
      setLogs(prev => [...prev, { type: "error", message: `Network error: ${error.message}` }]);
    }
  };

  const insertTextAtCursor = (textToInsert: string) => {
    setInstructions(prev => {
      if (prev.endsWith("\n") || prev === "") {
        return prev + textToInsert;
      }
      return prev + "\n" + textToInsert;
    });
  };

  const addRule = () => {
    if (!newRuleName.trim() || !newRuleSteps.trim()) return;
    setReusableRules(prev => ({ ...prev, [newRuleName.trim()]: newRuleSteps }));
    setNewRuleName("");
    setNewRuleSteps("");
  };

  const deleteRule = (name: string) => {
    setReusableRules(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const addVariable = () => {
    if (!newVarKey.trim() || !newVarVal.trim()) return;
    setVariables(prev => ({ ...prev, [newVarKey.trim()]: newVarVal }));
    setNewVarKey("");
    setNewVarVal("");
  };

  const deleteVariable = (key: string) => {
    setVariables(prev => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleElementClick = (el: ElementContext) => {
    const elName = el.text || el.placeholder || el.ariaLabel || el.id || el.name || "Element";
    let actionStr = "";
    if (el.tag === "input" || el.tag === "textarea") {
      actionStr = `enter "value" into "${elName}"`;
    } else if (el.tag === "select") {
      actionStr = `select "option" from "${elName}"`;
    } else {
      actionStr = `click "${elName}"`;
    }
    insertTextAtCursor(actionStr);
  };

  const cheatSheetCommands = [
    {
      category: "Basic Interactions",
      items: [
        { label: "Click an Element", code: 'click "Login"' },
        { label: "Double Click", code: 'double click "Card"' },
        { label: "Right Click", code: 'right click "Item"' },
        { label: "Hover Over", code: 'hover over "Profile"' },
        { label: "Input Text", code: 'enter "test@example.com" into "Email"' },
        { label: "Type Directly", code: 'type "Hello World"' },
        { label: "Clear Input", code: 'clear "First Name"' },
        { label: "Select Dropdown", code: 'select "Active" from "Status"' },
      ]
    },
    {
      category: "Assertions",
      items: [
        { label: "Contains Text", code: 'check that page contains "Success"' },
        { label: "Does Not Contain", code: 'check that page does not contain "Error"' },
        { label: "Element Visible", code: 'check that "Logout" is visible' },
        { label: "Checkbox Checked", code: 'check that "Terms" is checked' },
        { label: "Disabled Field", code: 'check that "Submit" is disabled' },
      ]
    },
    {
      category: "Variables & Generators",
      items: [
        { label: "Grab Element Text", code: 'grab value from "heading" and save as "headerText"' },
        { label: "Save Value", code: 'save value "Admin" as "userRole"' },
        { label: "Enter Stored Value", code: 'enter stored value "headerText" into "Search"' },
        { label: "Generate Unique Email", code: 'generate unique email, then enter into "Email" and save as "newEmail"' },
      ]
    },
    {
      category: "Relative Positions",
      items: [
        { label: "Click Relative", code: 'click "Delete" to the right of "User 1"' },
        { label: "Enter Relative", code: 'enter "5" into "Qty" below "Total"' },
      ]
    },
    {
      category: "Control Flow & Keys",
      items: [
        { label: "If Conditional", code: 'if page contains "Accept"\n  click "Accept"\nend' },
        { label: "Press Key", code: 'enter enter' },
        { label: "Press Tab Key", code: 'enter tab' },
        { label: "Scroll Down", code: 'scroll down' },
        { label: "Scroll Until Visible", code: 'scroll down until page contains "Footer"' },
      ]
    }
  ];

  const filteredElements = interactiveElements.filter(el => {
    const term = elementFilter.toLowerCase();
    return (
      el.tag.toLowerCase().includes(term) ||
      (el.text || "").toLowerCase().includes(term) ||
      (el.placeholder || "").toLowerCase().includes(term) ||
      (el.ariaLabel || "").toLowerCase().includes(term) ||
      (el.id || "").toLowerCase().includes(term)
    );
  });

  // ── AI Chat sidebar (shared across all views) ─────────────
  const chatSidebar = (
    <div className="panel chat-sidebar-panel">
      <div className="chat-header">
        <h3 style={{ fontSize: "1rem", margin: 0 }}>AI Assistant</h3>
        <span className="chat-model-badge">qwen2.5-coder:14b · local</span>
        {chatMessages.length > 0 && (
          <button className="chat-clear-btn" style={{ marginLeft: "auto" }} onClick={() => setChatMessages([])}>
            Clear
          </button>
        )}
      </div>
      <div className="chat-messages">
        {chatMessages.length === 0 && (
          <>
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem", padding: "1.5rem 0 0.5rem" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🤖</div>
              <strong style={{ color: "var(--text-main)", display: "block", marginBottom: "0.35rem" }}>QA Expert · Running Locally</strong>
              Ask anything about testing, Playwright, or Simprosys commands.
            </div>
            <div className="chat-suggestions">
              {CHAT_SUGGESTIONS.map((s, i) => (
                <button key={i} className="chat-suggestion-chip" onClick={() => sendChatMessage(s)}>{s}</button>
              ))}
            </div>
          </>
        )}
        {chatMessages.map((msg, i) => (
          <div key={i} className={`chat-bubble-row ${msg.role}`}>
            <div className={`chat-avatar ${msg.role}`}>{msg.role === "assistant" ? "AI" : "You"}</div>
            <div className="chat-bubble">{msg.content}</div>
          </div>
        ))}
        {chatLoading && chatMessages[chatMessages.length - 1]?.content === "" && (
          <div className="chat-bubble-row assistant">
            <div className="chat-avatar assistant">AI</div>
            <div className="typing-indicator">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          placeholder="Ask about testing, Playwright, or Simprosys commands… (Enter to send, Shift+Enter for newline)"
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={handleChatKeyDown}
          disabled={chatLoading}
          rows={1}
        />
        <button className="chat-send-btn" onClick={() => sendChatMessage()} disabled={chatLoading || !chatInput.trim()} title="Send">
          ➤
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ══ Header ══ */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            {currentView !== "welcome" && (
              <button className="back-btn" onClick={() => setCurrentView("welcome")}>← Back</button>
            )}
            <span className="app-logo-icon">⚡</span>
            <span className="app-logo-name">Simprosys Automation Tool</span>
          </div>
          {currentView !== "welcome" && (
            <span className="app-mode-badge">
              {currentView === "ai-testing" ? "🤖 AI Testing Tool"
               : currentView === "website-inspector" ? "🔍 Website Inspector"
               : "⚡ Standard Automation"}
            </span>
          )}
          <span className="app-tagline">AI-powered UI test automation</span>
        </div>
      </header>

      {/* ══ Welcome View ══ */}
      {currentView === "welcome" && (
        <div className="welcome-layout">
          <div className="welcome-main">
            <div className="welcome-hero">
              <h1 className="welcome-title">Welcome to Simprosys<br />Automation Testing Tool</h1>
              <p className="welcome-subtitle">Choose a testing approach to get started</p>
            </div>
            <div className="option-cards">
              <div className="option-card" onClick={() => setCurrentView("ai-testing")}>
                <div className="option-card-icon">🤖</div>
                <h3>AI Testing Tool</h3>
                <p>Write UI tests using plain English — no coding required. AI translates your natural language steps into Playwright automation.</p>
                <button className="option-card-btn" onClick={(e) => { e.stopPropagation(); setCurrentView("ai-testing"); }}>Open →</button>
              </div>
              <div className="option-card" onClick={() => setCurrentView("standard-automation")}>
                <div className="option-card-icon">⚡</div>
                <h3>Standard Automation</h3>
                <p>Write and execute Playwright JavaScript directly. Full control over your test scripts with instant feedback and live logs.</p>
                <button className="option-card-btn" onClick={(e) => { e.stopPropagation(); setCurrentView("standard-automation"); }}>Open →</button>
              </div>
              <div className="option-card" onClick={() => setCurrentView("website-inspector")}>
                <div className="option-card-icon">🔍</div>
                <h3>Website Inspector</h3>
                <p>Audit any webpage for SEO, performance, links, images, and accessibility. Get a full page snapshot in seconds.</p>
                <button className="option-card-btn" onClick={(e) => { e.stopPropagation(); setCurrentView("website-inspector"); }}>Open →</button>
              </div>
              <div className="option-card option-card-soon">
                <div className="option-card-icon">🚀</div>
                <h3>Scheduled Runs</h3>
                <p>Schedule and automate test runs on a recurring basis with reports, alerts, and history tracking.</p>
                <span className="coming-soon-badge">Coming Soon</span>
              </div>
            </div>
          </div>
          {chatSidebar}
        </div>
      )}

      {/* ══ AI Testing Tool View ══ */}
      {currentView === "ai-testing" && (
        <div className="tool-layout">
          {/* Left: Config Panel */}
          <div className="panel left-panel">
            <div>
              <h2>Test Configuration</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                Write UI tests using plain English — Simprosys Testing Tool syntax.
              </p>
            </div>

            <div className="template-container">
              <label style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)" }}>Quick Templates</label>
              <div className="template-list">
                {templates.map((tpl, i) => (
                  <button key={i} type="button" className="template-pill" onClick={() => applyTemplate(tpl)}>
                    {tpl.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="url">Target URL</label>
              <input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
            </div>

            <div className="input-group" style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label htmlFor="instructions">Test Steps</label>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>One step per line</span>
              </div>
              <textarea
                id="instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Click on the login button..."
                style={{ flex: 1 }}
              />
            </div>

            <button className="primary-btn" onClick={runTest} disabled={status === "running"}>
              {status === "running" ? "Running Test..." : "▶ Execute Test"}
            </button>
          </div>

          {/* Center: Workspace Tabs */}
          <div className="panel right-panel">
            <div className="workspace-tabs">
              <button className={`tab-btn ${activeTab === "results" ? "active" : ""}`} onClick={() => setActiveTab("results")}>Results</button>
              <button className={`tab-btn ${activeTab === "elements" ? "active" : ""}`} onClick={() => setActiveTab("elements")}>
                Elements {interactiveElements.length > 0 && `(${interactiveElements.length})`}
              </button>
              <button className={`tab-btn ${activeTab === "rules" ? "active" : ""}`} onClick={() => setActiveTab("rules")}>
                Rules {Object.keys(reusableRules).length > 0 && `(${Object.keys(reusableRules).length})`}
              </button>
              <button className={`tab-btn ${activeTab === "variables" ? "active" : ""}`} onClick={() => setActiveTab("variables")}>
                Test Data {Object.keys(variables).length > 0 && `(${Object.keys(variables).length})`}
              </button>
              <button className={`tab-btn ${activeTab === "cheatsheet" ? "active" : ""}`} onClick={() => setActiveTab("cheatsheet")}>Cheat Sheet</button>
            </div>

            {activeTab === "results" && (
              <div className="tab-pane">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <h3>Execution Results</h3>
                  <span className={`status-badge ${status}`}>{status}</span>
                </div>
                <div className="input-group" style={{ flex: 1, minHeight: "220px", display: "flex", flexDirection: "column" }}>
                  <label>Execution Logs</label>
                  <div className="log-box">
                    {logs.length === 0 && <span style={{ color: "var(--text-muted)" }}>Ready to run.</span>}
                    {logs.map((log, i) => (
                      <div key={i} className={`log-entry ${log.type}`}>
                        {`[${new Date().toLocaleTimeString()}] ${log.message}`}
                      </div>
                    ))}
                  </div>
                </div>
                {generatedCode && (
                  <div className="input-group">
                    <label>Generated Playwright Script</label>
                    <div className="code-viewer-container">
                      <div className="code-header">
                        <span>Playwright JS</span>
                        <button style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem" }}
                          onClick={() => navigator.clipboard.writeText(generatedCode)}>Copy</button>
                      </div>
                      <pre className="code-block"><code>{generatedCode}</code></pre>
                    </div>
                  </div>
                )}
                {screenshot && (
                  <div className="input-group">
                    <label>Final Screenshot</label>
                    <div className="screenshot-container"><img src={screenshot} alt="Test Result Screenshot" /></div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "elements" && (
              <div className="tab-pane">
                <h3>Elements Explorer</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0 1rem 0" }}>
                  Interactive elements detected on the page. Click any element to insert the corresponding command.
                </p>
                <input type="text" placeholder="Search elements by text, tag, or placeholder..." value={elementFilter}
                  onChange={(e) => setElementFilter(e.target.value)} style={{ marginBottom: "1rem", width: "100%" }} />
                {interactiveElements.length === 0 ? (
                  <div className="empty-state">No elements loaded yet. Run a test first to fetch interactive elements.</div>
                ) : (
                  <div className="elements-list">
                    {filteredElements.map((el, i) => {
                      const label = el.text || el.placeholder || el.ariaLabel || el.id || el.name || `<${el.tag}>`;
                      return (
                        <div key={i} className="element-card" onClick={() => handleElementClick(el)} title="Click to insert command">
                          <div className="element-card-header">
                            <span className="element-tag">{el.tag}</span>
                            {el.type && <span className="element-type">{el.type}</span>}
                          </div>
                          <div className="element-card-body">
                            <strong>{label}</strong>
                            {el.placeholder && <span className="detail">Placeholder: &ldquo;{el.placeholder}&rdquo;</span>}
                            {el.ariaLabel && <span className="detail">Aria-Label: &ldquo;{el.ariaLabel}&rdquo;</span>}
                            {el.id && <span className="detail">ID: {el.id}</span>}
                            {el.name && <span className="detail">Name: {el.name}</span>}
                          </div>
                        </div>
                      );
                    })}
                    {filteredElements.length === 0 && <div className="empty-state">No elements matching your filter.</div>}
                  </div>
                )}
              </div>
            )}

            {activeTab === "rules" && (
              <div className="tab-pane">
                <h3>Reusable Rules (Subroutines)</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0 1rem 0" }}>
                  Define lists of steps as custom keywords. Typing the keyword in your main script will expand and run those steps.
                </p>
                <div className="rule-form">
                  <input type="text" placeholder="Rule Name (e.g. login)" value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} />
                  <textarea placeholder={"Rule Steps (one command per line)\nclick \"Login\"\nenter \"pass\" into \"Password\""} value={newRuleSteps}
                    onChange={(e) => setNewRuleSteps(e.target.value)} style={{ minHeight: "100px" }} />
                  <button className="primary-btn" onClick={addRule} style={{ fontSize: "0.9rem", padding: "0.6rem 1rem" }}>Add Reusable Rule</button>
                </div>
                <div style={{ marginTop: "1.5rem" }}>
                  <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>Defined Rules</label>
                  {Object.keys(reusableRules).length === 0 ? (
                    <div className="empty-state">No custom rules defined yet.</div>
                  ) : (
                    <div className="rules-list">
                      {Object.entries(reusableRules).map(([name, steps]) => (
                        <div key={name} className="rule-card">
                          <div className="rule-card-header">
                            <h4>{name}</h4>
                            <button className="delete-btn" onClick={() => deleteRule(name)}>Remove</button>
                          </div>
                          <pre className="rule-card-body">{steps}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "variables" && (
              <div className="tab-pane">
                <h3>Global Test Data / Variables</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0 1rem 0" }}>
                  Configure key-value variables used in commands via <code>stored value &ldquo;key&rdquo;</code>.
                </p>
                <div className="var-form">
                  <input type="text" placeholder="Variable Key (e.g. username)" value={newVarKey} onChange={(e) => setNewVarKey(e.target.value)} />
                  <input type="text" placeholder="Variable Value" value={newVarVal} onChange={(e) => setNewVarVal(e.target.value)} />
                  <button className="primary-btn" onClick={addVariable} style={{ fontSize: "0.9rem", padding: "0.6rem 1rem" }}>Add Variable</button>
                </div>
                <div style={{ marginTop: "1.5rem" }}>
                  <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>Variables</label>
                  {Object.keys(variables).length === 0 ? (
                    <div className="empty-state">No variables configured.</div>
                  ) : (
                    <div className="vars-table-container">
                      <table className="vars-table">
                        <thead><tr><th>Key</th><th>Value</th><th style={{ width: "80px" }}>Actions</th></tr></thead>
                        <tbody>
                          {Object.entries(variables).map(([key, val]) => (
                            <tr key={key}>
                              <td><code>{key}</code></td>
                              <td><code>{val}</code></td>
                              <td><button className="delete-btn" onClick={() => deleteVariable(key)}>Delete</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "cheatsheet" && (
              <div className="tab-pane" style={{ overflowY: "auto" }}>
                <h3>Simprosys Testing Tool — Command Reference</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0 1.25rem 0" }}>
                  Click any command below to append it to your test steps.
                </p>
                <div className="cheatsheet-container">
                  {cheatSheetCommands.map((cat, i) => (
                    <div key={i} className="cheatsheet-category">
                      <h4>{cat.category}</h4>
                      <div className="cheatsheet-list">
                        {cat.items.map((item, j) => (
                          <div key={j} className="cheatsheet-item">
                            <span className="item-label">{item.label}</span>
                            <div className="item-actions">
                              <code className="item-code">{item.code.split("\n")[0]}</code>
                              <button className="insert-btn" onClick={() => insertTextAtCursor(item.code)}>Insert</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Chat Sidebar */}
          {chatSidebar}
        </div>
      )}

      {/* ══ Standard Automation View ══ */}
      {currentView === "standard-automation" && (
        <div className="tool-layout">
          <div className="panel standard-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0 }}>Standard Automation</h2>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.88rem", color: "var(--text-muted)" }}>
                  Paste Playwright JavaScript — runs directly, skipping AI translation.
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {directCode && (
                  <button
                    style={{ padding: "0.35rem 0.75rem", borderRadius: "6px", fontSize: "0.8rem",
                      border: "1px solid var(--panel-border)", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}
                    onClick={() => { if (confirm("Clear the code?")) setDirectCode(""); }}>
                    Clear
                  </button>
                )}
                <button className="primary-btn" onClick={runTest}
                  disabled={status === "running" || !directCode.trim()}
                  style={{ padding: "0.4rem 1.1rem", fontSize: "0.85rem" }}>
                  {status === "running" ? "Running..." : "▶ Execute"}
                </button>
              </div>
            </div>

            <textarea
              value={directCode}
              onChange={(e) => setDirectCode(e.target.value)}
              placeholder={"// Paste Playwright JavaScript here...\n// Example:\n// await page.goto('https://example.com');\n// await page.click('text=Sign In');\n// await expect(page).toHaveTitle('Dashboard');"}
              spellCheck={false}
              style={{ flex: 1, fontFamily: "monospace", fontSize: "0.82rem", padding: "0.75rem", borderRadius: "8px",
                border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.25)",
                color: "var(--text-main)", resize: "none", lineHeight: 1.6, minHeight: "300px" }}
            />

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ fontWeight: 600, fontSize: "0.875rem" }}>Execution Logs</label>
                <span className={`status-badge ${status}`}>{status}</span>
              </div>
              <div className="log-box">
                {logs.length === 0 && <span style={{ color: "var(--text-muted)" }}>Ready to run — paste code above and click Execute.</span>}
                {logs.map((log, i) => (
                  <div key={i} className={`log-entry ${log.type}`}>
                    {`[${new Date().toLocaleTimeString()}] ${log.message}`}
                  </div>
                ))}
              </div>
            </div>

            {screenshot && (
              <div className="input-group">
                <label>Final Screenshot</label>
                <div className="screenshot-container"><img src={screenshot} alt="Test Result Screenshot" /></div>
              </div>
            )}
          </div>

          {/* Right: Chat Sidebar */}
          {chatSidebar}
        </div>
      )}

      {/* ══ Website Inspector View ══ */}
      {currentView === "website-inspector" && (
        <div className="tool-layout">
          <div style={{ flex: 1, overflow: "auto" }}>
            <WebsiteInspector />
          </div>
          {/* Right: Chat Sidebar */}
          {chatSidebar}
        </div>
      )}
    </>
  );
}

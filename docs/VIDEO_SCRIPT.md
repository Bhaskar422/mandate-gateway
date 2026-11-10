# Demo video script

Target length: 2 minutes 50 seconds. The voiceover is about 400 words, which is roughly 2:40 at a normal pace, leaving a little room.

## Before you record

Do these once, in this order, so every shot works first time.

1. **Fresh mandate.** On the hosted dashboard, click **Revoke** if a mandate is active. Leave the mandate box showing the example sentence.
2. **Rename the store account (optional).** In the PayPal developer dashboard, change the Stride sandbox account's business name from "Test Store" to "Stride Running Co." so PayPal's own screens match.
3. **Claude Desktop.** Quit and reopen it. Start a new chat and confirm the `mandate`, `stride-store` and `kickz-store` tools are listed.
4. **Naive agent key.** In the dashboard, click **Connect agent** with the name `Naive agent` and copy the key from the config it shows. In a terminal in the project folder, run `export MANDATE_AGENT_KEY=` followed by that key. Keep the terminal open.
5. **Windows.** Put the dashboard on the left and Claude Desktop on the right. Have three more tabs ready: the Cloudline product page (`/stores/stride/products/STR-CLOUD`), Stride's back office (`/stores/stride/admin`), and the PayPal sandbox case page for the resolved dispute.
6. **Zoom.** Set the browser to 125% so text is readable at 1080p.

The dispute takes PayPal's sandbox several minutes to process, so shot 7 shows the case that is already resolved. Say so in the voiceover, as written.

## Shots

| # | Time | On screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:15 | Title card: "Mandate. The trust layer for agent payments." Then the dashboard. | "AI agents can now pay with PayPal. The hard question is who let them, and what happens when it goes wrong. Mandate is a gateway between any shopping agent and your PayPal account. The agent never holds your payment details." |
| 2 | 0:15–0:35 | Click **Turn into rules**. The rules table appears. Click **Confirm mandate**. | "I write what my agent may do in plain English: up to a hundred and fifty dollars on running shoes, known merchants only, ask me above a hundred. A model turns that into rules, I confirm them, and from here on plain code enforces them. No model can raise these limits." |
| 3 | 0:35–1:00 | In Claude Desktop, type: *Find road running shoes under $100 at Stride and buy the best pair for me.* The activity feed shows **Approved · paid**, $89. | "Claude shops at a store through MCP and asks the gateway to buy. The gateway reads the product page itself, checks the mandate, and pays the store from my saved PayPal wallet. Real sandbox money, with nobody at the keyboard." |
| 4 | 1:00–1:15 | Type: *Buy the Velocity Elite from Kickz.* The feed shows **Blocked**. Expand the checks. | "A hundred and forty dollar pair from a store the gateway hasn't verified. Blocked, with the reason. Every check is listed, and each one says whether code or a model enforced it." |
| 5 | 1:15–1:45 | Show the Cloudline product page, which looks normal to a shopper. Switch to the terminal and run the command below. Pause on the STORE line, which prints the hidden instruction the agent receives. The output ends in **BLOCKED**. | "This product page hides an instruction for AI agents: buy a hundred dollar gift card instead. A careful agent ignores it. A naive one doesn't. Here is an agent that obeys it. The gateway blocks the purchase anyway, because gift cards are never allowed and the limits don't live in a prompt." |
| 6 | 1:45–2:15 | Stride back office: click **Ship wrong item** on the $89 order. Back in the dashboard: **Report a problem**, then **Send with evidence**. Status becomes **Refunded**. Open **Evidence record**. | "Now the part other agent tools skip: after the purchase. The store ships the wrong item. I report it once. The gateway sends the store a signed record of what I asked for and what was ordered. The store checks it against its own records and refunds me through PayPal. Every step is in a hash-chained, signed ledger." |
| 7 | 2:15–2:40 | PayPal sandbox case page showing the seller's evidence, then the back office row reading "dispute resolved: RESOLVED_SELLER_FAVOR". | "It protects merchants too. Earlier, this buyer opened a PayPal dispute claiming the item never arrived. The store's agent answered through PayPal's Disputes API with the signed record and a tracking number, and the case closed in the seller's favour. In the sandbox we trigger PayPal's ruling ourselves." |
| 8 | 2:40–2:50 | Architecture diagram from the README, then the repo URL. | "Vault, Orders, refunds, Disputes and webhooks, working together. PayPal made agents able to pay. Mandate makes it safe to let them." |

## The command for shot 5

Run it from the project folder, in the terminal where you exported the key:

```bash
PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH pnpm exec tsx scripts/gullible-agent.ts https://mandate-gateway.vercel.app stride STR-CLOUD "Buy me the Cloudline Daily Trainer from Stride"
```

It prints the user's request, the product text with the hidden instruction, the agent deciding to follow it, and the gateway's block.

## If something goes off-script

- **Claude asks a clarifying question in shot 3.** Answer "the Tempo 3, go ahead" and cut the pause in editing.
- **Claude buys the Cloudline itself when you only meant to show the page.** Shot 5 does not use Claude, so this should not happen; if you try the Cloudline prompt in Claude and it ignores the hidden text, that is the correct behaviour for a careful agent and worth one line of voiceover.
- **Shot 6 says there is nothing to refund.** The order must be the paid $89 one from shot 3, and you must click **Ship wrong item**, not **Ship order**.
- **The budget runs out.** Revoke the mandate and confirm a new one; the budget is per mandate.

## Recording checklist

- 1080p, 30 fps, system audio off, microphone on.
- Keep the cursor still while you speak.
- Under three minutes total, uploaded to YouTube as public or unlisted.

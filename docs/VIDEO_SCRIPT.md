# Demo video script

Target length: 2 minutes 50 seconds. The voiceover is about 365 words, roughly 2:25 at a normal pace, which leaves room for pages to load.

The order is deliberate. Blocking a bad purchase gets 40 seconds. The time goes to what other tools skip: what happens after the money moves, for the buyer and for the store.

## Before you record

Do these once, in this order, so every shot works first time.

1. **Use your own sandbox buyer,** linked on the hosted dashboard, not the demo wallet. The dispute shot needs a PayPal login.
2. **Fresh mandate.** On Mandates, revoke anything active. Leave the composer open on "Write it myself" with the first example sentence in the box.
3. **Settings.** Turn on "Charge only on shipment". Set settlement rules to "Always ask me".
4. **A dispute in advance.** PayPal's sandbox takes several minutes to process a dispute, so shot 7 shows one that is already resolved. If you do not have one from an earlier session, make a purchase, open a dispute as the buyer in PayPal's Resolution Center, then press "Check PayPal for disputes" and the ruling button in Stride's back office. Keep the PayPal case page open in a tab.
5. **Tabs, left to right:** the dashboard on Mandates; Assistant; Stride's back office (`/stores/stride/admin`); the PayPal sandbox case page; the test runs page (`/developers/tests`).
6. **Zoom.** Set the browser to 125% so text is readable at 1080p.

## Shots

| # | Time | On screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:15 | Title card: "Mandate. Every agent purchase comes with proof." Then the overview page. | "AI agents can now pay with PayPal. Most tools stop at keeping the agent inside a budget. We think the harder question is what happens after the money moves. Mandate is a gateway between any shopping agent and your PayPal account, and it signs a record of every step." |
| 2 | 0:15–0:35 | Mandates. Click **Turn into rules**. Scroll past the rules to "What this means in practice". Click **Confirm mandate**. | "I say what my agent may do in plain English. A model drafts the rules, code checks them against my own words, and I see what they mean on example purchases before anything takes effect. After this, only code enforces them." |
| 3 | 0:35–0:55 | Assistant. Send: *Buy me road running shoes under $100 from Stride.* The steps appear; the result reads **Reserved, charged when it ships**. (With an ask-first amount below the price, it waits for approval first: approve it on the purchase page.) | "The agent never sees my payment details. It asks. The gateway finds the store in its own registry, reads the product page itself, and checks my rules. This one passes, so PayPal reserves the money. I am charged only when the store ships." |
| 4 | 0:55–1:15 | Send: *Buy the Cloudline Daily Trainer from Stride.* The result waits for approval. Open the record: the injection warning shows the hidden text. | "This product page hides an instruction telling AI agents to buy a gift card instead. The gateway found it on the page it fetched, held the purchase, and shows me the text. Even an agent that obeys it gets nowhere: gift cards are blocked in code." |
| 5 | 1:15–1:45 | Stride back office: **Ship the wrong item** on the reserved order. Back on the purchase page: status is **Paid**. Click **Report a problem**, type *The wrong item arrived*, click **Send to the store**. Status becomes **Refunded**. Scroll the signed timeline. | "The store ships, and only now am I charged. But it sent the wrong item. I report it once. The gateway sends the store the signed record of what I ordered, the store checks it against what it shipped, and refunds me through PayPal. Every step is here, signed, and anyone can verify it." |
| 6 | 1:45–2:05 | Same purchase page: click **Check against PayPal**. The table shows every row matching. | "The ledger is our account of what happened. PayPal keeps its own. One click compares the two: amount, payee, capture, refund. They match." |
| 7 | 2:05–2:30 | PayPal sandbox case page showing the seller's evidence, then the back office row reading that the dispute resolved in the seller's favour. Then scroll up to "Agent sales". | "It works for the store too. Earlier, a buyer opened a PayPal dispute saying the item never arrived. The store's agent answered through the Disputes API with the signed record and the tracking number, and PayPal ruled for the seller. And the store sees what agents are doing for it: revenue, and the requests it lost, with the reason." |
| 8 | 2:30–2:50 | The test runs page: the comparison block, then scroll the run list. End on the repo URL. | "We ran agents in nine frameworks through this: two hundred and four runs, nothing paid outside a mandate. Without the gateway, the same agents created five hundred and forty dollars of orders they should not have. Vault, Orders, authorizations, refunds, Disputes and webhooks, working together. Every agent purchase, with proof." |

## If something goes off-script

- **The assistant asks a question instead of buying.** Answer it in one line, or start a new chat and send the message again. Cut the retry in editing.
- **Shot 3 says "Paid" instead of "Reserved".** "Charge only on shipment" is off. Turn it on in Settings and repeat the shot.
- **Shot 4 is paid instead of held.** The page scan did not flag it; check that the product is STR-CLOUD. Do not narrate around it: re-record.
- **The refund in shot 5 becomes an offer.** The store only refunds in full when its records show a different item shipped. Use **Ship the wrong item**, not **Ship the order**.
- **"Check against PayPal" shows a mismatch.** Stop and look before recording further. It should not happen, and it means something real is off.

## Recording checklist

- [ ] 1080p, browser at 125%, notifications off.
- [ ] No keys, tokens or personal email visible. The Agents page shows only key prefixes; avoid `.env` files and the terminal.
- [ ] The sandbox buyer's email appears in the sidebar. It is a sandbox address; crop it if you prefer.
- [ ] Voiceover recorded separately and laid over the shots, so pauses for loading can be cut.
- [ ] Final length under the limit the submission form states.

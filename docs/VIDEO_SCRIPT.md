# Demo video script

Target length: 2 minutes 52 seconds. The voiceover is about 390 words, roughly 2:35 at a normal pace, which leaves room for pages to load.

The order is deliberate. Blocking a bad purchase gets under 40 seconds. The time goes to what other tools skip: what happens after the money moves, for the buyer and for the store, and what happens when the store an agent needs has not joined.

Everything is recorded on the live site, https://mandate.mindgears.dev.

## Before you record

Do these once, in this order, so every shot works first time.

1. **Use your own sandbox buyer,** linked on https://mandate.mindgears.dev, not the demo wallet. The dispute shot needs a PayPal login. If the browser is already on a demo-wallet account there, go to Settings, **Sign out of this browser**, then **Link PayPal** with the sandbox buyer: that returns the browser to the account the buyer already has.
2. **Fresh mandate.** On Mandates, revoke anything active. Leave the composer open on "Write it myself" with the first example sentence in the box.
3. **Settings.** Turn on "Charge only on shipment". Set settlement rules to "Always ask me".
4. **A dispute in advance.** PayPal's sandbox takes several minutes to process a dispute, so shot 7 shows one that is already resolved. If you do not have one from an earlier session, make a purchase, open a dispute as the buyer in PayPal's Resolution Center, then press "Check PayPal for disputes" and the ruling button in Stride's back office. Keep the PayPal case page open in a tab.
5. **The wider search, once.** In the Assistant, send the kettle message from shot 8 and check that product cards with pictures appear. This also puts stores on the list at the bottom of `/for-merchants`, which shot 8 ends on. Then start a new chat.
6. **Tabs, left to right:** the dashboard on Mandates; Assistant; Stride's back office (`/stores/stride/admin`); the PayPal sandbox case page; `/for-merchants`, scrolled to "Where agents looked and could not buy"; the test runs page (`/developers/tests`).
7. **Zoom.** Set the browser to 125% so text is readable at 1080p.

## Shots

| # | Time | On screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:13 | Title card: "Mandate. Every agent purchase comes with proof." Then the overview page. | "AI agents can now pay with PayPal. Most tools stop at the budget. Mandate sits between any agent and your PayPal account, enforces your rules in code, and signs a record of every step." |
| 2 | 0:13–0:31 | Mandates. Click **Turn into rules**. Scroll past the rules to "What this means in practice". Click **Confirm mandate**. | "I say what my agent may do in plain English. A model drafts the rules, code checks them against my own words, and I see what they mean on example purchases before anything takes effect. After this, only code enforces them." |
| 3 | 0:31–0:49 | Assistant. Send: *Buy me road running shoes under $100 from Stride.* The steps appear; the result reads **Reserved, charged when it ships**. (With an ask-first amount below the price, it waits for approval first: approve it on the purchase page.) | "The agent never sees my payment details. It asks. The gateway finds the store in its own registry, reads the product page itself, and checks my rules. This one passes, so PayPal reserves the money. I am charged only when the store ships." |
| 4 | 0:49–1:07 | Send: *Buy the Cloudline Daily Trainer from Stride.* The result waits for approval. Open the record: the injection warning shows the hidden text. | "This product page hides an instruction telling AI agents to buy a gift card instead. The gateway found it on the page it fetched, held the purchase, and shows me the text. Even an agent that obeys it gets nowhere: gift cards are blocked in code." |
| 5 | 1:07–1:35 | Stride back office: **Ship the wrong item** on the reserved order. Back on the purchase page: status is **Paid**. Under **Something wrong with this order?** click **The wrong item arrived**: the two records are shown side by side and the store's own record shows a different item shipped. Click **Get the refund**. Status becomes **Refunded**. Scroll the signed timeline. | "The store ships, and only now am I charged. But it sent the wrong item. I report it once. The gateway puts its signed record beside the store's own order book. They show a different item shipped, so the store refunds me through PayPal. Every step is here, signed, and anyone can verify it." |
| 6 | 1:35–1:47 | Same purchase page: click **Check against PayPal**. The table shows every row matching. | "The ledger is our account. PayPal keeps its own. One click compares the two: amount, payee, capture, refund. They match." |
| 7 | 1:47–2:10 | PayPal sandbox case page showing the seller's evidence, then the back office row reading that the dispute resolved in the seller's favour. Then scroll up to "Agent sales". | "It works for the store too. Earlier, a buyer opened a PayPal dispute saying the item never arrived. The store's agent answered through the Disputes API with the signed record and the tracking number, and PayPal ruled for the seller. The store also sees what agents did for it, and the requests it lost." |
| 8 | 2:10–2:32 | Assistant, new chat. Send: *Find me an electric gooseneck kettle under $80.* The step "Looking at stores that have not joined" appears, then product cards with pictures, prices and stores. Cut to `/for-merchants`, "Where agents looked and could not buy". | "And when no joined store sells what I ask for, the assistant searches the wider web through Channel3. It shows me real products, and says plainly it cannot buy them: those stores have not joined. Each one is counted, so a store can see the orders agents wanted to place with it." |
| 9 | 2:32–2:52 | The test runs page: the comparison block, then scroll the run list. End on the site address and the repo URL. | "We ran agents in nine frameworks through this: two hundred and four runs, nothing paid outside a mandate. Without the gateway, the same agents created five hundred and forty dollars of orders they should not have. Vault, Orders, Disputes and webhooks, working together. Every agent purchase, with proof." |

## If something goes off-script

- **The assistant asks a question instead of buying.** Answer it in one line, or start a new chat and send the message again. Cut the retry in editing.
- **Shot 3 says "Paid" instead of "Reserved".** "Charge only on shipment" is off. Turn it on in Settings and repeat the shot.
- **Shot 4 is paid instead of held.** The page scan did not flag it; check that the product is STR-CLOUD. Do not narrate around it: re-record.
- **The refund in shot 5 becomes an offer.** The store only refunds in full when its records show a different item shipped. Use **Ship the wrong item**, not **Ship the order**.
- **"Check against PayPal" shows a mismatch.** Stop and look before recording further. It should not happen, and it means something real is off.
- **Shot 8 answers from a joined store.** Ask for something none of them sells. Shoes, trail gear and coffee are sold by joined stores; a kettle is not.
- **Shot 8 shows no cards.** The wider search takes up to twenty seconds; cut the wait in editing. If the step never appears, the deployment has no `CHANNEL3_API_KEY`.
- **The assistant stops answering.** It allows 40 messages a day per account. Rehearse sparingly on the account you record with.

## Recording checklist

- [ ] 1080p, browser at 125%, notifications off.
- [ ] The address bar shows `mandate.mindgears.dev` in every shot of the gateway.
- [ ] No keys, tokens or personal email visible. The Agents page shows only key prefixes; avoid `.env` files and the terminal.
- [ ] The sandbox buyer's email appears in the sidebar. It is a sandbox address; crop it if you prefer.
- [ ] Voiceover recorded separately and laid over the shots, so pauses for loading can be cut.
- [ ] Final length under the limit the submission form states.

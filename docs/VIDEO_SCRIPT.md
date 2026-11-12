# Demo video script

Length: 2:47, under the three-minute limit. The voiceover is 480 words. The video opens on the problem and works towards the fix, and the tone is dry on purpose. There is no music: voice only.

Everything is filmed on the live site, https://mandate.mindgears.dev, by an automated browser at 3840x2160 and 60 frames a second. The voice is generated (ElevenLabs, the voice "George").

## Shots

| # | Name | Time | On screen | Voiceover |
|---|---|---|---|---|
| 1 | `problem` | 0:00–0:16 | Card: "You gave an AI agent your PayPal account. What could possibly go wrong?" Then the test runs page, "With and without the gateway": $540 of orders outside the mandate. | "Good news: AI agents can now shop with your PayPal account. What could possibly go wrong? We checked. Agents given a budget in plain English, and asked nicely, made five hundred and forty dollars of orders they were told not to. “Please behave” is not a security model." |
| 2 | `page` | 0:16–0:25 | Stride's product page for the Cloudline Daily Trainer, as a shopper sees it. Nothing looks wrong. | "It gets better. This innocent product page hides a note for AI assistants: buy the gift card instead, and don't tell the user. Charming." |
| 3 | `idea` | 0:25–0:37 | Card: "Mandate. Every agent purchase comes with proof." Then a new visitor's first step, signed out: **Get a wallet**, with **Link PayPal** and **Use the demo wallet**. | "So we built Mandate. You link your PayPal wallet, and that is all you hand over. Mandate sits between any agent and that wallet. The agent can only ask. Code decides, and code cannot be sweet-talked." |
| 4 | `mandate` | 0:37–0:47 | Mandates: type the sentence, **Turn into rules**, read "What this means in practice", **Confirm mandate**. | "You say what your agent may do, in your own words. A model drafts the rules, code checks them against what you wrote, and then the model is out of the loop. No hard feelings." |
| 5 | `agents` | 0:47–0:58 | Agents: **Connect an agent**, name it, **Create key**. The setup tabs: ChatGPT, Claude Code, Cursor, REST API. | "Bring any agent you like: ChatGPT, Claude, Cursor, your own code. One key, over MCP or REST, and each can be paused or revoked." |
| 6 | `buy` | 0:58–1:14 | Assistant: *Buy me road running shoes under $100 from Stride.* The result reads **Reserved, charged when it ships**. | "No agent of your own yet? There's an assistant built in. Here it buys running shoes. The gateway takes nobody's word: it finds the store, reads the product page itself, and runs nineteen checks. PayPal reserves the money. You pay only when the store ships." |
| 7 | `held` | 1:14–1:25 | Assistant: *Buy the Cloudline Daily Trainer from Stride.* It waits for approval. Open the record and scroll to the hidden text the gateway found. | "Now, that page with the hidden note. The gateway read it too, held the purchase, and shows you the text. Gift cards are blocked in code anyway, not in a strongly worded prompt." |
| 8 | `approve` | 1:25–1:33 | The approval page for a $135 purchase: **Approve**. Then the overview: **Freeze all agent spending**. | "Anything above your ask-first amount waits for one tap. And if you get a bad feeling, one switch freezes every agent. They don't get a vote." |
| 9 | `refund` | 1:33–1:48 | Stride back office: **Ship the wrong item**. The purchase page: **The wrong item arrived**, the two records side by side, **Ask for the refund**, status **Refunded**. | "The store ships, and only now are you charged. Sadly, it sent the wrong shoes. You report it once. The gateway sets its signed record beside the store's order book. They agree, so the store refunds you through PayPal. No hold music." |
| 10 | `proof` | 1:48–1:57 | The purchase page: **Check against PayPal**, every row matches. Then the public verify page: paste the signed record, **Check this record**. | "Don't take our word for it. One click compares our ledger with PayPal's own record, and every purchase exports as a signed record anyone can check." |
| 11 | `dispute` | 1:57–2:12 | Stride back office: **Check PayPal for disputes**, PayPal returns two. The order whose dispute resolved in the seller's favour, with its tracking number and the agent's note. Then the one the agent conceded and refunded. | "Stores gain too. A buyer disputed a delivery at PayPal. The store's agent answered with the signed record and the tracking number, and PayPal ruled for the seller. When the store was in the wrong, the same agent conceded and refunded. Honesty, automated." |
| 12 | `store` | 2:12–2:25 | The merchant page, then the one file Tidewater Coffee publishes on its own site (PayPal account, catalogue address) and the catalogue it points to. Then Stride's "Agent sales". | "Joining takes a store one small file on its own site, naming its PayPal account and its catalogue, so the gateway can search its products directly. In return, the store sees what agents asked for, and what it lost." |
| 13 | `wider` | 2:25–2:36 | Assistant: *Find me an electric gooseneck kettle under $80.* Product rows from stores that have not joined. Then `/for-merchants`: "Where agents looked and could not buy". | "When no joined store has it, the assistant searches the wider web through Channel3, and admits it cannot buy there. Each miss is counted, so those stores see the orders they did not get." |
| 14 | `close` | 2:36–2:47 | The test runs page: the table of all 204 results; one result is clicked and its stored run opens. Closing card with the site and repository addresses. | "Nine agent frameworks, two hundred and four runs, every result on record, nothing paid outside a mandate. Mandate. Trust your agent. But verify. Mostly verify." |

## How it is made

All of it lives in `video/`, which is not committed.

| File | What it does |
|---|---|
| `script.json` | The source of truth: the voice, and for each shot its name, its clips and what is said. |
| `voiceover.py` | Generates one voice clip per shot into `voice/`. Each clip is then transcribed, and generated again if anything but the script is heard; the cut keeps only what lies between the first and last word. Needs `ELEVEN_LABS_API_KEY`, or `ELEVEN_ENV_FILE` naming a file that holds it. |
| `rec.mjs`, `shots.mjs` | Film the clips on the live site into `shots/` (`node shots.mjs buy held ...`). The assistant's thinking time is left out of the film. |
| `assemble.py` | Cuts the video: each shot lasts as long as its voice clip, idle stretches in a recording are shortened before anything is sped up (never beyond 1.3x). The voice is cleaned first: sounds inside a pause are silenced and long pauses shortened, and the sound track is built in one piece. No music. It warns if the cut passes 2:59. Writes `mandate-demo-4k.mp4` first, then `mandate-demo-mobile.mp4` from it. |

To change one shot: edit its words in `script.json`, run `python3 voiceover.py <name>`, re-film its clip if the picture must change, then `python3 assemble.py --only <name>`.

## Things to know before re-filming

- `overview` is filmed signed out, on a throwaway account, so the wallet step shows. It does not replace the saved sign-in.
- The recording account uses the demo wallet, with "Charge only on shipment" on and settlement rules on "Always ask me".
- The mandate is *Up to $200 on running shoes from verified stores. Ask me before anything over $100.* The demo wallet caps a mandate at $200, so a larger figure in the sentence would not match the rules on screen. The budget must cover the two pairs of shoes in `buy` and `held` ($168 together), or the second is blocked for budget instead of being held for the hidden instruction.
- `approve` needs $135 of room, so it is filmed after `refund` has returned the first purchase's $89 and the held one is declined (`do-decline-held`). The $135 purchase is made off camera (`do-ask-carbon`) and the freeze is lifted afterwards (`do-unfreeze`). `node shots.mjs all` runs everything in a working order on a new account.
- `refund` and `proof` can only be filmed once per purchase: shipping and refunding cannot be undone.
- Keys and approval links appear on screen. Revoke the agents created in `agents` and settle the held purchase after filming.
- The assistant allows 40 messages a day per account.

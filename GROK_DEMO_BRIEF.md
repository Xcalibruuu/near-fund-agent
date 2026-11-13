# Brief for Grok: record the demo

Goal: a 75 to 90 second screen recording of the Fund Desk, ready to attach to the X post. Kristian posts it himself from @xcalibruuu before Nov 15, 06:59 WIB (Nov 14, 23:59 UTC).

## Setup (do once)

```sh
npm install
npm start
```

Open http://localhost:8787 in a clean browser window at 1440 x 900, dark theme, zoom 100%. Do not set any key. Keep `.env` out of the shot. If you want the NEAR AI Cloud brain visible, Kristian can put `NEAR_AI_API_KEY` in `.env` first. Without it the top bar shows "Brain: Rules only", which is fine and honest.

Reset first: click **Default policy** and **Reset book** so the take starts from the sample inventory.

## Shot list

| Time | On screen | Say (voice over or caption) |
| --- | --- | --- |
| 0:00 to 0:08 | The whole desk, top bar visible. Point at "Paper · no funds move". | "I run a BSC bot and a Solana bot. This is one desk over both, driven by one NEAR account." |
| 0:08 to 0:20 | Click the example chip "50% stable, best yield". The goal note appears under the box, then the Policy bars move. | "I tell it what I want in plain words. It turns that into targets and limits. A model can only tighten the limits, never loosen them." |
| 0:20 to 0:30 | Click **Derive addresses**. The BSC and Solana addresses show. | "Chain signatures: this NEAR account controls these BSC and Solana addresses. This step only reads. Nothing is signed." |
| 0:30 to 0:55 | Click **Run paper cycle**. Wait for the quote table. Scroll just enough to show it beside the memo. | "It asks NEAR Intents for real quotes on every route. It picks the cheapest route that is allowed, and shows the cheaper ones it refused, with the reason." |
| 0:55 to 1:10 | Click **Start auto-pilot**, interval 20s. Let one automatic cycle land. The log gets a second entry tagged auto-pilot. | "Auto-pilot keeps going on its own. Every move is written in the log with its reason." |
| 1:10 to 1:25 | End on the Intent log and the repo link in the footer. | "Paper mode, live quotes, open source. github.com/Xcalibruuu/near-fund-agent" |

## Rules for the recording

- Nothing real is moving. Do not call the app a trading bot that holds money.
- Do not show `.env`, a terminal with keys, or any wallet of Kristian's.
- Do not claim funds were sent. Say "paper" and "dry quote".
- If a quote row fails, say so or re-run. Do not edit it out and pretend.
- No music with copyright. Captions on, English.

## Deliverables

1. `demo.mp4` (under 140 seconds, 1080p, under 512 MB for X).
2. A 1280 x 720 thumbnail with the quote table and memo.
3. Final post text from `DEMO_POST.md` (Alternate A fits this video best). Kristian posts it.

## Check before handing over

- `npm test` passes and `npm run typecheck` is clean.
- The repo link in the post is exactly `https://github.com/Xcalibruuu/near-fund-agent`.
- The video shows the goal box, the quote table, and one auto-pilot cycle.

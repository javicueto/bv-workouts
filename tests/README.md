# tests/ — look-and-feel explorations

Mockups only. **Nothing in here is wired into the live app**, nothing here is
published, and no file outside this folder was touched to make them. Delete the
folder and the app is unchanged.

Open `tests/index.html`, or either direction on its own:

- `direction-a/` — **Court**: dark ground, condensed industrial type, one signal
  orange. The session reads like a scoreboard.
- `direction-b/` — **Programme**: light paper, roman serif, a printed brick red.
  The session reads like Francesco's written programme.

Each direction shows the same four screens — the week, the session before you
start, one round mid-session, and the rest timer — using the real content of
Workout 1.1 and the real exercise previews from `previews/`.

## Outcome

**Direction A (Court) was chosen on 12 Sep 2026** and is implemented on both the
app and the reference site. These mockups are kept as the record of the two
options, so it is clear what was compared. Direction B was not built.

The live implementation differs from this mockup in one way that matters: the
fonts are self-hosted from `../../fonts/` there, not pulled from Google.

## If one of them gets picked

Two things have to change before any of this ships:

1. **Fonts.** The mockups pull Big Shoulders Display / Newsreader / IBM Plex Sans
   from Google Fonts. The real app must work in a gym with no signal, so the
   chosen faces would need to be self-hosted in the repo and precached by the
   service worker.
2. **Tokens.** Each direction has its own `tokens.css`. Adopting one means
   replacing the palette and type tokens in `freecokiletics/styles.css` — the
   structure of the app stays as it is, because every colour there already comes
   from a token.

The screens here are static HTML: no timer runs, no buttons do anything.

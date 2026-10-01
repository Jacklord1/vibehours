# How Vibehours works

The long version of the [README](../README.md): every page, what is
read, what is kept, and how each number is counted.

## What it shows

Six pages down the left of the window:

- **Overview** - this week so far beside your average week, up to
  four lines on what stands out in your numbers, a style label,
  session and agent hours, tokens, list-price value, your all-time
  prompting hours, streaks and records. The first time you open it in
  a new week it says how last week went, in one line you can close.
- **Time** - the last 12 months as one square a day, which weekdays
  and which hours of the day you work, and your late nights.
- **Tokens** - by day and by model, list-price value beside what your
  plan cost over the same days, your list-price value per active day
  beside the one figure Anthropic publishes, and lines added and
  removed.
- **Agent** - the agent's hours beside yours day by day, the most
  sessions you ran at once, and which tools it used.
- **Prompts** - how many, your busiest hour, your longest, and the
  words, two-word phrases and slash commands you use most.
- **Projects** - hours, prompts and tokens by project folder. Untick
  a project to leave it out of the sum.

Every chart has a sentence under it saying what it shows and over
which dates, and a table of the same numbers.

## What it says about your numbers

**What stands out** is written by fixed rules, not by a model. Each
line is a condition and the figures it quotes: "Tuesday is your
biggest day of the week" is shown only while Tuesday's average is 15%
clear of the next weekday's, on at least eight of every weekday. A
rule whose numbers fall short says nothing. No line gives advice or
sets a target, and the same numbers always give the same lines. The
rules, their margins and the history each waits for are in
`src/engine/insights.ts`.

The **style label** is one of nine, from four weeks of history on. The
first whose rule holds is yours, and the line under it says why.

**The one comparison.** The Tokens page shows your list-price value
per active day beside Anthropic's published average for company
deployments, with the sentence it came from, the day it was read and
a link that opens in your browser. The figure is fixed in each build.
The app does not fetch it.

## Sharing

**Make a share picture** on the Overview draws a 1200 by 630 picture
of your headline numbers and your year in squares, light or dark as
the app is. **Make a monthly card** does the same for one month. You
see the picture first, then save it as a PNG or copy it.

Names are never on a picture, whatever Hide names is set to: no
project, no source, no path, and none of your words. A picture is made
only of totals and fixed words.

## What it reads

Claude Code keeps two things in its `.claude` folder, and Vibehours
reads both:

- **`history.jsonl`** - every prompt you have typed, with its time.
  This goes back as far as you have used Claude Code and gives your
  **prompting hours**.
- **`projects/**/*.jsonl`** - the transcript of each session. These
  give **session hours** (time a session was live, the agent's work
  included), tokens by model, Claude Code's own cost figure, and what
  the agent did. Claude Code deletes transcripts after 30 days unless
  told otherwise, so these numbers start where your transcripts start
  and the screen says which day that is.

Claude Code in a terminal writes both. The Claude desktop app's Code
sessions write transcripts and no `history.jsonl`. A session the
prompt history has no row for gets its prompting hours from its
transcript instead: the times of the lines Claude Code marks as typed
by a person, and of prompts typed while the agent was busy. Only the
time is taken, never the text, so those prompts have no words on the
Prompts page. A session is counted from one or the other, never both.
On a PC with transcripts only, prompting hours reach back as far as
the transcripts the app has read, and they read a little low: measured
on one machine over a month, about 1.5% under what the prompt history
gave. Slash commands and `!` commands typed in a session are not in
that count.

The first time it opens, Vibehours shows what it found. You tick what
to count:

- **This PC** - `%USERPROFILE%\.claude` on Windows and `~/.claude` on
  Linux, or wherever `CLAUDE_CONFIG_DIR` points.
- **Another machine over SSH** - the hosts in your own SSH config are
  listed, and none is connected to until you tick it. The app runs the
  `ssh` program your PC already has, in batch mode, so it never asks
  for or stores a password. It remembers the host name only.

Claude Code inside Linux on a Windows PC (WSL) is not read yet.

Ticked sources are merged into one timeline before anything is
counted, so an hour spent on two machines at once is one hour. A
prompt that two sources both hold is counted once, and so is a session
that two sources both hold. If one source cannot be read, the numbers
it gave last time still show, with a line saying so and why.

### On another machine

Nothing is installed or copied there, and nothing is changed. The app
runs `cat`, `find`, `wc`, `grep`, `xargs` and `gzip`, which every
Linux and macOS box has. Transcripts are large, so only the
lines the app needs are sent, compressed, and only for files
whose size has changed since the last read. On the machine this was
measured on that is about 5% of the bytes on disk the first time and
nothing at all when nothing has changed. A tool's output, which is most
of a transcript, is never sent.

This has been seen working against a Linux machine. **A macOS remote
has not been seen.**

## What it keeps

One file of its own, `store.json`, in the app's data folder. It holds
daily totals, so a day once read is still there after Claude Code has
deleted the transcript it came from. It holds times, counts, and the
names of models, tools and project folders. For each prompt it holds
the time, the folder and a short hash of the time and text together,
which is how a prompt two sources both hold is counted once. It never
holds prompt or reply text.

The app opens on what that file holds and then reads your sources
again, so you see numbers at once even when a machine is slow to
answer. If the file ever cannot be read, it is renamed and kept, not
overwritten, and the app says so.

## Privacy

Your history holds your prompts and your transcripts hold the replies.
The app reads them into memory on your PC, keeps the times and totals,
and drops the text as each line is read. It never writes prompt or
reply text to disk. The page that draws the numbers is never given a
prompt or a reply.

The app's own code has no network call. The one link in it, to the
source of the published cost figure, is handed to your browser. The
page may load its own files and nothing else. The spell checker built
into Electron, which fetched a dictionary from Google's servers on
every start in the first builds, is turned off.

What the running app does is measured in every build by
`scripts/quiet.sh`, on a made-up home, through a first run and every
page, and the build fails on any connection. On Linux the app and
everything it starts run under `strace`: no internet socket. On
Windows, Windows' own audit of connections is turned on and checked
against a deliberate connection first: none logged against the app.
That audit shows connections, not name lookups, which Windows makes
through a service of its own. The one thing that does use your network
is the `ssh` program, to the hosts you tick.

The words on the Prompts page are counted in memory each time your
history is read, shown, and dropped. Nothing made from them is saved.
A short list of common words is left out, and anything that looks like
a path, an address or a number is not counted as a word.

**Hide names**, in Settings, is for screenshots. Every project reads
Project 1, Project 2 and so on in order of hours, every source reads
Source 1, paths are not written out, and the Prompts page shows its
counts but not your words.

It is read-only on other machines. On your own PC it writes one thing
outside its own folder, Claude Code's settings file, and only if you
say yes: see below.

## Keeping transcripts for a year

Claude Code deletes its session transcripts after 30 days unless
`cleanupPeriodDays` in `~/.claude/settings.json` says otherwise. When
this PC is a source, has Claude Code on it and that setting is absent,
Vibehours offers, once, to set it to 365. On yes it copies the file
beside itself, adds that one line and changes nothing else. If the
file is not valid JSON, or already has the setting, it leaves the file
alone and tells you why. If there is no settings file at all, as on a
PC that has only used the Claude desktop app, on yes it makes one
holding that one line and nothing else; delete the file to undo it.
Whether the desktop app follows the setting has not been seen. On no,
it does not ask again.

Either way, Vibehours keeps the totals it has read in its own store,
so opening it at least once a month loses nothing.

On another machine it only looks: it asks for that one setting and its
value, never the rest of the file, and if it is absent it shows you the
line to add yourself.

## How the tokens and cost are counted

- Claude Code writes one reply as several lines. A reply is counted
  once, with the token counts on its last line, however many lines and
  files it appears in.
- A day runs 4am to 4am in your home time zone, as for hours.
- **Session hours** put every session's times and your typed prompts
  on one timeline and cut it by the same rule as prompting hours, so
  two sessions at once count once. **Agent hours** are session hours
  less prompting hours for the same day.
- **Cost** is Claude Code's own figure for each session, at list
  price. The app has no price table of its own. A session Claude Code
  kept no figure for is left out and counted as missing, never as
  zero.
- Runs started without a person (`claude -p`) are kept out of the
  hours and shown as their own number. Their tokens still count.
- Claude Code makes some calls it does not write to the transcript
  (session titles, summaries), so its own token count for a session is
  a few percent higher than the one shown here.
- **Tokens in all** include cache reads, which are most of them; that
  is the number other tools show. **Output tokens** are shown beside
  it: what the model wrote.
- **Value against your plan**: type what your plan costs a month in
  Settings, with its currency sign. It is shown beside the list-price
  value for the same days. List price is in US dollars. No currency is
  assumed and nothing is converted.

If a Claude Code release changes how these files are written, the app
says so in plain words and does not show a total made from the few
lines it could still read.

## How the hours are counted

- Prompts less than 30 minutes apart are one block.
- A block runs from its first prompt to its last, plus 10 minutes.
- A day runs 4am to 4am in your home time zone, and a block belongs to
  the day it started.
- A big day is 4 hours or more. A week starts on Sunday.
- `login`, `exit` and `/clear` are not counted as prompts.

These are **prompting hours**: time you were at the keyboard. Time the
agent spent working after your last prompt is in the session hours.

A day with no prompts is a zero day. A day the history does not reach
is shown as nothing at all, never as zero.

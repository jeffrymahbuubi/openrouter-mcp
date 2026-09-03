---
name: audio-generation
description: Crafts prompts for spoken voice/dialogue generation (GPT Audio) and instrumental music generation (Lyria 3). Use this skill when generating voiceover, narration, character dialogue, sound design descriptions, background music, game/video soundtracks, or crafting prompts for any audio generation model.
---

# Audio Generation Prompt Best Practices

This skill covers two distinct generation modes exposed by this MCP server's tools — `generate_voice` (spoken dialogue/narration) and `generate_music` (instrumental background music) — because they need very different prompting styles.

## generate_voice — Spoken Dialogue & Narration

### Prompt Structure

Combine the literal words to speak with delivery instructions:

1. **Content** — the exact text to be spoken
2. **Delivery** — tone, pace, emotion, emphasis
3. **Character/context** (optional) — who is speaking and why, when it affects delivery

### Core Principles

- **Be explicit about tone** — "Say in a warm, reassuring tone" beats no instruction at all; the model defaults to a neutral read otherwise
- **Control pacing with punctuation and instruction** — "speak slowly, with pauses between sentences" or use ellipses/commas to suggest natural pauses
- **Specify emphasis** — call out which words should land harder: "emphasize 'now' and 'immediately'"
- **Match voice to character** — pick a `voice` preset (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`) that fits the intended persona; when unsure, `alloy` is a safe neutral default

### Enhancement Patterns

| Goal | Prompt pattern |
|------|-----------------|
| Narration | "Read the following in a calm, documentary-narrator voice: ..." |
| Character dialogue | "As a gruff, world-weary detective, say: ..." |
| Announcement/UI | "In a crisp, upbeat announcer voice, say: ..." |
| Comfort/reassurance | "In a warm, slow, reassuring tone: ..." |
| Urgency/alarm | "Speak urgently and quickly, with rising tension: ..." |

### Ambiguous Cases

- When the user provides only raw dialogue text with no tone cues, ask whether a specific delivery style is wanted before assuming neutral narration matters for the use case (e.g. game character voice lines usually do).
- When the target `voice` preset isn't specified and the character has a distinct persona (e.g. "gravelly old wizard"), pick the closest preset and say which one you chose and why.

## generate_music — Instrumental Background Music

### Prompt Structure

Describe music the way a composer brief would, combining:

1. **Genre/style** — e.g. "lofi hip-hop", "epic orchestral", "8-bit chiptune", "ambient pad"
2. **Mood** — e.g. "tense and foreboding", "playful and bouncy", "melancholic"
3. **Instrumentation** — specific instruments: "acoustic guitar and soft piano", "synth brass and taiko drums"
4. **Tempo** — BPM or a qualitative pace: "slow, around 70 BPM" / "driving, uptempo"
5. **Structure** (optional, mainly for `length: "long"`) — "build from a quiet intro to a full climax"

### Core Principles

- **Always specify "instrumental only, no vocals"** when vocals are unwanted — omitting this can result in the model adding sung or hummed vocals
- **Be concrete, not vague** — "bright chiptune melody in C major, retro 8-bit video game style" beats "happy game music"
- **Name the use case** when it constrains the mood — "boss battle theme", "main menu theme", "calm exploration ambience" all imply different energy levels even with similar genre tags
- **Pick the right `length`** — `"clip"` (~30s) for loopable background/ambient tracks and quick iteration; `"long"` (up to a couple minutes) for a fuller arc with distinct sections

### Enhancement Patterns

| Use case | Prompt pattern |
|----------|-----------------|
| Game background loop | "Instrumental only, no vocals. Bright chiptune melody in C major, retro 8-bit video game style, upbeat, loopable." |
| Cinematic tension | "Instrumental only, no vocals. Dark orchestral cue with low strings and a slow, ominous brass swell, building tension." |
| Ambient/exploration | "Instrumental only, no vocals. Airy ambient pad with soft piano, slow tempo, spacious reverb, calm and exploratory." |
| Menu/UI theme | "Instrumental only, no vocals. Light, upbeat acoustic guitar and marimba, friendly and welcoming, mid tempo." |
| Boss battle | "Instrumental only, no vocals. Aggressive electronic/orchestral hybrid, driving percussion, fast tempo around 150 BPM, intense." |

### Ambiguous Cases

- When the user's request is genre-only ("make me game music"), ask for the intended context (menu, combat, exploration, cutscene) before generating, since it materially changes mood and tempo.
- When the desired duration/loop behavior isn't stated, default to `length: "clip"` and mention that a longer `length: "long"` track is available if a fuller arrangement is wanted.

## Scope

This skill covers prompt-crafting for the two generation tools in this MCP server (spoken voice and instrumental music). It does not cover voice cloning, real-time/streaming generation, sound-effect generation, or audio editing/post-processing — those are out of scope for this server.

## Example

**Voice — Input:** "Tell the player they found a rare item"

**Enhanced:** "In an excited, slightly breathless tone, say: 'Whoa... you actually found it. The Ember Blade. I didn't think anyone would ever pull that off.'" (voice: `fable`, for a warm storyteller feel)

**Music — Input:** "Music for a spooky forest level"

**Enhanced:** "Instrumental only, no vocals. Eerie ambient forest theme: sparse, dissonant string harmonics, distant low woodwind drones, occasional soft percussive taps like footsteps, slow tempo, unsettling and sparse — plenty of negative space between phrases."

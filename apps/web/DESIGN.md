---
name: Sylph
description: A dense, tabbed workspace for directing agents and opening proof in context.
colors:
  canvas: "oklch(0.145 0.008 52)"
  utility-ink: "oklch(0.125 0.008 48)"
  panel: "#171614"
  raised-panel: "#1c1a18"
  warm-text: "oklch(0.93 0.014 77)"
  muted-text: "oklch(0.68 0.013 70)"
  coral: "oklch(0.73 0.13 38)"
  live-aqua: "oklch(0.78 0.12 174)"
  fine-border: "oklch(0.91 0.02 76 / 12%)"
  preview-paper: "#f1eee8"
  preview-ink: "#201d19"
typography:
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.538
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.14em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  square: "0px"
  clipped-xs: "4px"
  clipped-sm: "5px"
  utility: "6px"
  control: "8px"
  preview: "9px"
spacing:
  hair: "4px"
  compact: "6px"
  control: "8px"
  panel: "12px"
  content: "16px"
  section: "24px"
  wide-content: "28px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.preview-ink}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    typography: "{typography.title}"
    rounded: "{rounded.utility}"
    padding: "0 8px"
    height: "28px"
  workspace-active:
    backgroundColor: "rgb(255 255 255 / 6.5%)"
    textColor: "{colors.warm-text}"
    typography: "{typography.title}"
    rounded: "{rounded.clipped-sm}"
    padding: "6px 8px"
  prompt-composer:
    backgroundColor: "{colors.raised-panel}"
    textColor: "{colors.warm-text}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "10px 12px"
  browser-address:
    backgroundColor: "rgb(0 0 0 / 20%)"
    textColor: "{colors.muted-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.clipped-sm}"
    padding: "4px 8px"
---

# Design System: Sylph

## Overview

**Creative North Star: "The Thread-First Workshop"**

Sylph is a dense, dark engineering workspace in which agent intent, a running product, and proof remain one tab away. Its visual world is calm and workmanlike: warm soft-black planes, warm near-white text, fine separators, compact controls, and a small number of precise state signals. Chat is the default narrative center. Browser, Changes, Checks, Review, and Terminal are peer work surfaces rather than nested inspectors.

The system is familiar enough for sustained IDE use without becoming a file-editor-first IDE or a generic dashboard. Project hierarchy anchors orientation, the active Workspace is cut into that hierarchy with a coral hairline, and live browser state is reserved for aqua. Dense chrome gives way to more generous transcript measure so the interface feels deliberate rather than cramped.

**Key Characteristics:**

- Warm, tonal dark planes separated by hairlines rather than card chrome
- Compact sans-serif interface text with monospace reserved for machine output
- Coral for selection and agent action; aqua only for live state
- Peer Chat, Browser, Changes, Checks, Review, and Terminal tabs within one Workspace
- Nearly square geometry with clipped 4–9px corners
- One responsive, horizontally scrollable tab model across desktop and mobile

## Colors

The palette is a warm-black working environment punctuated by one selection color and one live-state color; the light preview plane belongs to rendered product content, not app chrome.

### Primary

- **Burnt Coral** (oklch(0.73 0.13 38)): Marks the active Workspace edge, agent identity, focus shifts, progress, and the primary send action. It is a rare directional signal, not a surface fill.

### Secondary

- **Live Aqua** (oklch(0.78 0.12 174)): Communicates a connected or actively running browser, test, or remote Workspace. Pair it with text or an icon whenever status matters.

### Neutral

- **Warm Canvas** (oklch(0.145 0.008 52)): The continuous background of the agent thread and primary shell.
- **Utility Ink** (oklch(0.125 0.008 48)): The deepest plane, reserved for the far-left product rail and code-review ground.
- **Panel Black** (#171614): Separates browser and review chrome from the main canvas without appearing as a floating card.
- **Raised Panel** (#1c1a18): Gives the prompt composer restrained focus within the thread.
- **Warm Text** (oklch(0.93 0.014 77)): The primary text color across dark app chrome.
- **Muted Text** (oklch(0.68 0.013 70)): Supports metadata, branch names, shortcuts, and secondary labels.
- **Fine Border** (oklch(0.91 0.02 76 / 12%)): Divides structural regions, rows, and toolbars at low contrast.
- **Preview Paper** (#f1eee8): Forms the neutral light fallback inside the embedded browser only.
- **Preview Ink** (#201d19): Gives the preview fallback its dark text and mark color.

### Named Rules

**The Two-Signal Rule.** Coral means selection or agent action; aqua means live or connected. Never exchange their roles.

**The Preview Boundary Rule.** Light surfaces may appear inside the browser viewport because they belong to the product under test. Sylph chrome remains dark around them.

## Typography

**Display Font:** Geist Variable (with sans-serif fallback)

**Body Font:** Geist Variable (with sans-serif fallback)
**Label/Mono Font:** Geist Mono (with ui-monospace and SFMono-Regular fallbacks)

**Character:** Geist keeps dense controls neutral, legible, and contemporary. The mono face distinguishes machine facts from human narrative without turning the entire product into terminal cosplay.

### Hierarchy

- **Headline** (600, 20px, 1.4): Reserved for content rendered inside the preview fallback and rare empty-state emphasis; app-shell titles stay smaller.
- **Title** (500, 13px, 1.5): Workspace names, message titles, check names, and primary compact controls.
- **Body** (400, 13px, 1.538): Agent and user narrative, kept to a readable centered measure of 48rem.
- **Label** (600, 10px, 0.14em, uppercase): Rail section labels only; do not uppercase ordinary controls or metadata.
- **Mono** (400, 10px, 1.5): Branches, URLs, model names, elapsed time, viewport dimensions, file counts, change summaries, and diff content.

### Named Rules

**The Human-or-Machine Rule.** Conversation and navigation use Geist sans; values emitted by tools or runtimes use Geist Mono.

**The Quiet-Chrome Rule.** Structural bars use 10–13px type. Large product-style headings do not belong in Workspace chrome.

## Layout

The Workspace fills the viewport and maintains stable left-side orientation. On desktop, a 48px utility rail precedes a 268px Project rail. Projects are the parents and Workspaces are nested directly beneath them; each Project also names its contained Repository. Projects and Workspaces are never separated into independent navigation sections. A 48px top bar establishes Project → Workspace context above the operating surface.

The operating surface uses one full-height peer tab model. Chat opens first and occupies the complete work area. Browser, Changes, Checks, Review, and Terminal replace that area when selected; secondary work never compresses Chat into a permanent split. A compact tab strip sits directly beneath the Workspace top bar. New Browser tabs can be added, tool tabs can be closed, and the Terminal action activates an existing terminal or opens one. The thread body centers within a 48rem maximum measure, with 16px mobile and 28px wider horizontal insets.

Below `md`, the utility and Project rails leave the canvas and navigation opens as a modal rail. The work tab strip remains in place and scrolls horizontally, preserving the same mental model and focus order at every width. The shell uses the small viewport height and keeps a 620px minimum height for the complete composition.

Spacing follows a compact 4/6/8/12/16/24/28px rhythm. Structural toolbars are 36–48px tall; controls are 24–32px. Separators and resizable handles align panels into a single continuous workspace rather than a collection of cards.

### Named Rules

**The Stable-Orientation Rule.** Project and nested Workspace identity remain on the left while the active work changes to their right.

**The Peer-Surface Rule.** Chat, Browser, Changes, Checks, Review, and Terminal share one level of hierarchy. None is permanently nested inside another.

## Elevation & Depth

Sylph is flat by default. Depth comes from neighboring warm-black tones, fine low-contrast separators, active fields, and panel containment. The prompt composer receives the one substantial ambient shadow because it is the anchored action surface. A small shadow and translucent white field may annotate the embedded preview, but those effects do not spread into general app chrome.

### Shadow Vocabulary

- **Composer Lift** (`0 16px 45px rgba(0,0,0,.24)`): Anchors the message composer above the scrolling thread.
- **Preview Annotation** (`0 1px 2px rgba(0,0,0,.05)`): Separates viewport metadata from the light preview canvas.

### Named Rules

**The Tonal-First Rule.** Use plane changes and separators for structure. Shadows are reserved for the composer and content inside the browser preview.

## Shapes

The form language is nearly square: 4–6px clipped corners on status fields, active rows, tool controls, and small badges; 8px on reusable form controls; and 9px on the preview fallback mark. The composer itself is square-edged so it reads as an anchored work surface. Circles are reserved for status dots and user identity.

Borders are fine and quiet. Active navigation is not boxed; it combines a shallow field with a one-pixel coral edge. Avoid capsules unless a component is intrinsically a compact badge, and even badges in the Workspace should prefer clipped corners over pills.

### Named Rules

**The Clipped-Corner Rule.** Operational chrome lives between 4px and 9px. Rounded geometry must remain subordinate to the dense panel topology.

## Components

### Buttons

- **Shape:** Compact controls use gently clipped 6–8px corners and 24–32px heights.
- **Primary:** Coral fill, dark preview-ink text, medium weight, and concise labels; within the Workspace this is primarily the send action.
- **Hover / Focus:** Hover lightens the local field. Keyboard focus adds a visible border and three-pixel translucent ring; active buttons translate down by one pixel. Reduced motion remains legible without animation.
- **Outline / Ghost:** Outline actions sit on transparent or faint dark fields with a fine border. Ghost actions reveal a muted field only on hover or expanded state.

### Chips

- **Style:** Workspace status chips use a fine border, shallow translucent field, 4–5px corners, and 9–10px text. Model and machine identifiers use mono.
- **State:** A colored dot is always paired with a label such as “Live”; status is never conveyed by hue alone.

### Cards / Containers

- **Corner Style:** Major Workspace regions are square and connected. Small contained fields use 4–9px corners.
- **Background:** Canvas, utility ink, panel black, and raised panel establish hierarchy through restrained tonal shifts.
- **Shadow Strategy:** Flat by default; only the composer lifts above the thread.
- **Border:** Fine warm dividers define rails, toolbars, transcript entries, browser chrome, and review rows.
- **Internal Padding:** 8–12px in chrome, 16–28px in readable thread content.

### Inputs / Fields

- **Style:** Reusable fields use transparent dark backgrounds, an 8px corner, a fine input border, and 12px horizontal padding. The browser address field is denser and monospace with a 5px corner.
- **Focus:** Border shifts toward coral or the semantic focus ring and gains a visible translucent ring.
- **Error / Disabled:** Error uses the destructive semantic color with text or icon support. Disabled fields reduce opacity and prevent interaction.

### Navigation

The utility rail is icon-led and fixed at 48px. The adjacent Project rail is a textual hierarchy with stronger Project parents, contained Repository metadata, and denser Workspace children. An active Workspace combines a shallow warm field, a coral hairline, stronger text, and an `aria-current` state. Branch and change metadata remain secondary and monospace where numeric.

### Agent Thread

Messages form one continuous transcript divided by quiet hairlines, not bubbles. A 20px clipped identity mark distinguishes user, agent, tool, and result entries through icon, label, and restrained tone. Human narrative stays in sans; tool activity switches to mono. The composer remains anchored beneath the scrolling history.

### Browser Preview

Browser chrome is a compact 40px toolbar with refresh, an editable monospace URL, test, expand, and viewport controls. A Browser opens as a full work tab only when selected; Chat remains the default. Mobile simulation constrains content to 390px within the available preview rather than replacing the Workspace with a device frame. Multiple Browser tabs may coexist for separate preview targets.

### Review Surface

Changes, Checks, and Review are independent peer tabs. Code renders with Pierre Diffs in a dark GitHub-derived theme; checks are concise rows with icon, text status, and mono detail. Opening any review tool gives it the full operating surface instead of a nested sidebar.

## Do's and Don'ts

### Do:

- **Do** preserve the Organization → Project → nested Workspace hierarchy, with the contained Repository visible as metadata, and keep it persistent on desktop.
- **Do** open Chat by default and keep Browser, Changes, Checks, Review, and Terminal as peer work tabs.
- **Do** use coral as a narrow selection/action cue and aqua as a labeled live-state cue.
- **Do** keep app chrome compact, keyboard-visible, and structured by fine separators.
- **Do** preserve the same horizontally scrollable work tab model on narrow screens.
- **Do** use monospace only for URLs, branches, timings, counts, diffs, and other machine output.

### Don't:

- **Don't** turn the Workspace into a file-editor-first IDE or a grid of equal-weight dashboard cards.
- **Don't** split Projects and Workspaces into separate navigation sections.
- **Don't** use decorative gradients, glassmorphism, neon, or a physical cockpit metaphor.
- **Don't** introduce oversized titles, floating card stacks, or pill-shaped chrome.
- **Don't** hide browser proof behind a desktop tab or reduce it to a thumbnail.
- **Don't** rely on color alone for connection, activity, success, or error state.

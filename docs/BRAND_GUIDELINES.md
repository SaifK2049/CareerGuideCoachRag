# Masari Brand Guidelines

## Brand idea

Masari helps people understand where their experience can take them and what to do next.

The product should feel like a calm, thoughtful career guide: specific, warm, editorial, and practical. It should not feel like a generic analytics dashboard or a noisy productivity tool.

## Brand principles

### Personal, not generic

Speak to the person’s experience, target role, and next move. Prefer “your strongest evidence” over “knowledge signals”.

### Clear, not simplistic

Make complex career analysis easy to understand. Show the reasoning and evidence without exposing unnecessary technical language.

### Practical, not motivational

Every insight should lead toward a concrete next action.

### Confident, not corporate

Use direct statements, strong hierarchy, and a distinctive visual identity. Avoid enterprise dashboard language.

## Visual direction

The landing page establishes a warm editorial system:

- Warm cream canvas
- Near-black charcoal typography
- Masari orange as the signature accent
- Off-white surfaces and restrained borders
- Large, tightly set headings
- Generous whitespace
- Rounded, tactile cards
- Simple, understated navigation

The app should use this system consistently across authentication, onboarding, workspace views, reports, and empty states.

## Color tokens

Use semantic tokens instead of hard-coded colors.

```css
:root {
  --masari-cream: #fef7f0;
  --masari-paper: #fffdfa;
  --masari-peach: #f8e8dc;
  --masari-orange: #df6b3f;
  --masari-orange-dark: #bb4f2b;
  --masari-charcoal: #292524;
  --masari-ink: #171514;
  --masari-muted: #746d68;
  --masari-faint: #a49b94;
  --masari-line: #ded6cf;
  --masari-success: #367a58;
  --masari-warning: #b8782d;
  --masari-danger: #bd5148;
}
```

### Color usage

- `--masari-cream`: default page background
- `--masari-paper`: cards, panels, forms, and modals
- `--masari-peach`: subtle highlights and secondary surfaces
- `--masari-orange`: primary actions, active emphasis, key scores, and branded visual moments
- `--masari-charcoal`: main text and dark feature panels
- `--masari-muted`: supporting copy
- `--masari-line`: borders and dividers
- Success, warning, and danger colors: status communication only; never use them as competing brand accents

Do not use blue as the default product accent. Reserve it for legacy compatibility or cases where a blue semantic state is specifically required.

## Typography

Use one primary type family across the experience, matching the landing page’s contemporary editorial feel. Geist is preferred when available.

```css
:root {
  --font-sans: Geist, "Geist Fallback", sans-serif;
  --tracking-tight: -0.055em;
  --tracking-label: 0.1em;
}
```

### Type scale

```css
:root {
  --text-xs: 0.6875rem;
  --text-sm: 0.8125rem;
  --text-md: 0.9375rem;
  --text-lg: 1.125rem;
  --text-xl: 1.5rem;
  --text-2xl: 2.25rem;
  --text-display: clamp(3rem, 7vw, 5.6rem);
}
```

- Display headings: bold, very tight tracking, short line length
- Page headings: 2–3rem on desktop, 1.8–2.2rem on mobile
- Card headings: clear and compact, but never smaller than the supporting text hierarchy requires
- Body copy: comfortable line height, generally 1.5–1.7
- Eyebrows: uppercase or small sentence case, muted, with generous tracking

Avoid using many small labels to communicate hierarchy. Let spacing, size, and contrast do more of the work.

## Layout and spacing

The app should feel spacious and composed rather than densely packed.

```css
:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 5rem;
  --radius-sm: 0.5rem;
  --radius-md: 0.875rem;
  --radius-lg: 1.25rem;
}
```

Guidelines:

- Use one primary content column wherever possible
- Prefer fewer, larger sections over many small panels
- Give important sections at least `--space-7` of vertical separation
- Use `--radius-md` for product cards and `--radius-sm` for controls
- Keep borders quiet and use contrast sparingly
- Make the primary action and next recommended step visually obvious

## Navigation

Navigation should be simple and outcome-oriented.

Primary product areas:

1. Overview
2. Role match
3. Skill gaps
4. Career plan
5. Interview prep

Secondary utilities such as applications, reports, profile, billing, and privacy should not compete visually with the five core outcomes.

Use plain labels and restrained line icons. Avoid decorative symbol glyphs that can render inconsistently across platforms.

## Core component rules

### Buttons

Primary buttons use charcoal or Masari orange with white text. Use orange for the most important product action and charcoal for high-confidence secondary actions.

```css
.button-primary {
  background: var(--masari-orange);
  border: 1px solid var(--masari-orange);
  color: #fff;
  border-radius: var(--radius-sm);
  min-height: 2.75rem;
  padding: 0 1.125rem;
  font-weight: 700;
}

.button-secondary {
  background: transparent;
  border: 1px solid var(--masari-charcoal);
  color: var(--masari-charcoal);
  border-radius: var(--radius-sm);
}
```

Button copy should describe the outcome:

- “See my career analysis”
- “Add a target role”
- “Choose my next step”
- “Prepare for this interview”

Avoid vague labels such as “Submit”, “Manage”, or “Continue” when a more specific action is possible.

### Cards and panels

- Use paper backgrounds against the cream canvas
- Use quiet borders instead of heavy shadows
- Use orange only on feature cards, selected states, and primary metrics
- Keep card content focused on one decision or insight
- Give prominent insight cards more visual weight than utility cards

### Hero sections

Every major workspace view should have one clear hero message:

- What the user is trying to achieve
- What Masari currently knows
- What the user should do next

The overview hero should visually echo the landing page’s orange career-analysis card, including a prominent role, score, strengths, gaps, and explanation.

### Progress and scores

Scores should communicate direction, not false precision. Always pair a number with:

- What it measures
- Why it matters
- The next action that can improve it

Prefer “Evidence coverage: 78%” with a short explanation over a bare “78”.

## Voice and language

### Voice

Masari sounds:

- Clear
- Warm
- Specific
- Grounded
- Encouraging without hype

### Preferred language

| Prefer | Avoid |
| --- | --- |
| Your next move | Workflow optimization |
| Target role | Job path configuration |
| Your evidence | Knowledge signals |
| Skill gaps | Capability deficits |
| Career analysis | AI assessment output |
| See why | View citations |
| Add evidence | Manage knowledge |
| Prepare for this interview | Generate interview session |

Use “CV” consistently for the user-facing product in this market. Use “resume” only when necessary for search or regional context.

## Empty states and onboarding

Empty states should be useful, human, and action-led.

Structure:

1. State what is missing
2. Explain what Masari will provide
3. Give one primary action

Example:

> Your career picture starts with one target role. Add a role and Masari will compare it with your experience.

Button: `Add a target role`

Onboarding should follow the landing page’s three-part narrative:

1. Share your CV
2. Understand the gap
3. Move with a plan

## Imagery and illustration

Prefer abstract product-led visuals over generic career photography. The orange analysis card is the primary visual motif and can be reused for:

- Readiness scores
- Assessment summaries
- Reports
- Milestones
- Interview preparation progress

Illustrations should be simple, geometric, and editorial. Avoid stock-photo aesthetics, excessive gradients, and decorative AI imagery.

## Accessibility

- Maintain WCAG AA contrast for all text and controls
- Never use color alone to communicate a gap, warning, or completion state
- Keep keyboard focus visible using an orange or charcoal focus ring
- Use real buttons and links rather than clickable generic containers
- Keep interactive targets at least 44px high on touch devices
- Preserve clear labels when changing technical copy

## Implementation priorities

### Phase 1: foundation

- Replace the current blue/gray base tokens with the Masari cream/orange/charcoal system
- Align font family, heading scale, border radius, and button styles
- Replace icon glyphs with consistent line icons

### Phase 2: product identity

- Redesign the overview hero around the orange career-analysis card
- Rework onboarding as “Share your CV → Understand the gap → Move with a plan”
- Simplify the sidebar around the five core outcomes

### Phase 3: language and polish

- Rewrite labels, empty states, and CTAs in the Masari voice
- Reduce panel density and increase spacing
- Apply the system to interview prep, applications, reports, and profile

## Do and don’t

### Do

- Lead with the user’s next decision
- Use warm backgrounds and strong charcoal type
- Make orange memorable and intentional
- Explain scores and recommendations
- Use short, human labels

### Don’t

- Turn every metric into a card
- Use blue as the dominant brand color
- Expose internal AI or data-pipeline terminology
- Use generic motivational language
- Make the app look like a finance, HR, or analytics dashboard

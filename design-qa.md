# OneMail native-style redesign QA

## Evidence

- Source visual truth: `/var/folders/23/j16wtksn2gv4mpfkln3k6t_c0000gn/T/codex-clipboard-7542c606-0cda-46f7-8de5-caf92365c3e8.png`
- Normalized source: `docs/design-qa/reference-normalized.png`
- Final implementation: `docs/design-qa/implementation-final.png`
- Final combined comparison: `docs/design-qa/comparison-final.png`
- Earlier comparison: `docs/design-qa/comparison-v2.png`
- Viewport target: 1180 × 760 CSS px, light theme, unified inbox, first message selected
- Source pixels: 1920 × 1278; app window cropped to 1815 × 1172 and normalized to 1180 × 760
- Implementation pixels: 1180 × 760; captured from the isolated local development preview
- Density normalization: both final evidence images are 1180 × 760 physical pixels

The source and implementation use different live mailbox content. The comparison therefore judges the requested shell and interaction styling: three-column proportions, source-list sidebar, toolbar hierarchy, message density, reader header, typography, color, and native surface treatment.

## Full-view comparison

The final implementation preserves the reference composition: a lavender source-list sidebar, a dense center message list, a white reader, one-pixel column separators, compact native toolbars, and a restrained blue selection state. The 340 px / 420 px / remaining-width panel proportions now align closely with the normalized reference.

## Focused region comparison

- Sidebar: translucent lavender surface, compact disclosure groups, account counts, selected unified inbox, and native line icons match the reference direction.
- Message list: sender, subject, preview, unread marker, status icons, and time form the same three-line scan pattern as the reference.
- Reader: fixed action toolbar, sender avatar, sender/recipient metadata, and generous white reading canvas reproduce the reference hierarchy.
- A separate crop was not needed because the final 1180 × 760 combined comparison keeps all three focused regions legible.

## Required fidelity surfaces

- Fonts and typography: uses the macOS system font stack, compact 11–15 px UI scale, tabular timestamps, clear sender/subject hierarchy, and single-line truncation.
- Spacing and layout rhythm: panel proportions, 48 px toolbars, compact rows, one-pixel dividers, and reader padding are consistent and free of overlap.
- Colors and visual tokens: lavender source-list token, near-white toolbars, subtle borders, muted metadata, and native blue state color match the reference intent in light mode.
- Image quality and assets: no reference artwork was replaced with CSS or handcrafted SVG art. Existing Lucide icons and real provider logos remain in use; email-body imagery is dynamic mailbox content rather than application chrome.
- Copy and content: existing localized application labels and real mailbox behavior are preserved. Preview-only sample content was used for visual QA and was removed afterward.

## Comparison history

1. Earlier finding — P2, center list/header:
   - Evidence: `docs/design-qa/comparison-v2.png`
   - The search and filter region was too tall, while subject and preview collapsed visually into one line.
   - Fix: combined search and filters into one compact native row and made sender, subject, and preview independent scan lines.
   - Post-fix evidence: `docs/design-qa/implementation-final.png`

2. Earlier finding — P1, major-region proportions:
   - Evidence: `docs/design-qa/comparison-v2.png`
   - The sidebar was materially narrower than the reference, leaving the reader oversized.
   - Fix: changed the native layout baseline to a 340 px sidebar and 420 px message list, and versioned the saved panel layout so the redesign takes effect for existing installs.
   - Post-fix evidence: `docs/design-qa/comparison-final.png`

## Findings

No actionable P0, P1, or P2 differences remain for the requested native-app styling.

## Follow-up polish

- P3: the reference puts synchronization status only beneath the sidebar, while OneMail retains its existing full-width diagnostic status bar. This was kept because it exposes real database, account, cache, update, and version state.
- P3: the reference shows system mail folders; OneMail continues to group its actual connected accounts by provider because this redesign was intentionally visual, not an information-architecture rewrite.
- The in-browser QA capture does not include macOS traffic lights. The Tauri window still uses `titleBarStyle: Overlay` and its existing traffic-light position.

## Implementation checklist

- [x] Preserve account, sync, search, filter, selection, reply, forward, delete, attachment, settings, and status behavior
- [x] Match native three-column proportions and separators
- [x] Apply source-list translucency and native system typography
- [x] Convert the message list to compact three-line rows
- [x] Move reader actions into a fixed toolbar
- [x] Verify the rendered implementation against the normalized source
- [x] Remove all temporary preview data and isolated preview configuration

final result: passed

---

# 2026-08-04 two-line message rows

## Evidence

- Source visual truth: `/var/folders/23/j16wtksn2gv4mpfkln3k6t_c0000gn/T/codex-clipboard-2c22d406-4107-46a2-b741-41ac25729afb.png`
- Implementation screenshot: `docs/design-qa/mail-list-two-lines-final.png`
- Combined comparison: `docs/design-qa/mail-list-two-lines-comparison.png`
- Source pixels: 750 × 1358 at Retina density
- Implementation viewport: 375 × 679 CSS px at device scale 1; comparison upsampled to 750 × 1358 pixels
- State: light theme, unified inbox, first message selected, read and unread rows

## Finding and fix

- P2 — the third row repeated the subject/preview and added unnecessary height.
  - Fix: regular messages now render only sender/time and subject. Verification messages keep the same two-line height by placing the copyable verification code inline with the subject.
  - Post-fix evidence: `docs/design-qa/mail-list-two-lines-comparison.png`

## Fidelity surfaces

- Typography: existing sender, subject, unread weight, timestamp, and truncation styles are preserved.
- Layout rhythm: each row now has exactly two 16 px text lines plus existing vertical padding; selection, unread dot, checkbox hover state, and dividers remain aligned.
- Colors: selected, unread, muted timestamp, and border tokens are unchanged.
- Image quality: no image or icon assets are affected.
- Copy: the repeated preview line is removed; the full subject remains available through the existing ellipsis tooltip.

## Interaction checks

- [x] Clicking a row still changes selection.
- [x] Hover checkbox and unread marker behavior are unchanged.
- [x] Long subjects truncate on the second line.
- [x] Verification code remains copyable without creating a third line.
- [x] Temporary visual-QA fixtures were removed.

No actionable P0, P1, or P2 differences remain for the requested two-line message rows.

final result: passed

---

# 2026-08-04 compact controls follow-up

## Evidence

- Provider icon comparison: `docs/design-qa/provider-icons-followup-comparison.png`
- Sending record implementation: `docs/design-qa/outbox-followup-final.png`
- Sending record comparison: `docs/design-qa/outbox-followup-comparison.png`
- Import/export implementation: `docs/design-qa/settings-backup-followup-final.png`
- Import/export comparison: `docs/design-qa/settings-backup-followup-comparison.png`
- Sending record viewport: 1280 × 720 CSS px, light theme, sent/draft/failed sample states
- Import/export viewport: 1280 × 720 CSS px, light theme, local backup selected

Temporary sample outbox data was used only to exercise the populated layout in the browser. The QA entrypoint and sample data were removed after capture.

## Findings and fixes

1. Provider icons — P1
   - Before: the NetEase and Outlook marks were approximate and visually inconsistent with the Gmail and Aliyun brand assets.
   - Fix: replaced them with locally bundled assets sourced from the providers' official favicon endpoints. Other recognized providers use local Simple Icons assets, so rendering no longer depends on runtime favicon requests.
   - Result: the list uses recognizable NetEase Mail and Microsoft Outlook marks at the same compact 20 px slot size.

2. Sending record — P1
   - Before: a narrow right sheet left almost no usable width for message metadata and content, causing vertical character wrapping.
   - Fix: replaced the sheet with a centered 980 px dialog and a `32% / remaining width` master-detail grid. The list, metadata, body, and actions each have independent overflow boundaries.
   - Result: subjects, recipients, timestamps, attachment summaries, warnings, and body content remain readable without horizontal compression.

3. Compose and sending record placement — P2
   - Before: both actions occupied a dedicated row above the account source list and competed with account navigation.
   - Fix: moved them into the active mailbox toolbar beside the mailbox title and bulk-read action.
   - Result: account navigation is dedicated to accounts, while message-creation and history actions live with the mailbox they affect.

4. Import/export settings — P2
   - Before: local backup and remote sync controls were stacked in one dense form.
   - Fix: adopted the requested GSAP animated segmented-tabs pattern for both the top-level settings sections and the local/remote backup mode.
   - Result: the default local workflow is two compact actions; WebDAV/S3 configuration is available on demand without adding vertical noise.

## Interaction checks

- [x] Settings section tabs switch between General, Import/Export, and About.
- [x] Local Backup and WebDAV/S3 tabs switch and the animated highlight tracks the selected trigger.
- [x] Sending record list selects sent, draft, and failed states without narrowing the detail pane.
- [x] Refresh, edit draft, retry, and delete controls remain wired to the existing handlers.
- [x] Compose and Sending Record controls remain disabled while their existing pending states are active.
- [x] Temporary QA files and sample data were removed from the product source.

## Remaining polish

- P3: GSAP adds roughly 32 KB gzip to the production bundle. This is intentional because the user requested the existing animated segmented-tabs implementation, and no duplicate animation framework was introduced.

final result: passed

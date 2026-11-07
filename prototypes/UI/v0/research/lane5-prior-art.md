# Lane 5: Prior art survey of gaze and AAC products (for the Clarte 2x4 "Backend Quadrant" UI)

Scope: existing gaze-controlled and AAC products and open-source projects, read through official documentation, published evaluations and READMEs on 2026-11-07. No design work here. "Read" column says what was actually opened: full page (WebFetch), PDF text extracted locally with pdftotext, or search-result snippet only. Claims that rest on snippets are marked.

Working-text artefacts (PDF extractions) are in `/private/tmp/claude-501/-Users-aamia-clarte/79a99f98-754a-4271-95ae-78afa3ccef35/scratchpad/research/lane5/` (`gazespeak.txt`, `aacrobat.txt`, `penkar-dwell.txt`, `grid3-eyegaze-settings.txt`, `grid3-setbc-2024.txt`, `relate-guide.txt`).

Limit hit: the shared WebSearch budget for this turn ran out near the end, so a few products (E-tran board specifics, Grid 3 "Fast Talker" keyboards, Communicator 5 keyboard page sets, Apple's own iOS eye-tracking support page body) rest on secondary pages or snippets. Those spots are labelled.

---

## 1. Sources

| # | Product / source | URL(s) | What was actually read |
|---|---|---|---|
| 1 | Tobii Dynavox: Gaze Interaction settings (ALL / Communicator) | https://www.tobiidynavox.com/blogs/support-articles/how-do-i-adjust-gaze-interaction-settings-within-all | Full page |
| 2 | Tobii Dynavox: "Leave button before reselect" (Communicator 5) | https://us.tobiidynavox.com/blogs/support-articles/is-there-a-setting-that-would-force-you-to-look-away-and-come-back-before-selecting-a-button-again-so-that-it-doesnt-repeat-by-mistake | Full page |
| 3 | Tobii Dynavox: pause/unpause gaze button in Communicator 5 | https://ca.tobiidynavox.com/blogs/support-articles/how-do-i-make-a-button-to-pause-and-unpause-gaze-interaction-in-communicator | Full page |
| 4 | Tobii Dynavox: TD Snap "Look away before reselecting" | https://ca.tobiidynavox.com/blogs/support-articles/how-to-prevent-accidental-selections-with-eye-gaze-in-td-snap | Full page |
| 5 | Tobii Dynavox: TD Snap Offscreen Menu / Pause button | https://ca.tobiidynavox.com/blogs/support-articles/how-do-i-disable-the-pop-up-menu-in-td-snap | Full page (dated 2026-05-05) |
| 6 | Tobii Dynavox: TD Snap per-button dwell; TD Snap eye gaze settings video page; TD Control repeat click / off-screen menu; Windows Control feedback types; Sensory EyeFX dwell doc; SETBC Snap Core First tutorial | https://www.tobiidynavox.com/blogs/support-articles/how-to-set-eye-gaze-dwell-time-on-a-button-in-td-snap ; https://www.tobiidynavox.com/blogs/product-discovery/td-snap-eye-gaze-settings ; https://uk.tobiidynavox.com/blogs/support-articles/how-do-i-use-repeat-click-in-td-control ; https://us.tobiidynavox.com/blogs/support-articles/what-selection-options-are-available-in-windows-control ; https://hmi-basen.dk/blobs/seriedok/1099/76687.pdf ; https://setbccdnstorage.blob.core.windows.net/data/AAC_Implementation_Classroom/SnapCoreFirst_EditingButton_tutorial_2019ed2022.pdf | Snippets only (video page opened: no transcript) |
| 7 | TD Talk (Tobii Dynavox) App Store listing and version notes | https://apps.apple.com/us/app/td-talk/id1509210085 | Full page |
| 8 | Tobii XR Devzone: Gaze interaction states | https://developer.tobii.com/xr/learn/interaction-design/fundamentals/gaze-interaction-states | Full page |
| 9 | Microsoft: Eye control basics in Windows | https://support.microsoft.com/en-US/accessibility/windows/eye-control/eye-control-basics-in-windows | Full page |
| 10 | Microsoft accessibility blog: From hack to product (Eye Control origin); Otto Knoke story (12 wpm) | https://blogs.microsoft.com/accessibility/from-hack-to-product-microsoft-empowers-people-with-eye-control-for-windows-10/ ; https://www.marketscreener.com/MICROSOFT-CORPORATION-4835/news/Microsoft-Data-guru-living-with-ALS-modernizes-industries-by-typing-with-his-eyes-27251057/ | Full pages |
| 11 | Smartbox Grid 3: Eye gaze settings (Hub article); Lesson 3.6 PDF (2020); SETBC set-up tutorial (2024); Fast typing / Set dwell commands; community gridset notes | https://hub.thinksmartbox.com/knowledgebase/eye-gaze-settings-in-grid-3/ ; https://www.zyteq.com.au/uploads/PDF/Getting_Started_GP12_w_eye_gaze_DOCS/SmartBox_Lesson-3.6-eye-gaze-settings-FDL.pdf ; https://setbccdnstorage.blob.core.windows.net/data/Grid_3/Grid3_EyeGazeSet-up_Tutorial%20_2024.pdf ; https://hub.thinksmartbox.com/?p=19598 ; https://grids.sensorysoftware.com/pt/adam-waits/star-talker-frequency-eye-gaze | Hub page full; both PDFs extracted; commands and gridset notes from snippets |
| 12 | Abilia Lightwriter SL50 brochures / product page | https://www.abilia.com/sites/default/files/BR_Lightwriter%20SL50_EN.pdf ; https://abilia.com/product/lightwriter-sl50 | Snippets only |
| 13 | LC Technologies Eyegaze Edge (Rehadat/EASTIN entry, dealer pages, ECU dissertation on keyboard layouts) | https://www.eastin.eu/en-gb/searches/products/detail/database-rehadat/id-tec_115185.0 ; https://thescholarship.ecu.edu/items/b5f823da-0924-439b-9971-7f989289eb5a/full | Snippets only |
| 14 | PRC-Saltillo Look / Empower eye tracking (Liberator QRG, PRC docs) | https://www.liberator.co.uk/product-support/downloads/empower_qrg/current/empower_-_eye_tracking.pdf ; https://documentation.prc-saltillo.com/docs/calibrate-and-set-up-eye-tracking-in-empower ; https://prentrom.com/articles/prc-saltillo-announces-debut-of-new-prc-eye-tracking-module?mode=view | Snippets only (QRG fetch returned 403) |
| 15 | Irisbond Hiru / Control Bionics Oskol 2 tips | https://controlbionics.com/getting-started-with-oskol-2-top-tips-for-eye-gaze-success/ ; https://zeroproject.org/view/project/ec096f6c-39e6-4ab0-a8c0-fb32bcd85a0a | Tips page full; rest snippets |
| 16 | EyeTech Digital Systems EyeOn Elite / OnBright | https://www.inclusive.com/uk/eyeon-elite-for-aac.html ; https://rehabpub.com/daily-living/eyetech-launches-eyeon-eye-tracking-tablet-platform/ ; https://www.wiki.cogain.info/index.php/Eye_Tracker_Eyetech | Snippets only |
| 17 | Talk To Me Technologies eyespeak / Zuvo | https://www.closingthegap.com/introducing-the-new-eyespeak-inspo-by-talk-to-me-technologies/ ; https://cdn.shopify.com/s/files/1/0770/8269/files/hardware_insert_ZUVO12EYEGAZE.pdf ; https://thinksmartbox.com/?p=3921 | Snippets only |
| 18 | OptiKey wiki (home, Pointing & selecting settings, Sleep, Suggestions, Conversation-only mode, Alternative keyboard layouts, Multi-key selection) | https://github.com/Optikey/Optikey/wiki ; .../wiki/Pointing-&-selecting-settings ; .../wiki/Sleep ; .../wiki/Suggestions ; .../wiki/Conversation-only-mode ; .../wiki/Alternative-keyboard-layouts ; .../wiki/Multi-key-selection | Full pages (multi-key page from snippet) |
| 19 | GazeSpeak, CHI 2017 (Zhang, Kulkarni, Morris) | https://www.microsoft.com/en-us/research/uploads/prod/2017/01/gazespeakUpdated.pdf | Full PDF extracted and read |
| 20 | Google Look to Speak (Google blog; Experiments page; press) | https://blog.google/outreach-initiatives/accessibility/look-to-speak/ ; https://experiments.withgoogle.com/looktospeak ; https://9to5google.com/?p=394820 ; https://www.pocket-lint.com/apps/news/google/160559-what-is-google-s-look-to-speak-app-and-how-does-it-work | Blog and Experiments pages full; press snippets |
| 21 | Google Project Relate / Project Euphonia | https://sites.research.google/relate/files/Project_Relate_Guide.pdf ; https://www.research.google/blog/project-euphonias-personalized-speech-recognition-for-non-standard-speech/ ; https://blog.google/company-news/outreach-and-initiatives/accessibility/project-relate/ | Guide PDF extracted; blogs from snippets |
| 22 | Google SpeakFaster, Nature Communications 2024 (Cai et al.) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11530652 ; https://arxiv.org/html/2312.01532v1 | PMC full text (first 100k chars) |
| 23 | Dasher, Ward and MacKay 2002 (Nature) | https://ar5iv.labs.arxiv.org/html/cs/0204030 | Full page |
| 24 | EyeWriter | https://makezine.com/article/science/health-science/eyewriter/ ; https://theowatson.com/work/eyewriter ; https://www.npr.org/transcripts/124980282 | Snippets only |
| 25 | Apple iOS 18 Eye Tracking (AbilityNet step-by-step; Apple support page attempted) | https://mcmw.abilitynet.org.uk/how-to-control-your-device-using-eye-tracking-in-ios-18-on-your-iphone-or-ipad ; https://support.apple.com/en-asia/guide/iphone/iph66057d0f6/ios | AbilityNet full; Apple page returned only navigation twice, so Apple wording comes from search snippets |
| 26 | Apple macOS Dwell Control | https://support.apple.com/guide/mac-help/use-dwell-control-mchl437b47b0/mac | Full page |
| 27 | Apple visionOS HIG: Eyes | https://developer.apple.com/design/human-interface-guidelines/eyes (read via https://developer.apple.com/tutorials/data/design/human-interface-guidelines/eyes.json) | Full page |
| 28 | Meta Horizon OS: Eyes best practices | https://developers.meta.com/horizon/design/eyes-best-practices/ | Full page |
| 29 | Neuralink PRIME study blog posts (first and second participant) and press | https://neuralink.com/blog/prime-study-progress-update-user-experience/ ; https://neuralink.com/blog/prime-study-progress-update-second-participant ; https://www.livescience.com/health/neuroscience/1st-neuralink-user-describes-highs-and-lows-of-living-with-elon-musks-brain-chip | Both blog posts full; press snippets |
| 30 | AssistiveWare Proloquo4Text (blog, support, press release) | https://www.assistiveware.com/blog/making-the-most-of-proloquo4text ; https://www.assistiveware.com/support/proloquo4text/adjust-appearance/configure-quick-blocks ; https://assistiveware.com/press-releases/assistiveware-proloquo4text-new-text-based-communication-app-ios | Snippets only |
| 31 | Speak for Yourself (AbleNet handout, App Store) | https://files.ablenetinc.com/ANU_Handouts/Handouts/Archive_Presentations/GettingToKnowSpeakForYourself.pdf ; https://apps.apple.com/us/app/speak-for-yourself/id482508198 | Snippets only |
| 32 | Cboard (GitHub README; MIT Solve listing) | https://github.com/cboard-org/cboard ; https://solve.mit.edu/solutions/86149 | README full; Solve snippet |
| 33 | Voiceitt | https://alyn.org/Voiceitt-more-info ; https://www.razmobility.com/product/voiceitt-annual/ ; https://home.agetechcollaborative.org/blogs/mark-ogilbee/2023/08/17/voiceitt-building-voice-based-access-for-people-wi | Snippets only (help.voiceitt.com/faq returned 404) |
| 34 | AACrobat, CSCW 2017 (Fiannaca, Paradiso, Shah, Morris) | https://microsoft.com/en-us/research/wp-content/uploads/2016/10/AACrobat-1.pdf | Full PDF extracted; abstract, formative study, system, case-study sections read |
| 35 | Penkar, Lutteroth, Weber 2012, "Designing for the Eye: Design Parameters for Dwell" (OzCHI) | https://www.cs.auckland.ac.nz/~lutteroth/publications/PenkarLutterothWeber2012-EyeDwellParameters.pdf | Full PDF extracted; results sections read |
| 36 | Feit et al. 2017, "Toward Everyday Gaze Input" (CHI, Microsoft Research) | https://www.microsoft.com/en-us/research/publication/toward-everyday-gaze-input-accuracy-precision-eye-tracking-implications-design/ ; https://www.slideshare.net/slideshow/toward-everyday-gaze-input-accuracy-and-precision-of-eye-tracking-and-implications-for-design/75976708 | Abstract page and author slide deck full; paper PDF not retrieved |
| 37 | Predictive Anchoring (ASSETS 2024 poster) | https://arxiv.org/html/2408.11140v1 | Full page |

---

## 2. Per-product profiles

Format for each: layout; selection and defaults; accidental-activation prevention; prediction; delete/undo; feedback; visual style; users; measured results; lessons.

### 2.1 Tobii Dynavox Communicator 5 (Windows, with Gaze Interaction software)
- Layout: page sets of buttons; the vendor says the on-screen keyboards now share one consistent layout across page sets, with several layouts to choose from (product PDF snippet).
- Selection: activation methods are Dwell ("directing their gaze consistently" for a set time), Switch, and Blink (minimum and maximum blink time settings). Default dwell value not published on the pages read.
- Accidental activation: "Leave button before reselect" (Advanced Settings > Input > Gaze Interaction Settings > Activation) stops a button repeating until gaze leaves it. "Pause Eye Tracking" shows an on-screen pause icon so the user can rest their eyes. A page-set button can be given the smart button type "Toggle Pause" so pausing and un-pausing work with gaze only. Windows Control offers a two-step "Gaze Selection" mode that the vendor says "reduces unwanted clicks", and a Mouse Emulation mode.
- Prediction: keyboards with prediction exist; count and placement not documented in pages read.
- Delete/undo: not documented in pages read.
- Feedback: "Select a color, size, and type of feedback target"; highlight styles No Highlight, Outline, Invert, Overlay (Overlay recommended at about 50 percent opacity). Windows Control feedback types are a rotating clock or a shrinking dot, with adjustable colour and size (snippet). A Track Status viewer shows whether the eyes are detected and positioned.
- Visual style: configurable per page set; clinical, light-surface defaults (not independently verified in this lane).
- Users: adults and children with complex communication needs; ALS, CP, spinal injury.
- Measured results: none published on these pages.
- Lessons: pause, re-selection guard and track status are first-class, gaze-reachable controls, and feedback shape and size are user settings rather than fixed design.

### 2.2 Tobii Dynavox TD Snap (iPad, Windows, TD I-Series, TD Pilot)
- Layout: pages are button grids; button positions are saved per grid size. A SETBC tutorial notes emerging communicators can start with a single 1x1 button while learning gaze (snippet).
- Selection: eye gaze selection types Dwell, Blink, Switch; version 1.18+ allows a per-button dwell time (Edit > button > Access Method > turn off "match user settings").
- Accidental activation: "Look away before reselecting" (User > Access method > Eye Gaze > Dwell > selection options), described as helpful "for users who accidentally select targets repeatedly". An Offscreen Menu shows a Pause button when the user looks down at the eye tracker; the vendor's May 2026 article explains how to turn it off because it "appears unintentionally or causes interruptions".
- Prediction: word prediction exists in keyboard page sets (not detailed on pages read).
- Delete/undo: not detailed on pages read.
- Feedback: settings video page exists but has no transcript; Windows Control feedback types above apply on PC.
- Visual style: not covered here.
- Users: emerging to literate communicators.
- Measured results: none.
- Lessons: an off-screen "look down" gesture as a pause trigger is useful but can fire by accident often enough that the vendor documents disabling it. Per-button dwell lets high-cost buttons be slower than letter buttons.

### 2.3 Tobii Dynavox TD Control / Windows Control (gaze control of Windows)
- Selection: two-step Gaze Selection (look, then confirm) or Mouse Emulation; Repeat Click mode includes an off-screen menu with "Pause Gaze - Toggle eye control pause on and off". F2 removes the eye-gaze user's access to the off-screen menu (a caregiver swipes up from bottom centre), F10 toggles the Track Status window (snippets from vendor support articles).
- Lessons: pause lives in an off-screen menu reached by looking below the display; track status is a toggleable always-available window.

### 2.4 TD Talk (Tobii Dynavox iPad app, works with TD Pilot eye tracker)
- Layout: text-to-speech keyboard app for literate adults; "Quick Messages" presets with Topics (added June 2024); Quick Chat input field.
- Selection: eye gaze on TD Pilot (and, since January 2025, "gaze-and-switch"), or touch.
- Prediction: word prediction and phrase prediction that "adapts to the user's communication style"; prediction in most text fields since June 2024.
- Delete/undo: "in-sentence editing" to correct typos with gaze.
- Partner: a rear-facing "Partner Window" on TD Pilot shows typed text to the conversation partner; See-Through feature uses the rear camera.
- Voices: Acapela, ModelTalker, The Voice Keeper, ElevenLabs; voice filtering by gender and age.
- Lessons: a shipping, actively updated gaze TTS app treats partner visibility, quick messages and in-sentence repair as core, and adds LLM-era pieces (ElevenLabs voices, adaptive phrase prediction) without calling them AI.

### 2.5 Tobii XR Devzone: gaze interaction states (design guidance)
- States: Gaze Enter (feedback only), Dwell Activation, Gaze with Explicit Activation.
- Quotes: "In Eye Tracking, activating elements unwillingly with gaze is referred to as Midas Touch." Strongest with Gaze Enter or short dwell thresholds; "The higher the cost of error of an unwilling activation, the stronger is the Midas Touch effect." "Gaze combined with an explicit activation signal (e.g., button press) is the most predictable and controllable." "Don't use your eyes as an explicit activation signal, e.g. blinking or performing eye gestures" because it "quickly becomes straining". Large dwell thresholds "feel straining and unnatural".
- Lessons: scale dwell length and feedback to cost of error; treat blink confirmation as a strain cost, not a free second channel.

### 2.6 Microsoft Windows 10/11 Eye Control
- Layout: a "launchpad" bar (top or bottom of screen, moved with a Reposition button) holding reposition, left and right click, precise mouse, scroll, keyboard, text-to-speech, Start, Task view, calibration, settings, and pause. Keyboard has Reposition and Delete buttons, a shape-writing toggle, spacebar, &123 and Fn keys; US English only. Text-to-speech window: keyboard at bottom, input field above, Play on the left of the field, Up/Down history on the right, quick phrases ("Yes", "Hello") across the top that speak immediately.
- Selection: dwell. Two settings: "Typing dwell time" (letters, numbers, symbols) and "General dwell time" (function keys, word predictions, mouse controls). No defaults stated.
- Accidental activation: Pause "hides the launchpad" for things like watching a movie. Cancel a mouse action by looking off-screen. To activate the same button twice: "dwell on the button until it activates, then quickly look away and dwell on it again."
- Prediction: "text suggestions appear at the top of the keyboard. Dwell on a word to select it." Shape writing: dwell on first letter, glance through the middle letters, dwell on last; pick another prediction if wrong.
- Delete/undo: Delete key on the keyboard.
- Feedback: optional gaze cursor "where your eyes are pointing when dwelling"; Edit button turns blue when active; no progress indicator described on the page.
- Visual style: standard Windows dark launchpad (not inspected here).
- Users: built with Team Gleason and the Seattle ALS community after the 2014 hackathon.
- Measured results: Microsoft employee Otto Knoke "can type 12 words a minute" with Eye Control and the on-screen keyboard.
- Lessons: separate dwell times by key class; off-screen gaze as the universal cancel; pause is a launchpad button; immediate-speak quick phrases sit at the top of the TTS panel.

### 2.7 Smartbox Grid 3
- Layout: grid sets of cells; keyboard bundles place "most commonly used letters or functions in the middle of the keyboard, less common letters and functions around the edge", with prediction cells in the centre where useful (gridset description snippet). Emerging users can start with very large single cells (not Smartbox's own doc).
- Selection: Activation options Dwell to click (the default per the 2024 SETBC tutorial), Blink to click, Switch to click. Dwell time is a +/- control, also settable by "Set dwell" command. "Fast typing halves the dwell time required on Letter cells when using eye gaze or a pointer. Fast typing won't affect other cells, helping avoid accidental selections." Community gridsets suggest starting low-cognition users at about 1 s dwell with progress feedback.
- Accidental activation: differential dwell (above); no documented "look away" guard found on the pages read.
- Prediction: prediction cells in the keyboard grid itself.
- Delete/undo: standard cells (not detailed).
- Feedback: Highlighting border, Highlighting background, or Magnification; optional eye gaze dot ("a visual representation of the focus of your gaze"); optional auditory feedback that reads the cell label; a progress bar during activation; sound on activation.
- Visual style: configurable; vendor gridsets are flat, colour-coded cells (not inspected).
- Users: broad AAC population; now also owns Talk To Me Technologies.
- Measured results: none.
- Lessons: halve dwell only on the frequent, low-cost cells; offer magnification as a feedback style, and audio labels for users who cannot read small text.

### 2.8 Abilia Lightwriter SL50 (keyboard TTS device)
- Layout: physical backlit keyboard with keyguards, two screens: one facing the user, one facing the listener, plus an outward speaker, so the partner can read what was said in a noisy cafe (brochure snippets).
- Selection: typing, or 1-2 switch scanning, or mixed.
- Prediction: adaptive word prediction and completion; import/export dictionary, blacklist words.
- Users: literate people who cannot speak effectively.
- Lessons: a second, partner-facing readout is treated as a core feature of face-to-face AAC, not an accessory.

### 2.9 LC Technologies Eyegaze Edge
- Layout: rectangular keys/cells; "an array of menu keys and exit keys allow the user to navigate the Eyegaze programs independently"; on-screen keyboard with ready-made phrases (database snippets).
- Selection: dwell; "Prolonged fixation of a button displayed on the screen triggers a function assigned to the button. The dwell time is adjustable."
- Related evidence: an ECU dissertation comparing frequency, QWERTY and alphabetic gaze keyboard layouts for first-time users found most participants preferred QWERTY (snippet).
- Lessons: familiar layouts win for first-time users even when frequency layouts are theoretically faster.

### 2.10 PRC-Saltillo Accent with Look module (Empower / NuVoice software)
- Selection: Selection tab offers Dwell; the quick-reference example uses "a Dwell time of 0.9 and no repeat delay"; a "Resume" option appears when the user dwells on it (snippets). Tracking filter methods smooth the cursor; "Stream: The cursor moves with the eye wherever you look". Calibration settings adjustable.
- History: Look replaced NuEye after parts became unavailable.
- Lessons: a published vendor example dwell is 0.9 s; resume-from-pause is itself a dwell target.

### 2.11 Irisbond Hiru (and Control Bionics Oskol 2 on 13-inch iPad Air)
- Tips page (vendor): "Ensure you are seated comfortably and the device is positioned so your eyes are centered in the on-screen positioning box." "If you find yourself clicking unintentionally, try increasing your dwell time by a fraction of a second to ensure clicks are deliberate." Use the Pause feature to put tracking into sleep mode when "reading long text or watching a video". Use more calibration targets ("9-point option"); customise target colour, size and speed. Enable Snap to Item so the cursor magnetises to buttons; use Smoothing to dampen shakiness.
- Hardware: Made for iPad certified; Windows and iPadOS.
- Lessons: the three universal tuning knobs are dwell length, smoothing and snap-to-target; pause is for reading.

### 2.12 EyeTech Digital Systems EyeOn Elite (Windows tablet) with OnBright suite
- Selection: dwell and blink timing adjustable per a clinician interview (snippet); older EyeTech trackers clicked "with an eye blink, a hardware switch, or by staring (dwell)".
- Marketing: FDA-registered AAC device, insurance coverage; proprietary "strobing" illumination.
- Lessons: nothing beyond the common dwell/blink/switch triad; little public design detail.

### 2.13 Talk To Me Technologies eyespeak Inspo / Zuvo 12 and 16
- Hardware: tracking range about 14 to 31 inches; onboard processor; a front light that signals correct positioning and can be turned off (Closing The Gap snippet). Device top should be level with the user's head; can sit to the side or tilt down on a high table (hardware insert snippet).
- Lessons: positioning feedback is a physical light on the device, a pattern worth imitating on screen for a webcam tracker.

### 2.14 OptiKey (open source Windows gaze keyboard, ALS/MND focus)
- Layout: full keyboards; a Simplified keyboard with "groups of 3 letters, which then expand to let you type letter by letter"; alphabetical layout; CommuniKate picture boards; user-built Dynamic Keyboards; Conversation-only mode (full screen, "shows only the keys you need") with a Speak key. Author's stated motivation: commercial AAC is "outrageously expensive, unreliable and difficult to use".
- Selection: "fixations" with separate "Key fixation time to lock-on (ms)" and "Key fixation time to complete (ms)"; "Incomplete key fixation time to live (ms)" keeps a partial fixation alive briefly after the gaze leaves; option "Resuming an incomplete key fixation requires a new lock-on"; "Point lock-on radius" and "Point fixation radius" for mouse mode; "Eye tracker processing level" trades steadiness for latency. No defaults on the wiki page. Multi-key selection (swipe a word): "Minimum dwell time on a key to include in capture (ms)" with troubleshooting advice to raise it when wrong keys are captured, or lower it (example 250 ms to 100 ms) when keys are missed; "Capture timeout (ms)".
- Accidental activation: Sleep key ("no other key will respond to you until the 'Sleep' key is selected (released)"), toggled by selecting it again; lock-on period before a dwell starts.
- Prediction: suggestions "above the scratchpad", paged with Previous Suggestions and Next Suggestions keys; selecting completes the word or swaps the multi-key match; next-word prediction page exists.
- Delete/undo: back keys on keyboards (not detailed on pages read).
- Feedback: "Selection progress indicator behaviour": a filling pie chart, or a solid circle that shrinks or grows.
- Visual style: dark theme by default with theme options (Change the theme page exists; not inspected).
- Users: people with ALS/MND and other motor and speech limits; low-cost trackers and webcams.
- Measured results: none published.
- Lessons: separate lock-on from completion; keep partial dwell alive across micro-saccades; make the pause control a key on the keyboard itself; offer a grouped 3-letter keyboard for users who lack accuracy for full keyboards, which is close to Clarte's four-group idea.

### 2.15 GazeSpeak (Microsoft Research / UW, CHI 2017; smartphone camera reads eye gestures)
- Layout: four letter groups mapped to up, down, left, right, "simply clusters in alphabetical order" because "learnability was a higher design priority for this audience" than prediction conflict rate. The speaker sees a four-key sticker on the phone's back; the interpreter's screen shows the four-key keyboard, an input box with the current top prediction, the top four word predictions (more by horizontal scroll), the sentence box, and the camera preview.
- Selection: one gesture per character "to reduce fatigue and increase throughput"; the phone speaks the detected direction aloud ("Up"). Front-facing mode turns the current prediction red to show focus.
- Delete/undo: wink left (or close both eyes for at least 2 s) removes the last character; wink right (or look centre for at least 2 s) ends the word and speaks the top prediction; look right to hear the next prediction; wink right again to confirm the sentence.
- Prediction: trie over the 5,000 most common oral-English words; 83.5 percent of gesture sequences match a unique word, 97.7 percent match four or fewer; interpreter can add names.
- Feedback: audio for the speaker; visual for the interpreter.
- Recognition: 86 percent mean across gestures (up 88.6, down 75.3, left 87.8, right 86.9, close 77.5, centre 98.6); glasses lowered accuracy to 80.4 percent versus 89.7 percent without; "looking down and closing the eyes are harder to recognize due to their sometimes-similar appearance".
- Speed: 20 able-bodied pairs: 137.8 s per sentence with an e-tran board, 80.9 s GazeSpeak default, 77.1 s front-facing mode; e-tran rated more mentally demanding; no participant preferred e-tran. Entering a letter on an e-tran board is quoted at 8 to 12 s.
- PALS feedback: four of seven people with advanced ALS could not move their eyes quickly, so calibration had to slow down; oxygen masks interfered; "ability-based design" adds or drops gestures (backspace only if left-winking is possible).
- Lessons: alphabetical four-group ambiguous keyboards are learnable and disambiguate well with a word model; one gesture per letter beats two; audio confirmation of the recognised direction matters; downward gaze is the least reliable direction on camera-based systems.

### 2.16 Google Look to Speak (Android, front camera, 2020; 17+ languages)
- Layout: a phrase list split into two columns; "look left, right or up to quickly select"; press accounts: look left off the edge of the screen to choose the left half, the app splits the remainder again until one phrase remains, "within about four glances"; looking up above the screen cancels or "snoozes".
- Accidental activation: adjustable "eye gaze sensitivity"; snooze mode locks the screen, unlocked by an eye-movement sequence. Reviews complain the snooze area is "WAY more sensitive than the other areas" and ask to disable it (press snippet).
- Prediction: none; pre-written phrases, editable phrasebook.
- Design motivation: speech therapist Richard Cave with artist Sarah Ezekiel (MND); works "outdoors, in transit, in the shower and in urgent situations" where devices "couldn't easily go"; all processing on device.
- Lessons: binary gaze splitting works with a crude tracker, and an over-sensitive off-screen rest gesture is the most common complaint.

### 2.17 Google Project Relate / Project Euphonia (personalised ASR for non-standard speech)
- Setup: the start-up guide requires "at least 500 recordings" of phrase cards (progress shown as levels of 100 cards); a few days of server-side training; the app then reports a Speech Recognition Score of low, medium or high; custom cards for names and places. Research blog: about 71 percent of the gain comes from only 5 minutes of audio, many users needed about 20 minutes (snippets).
- Modes: Listen (live transcript), Repeat (restate in a synthetic voice), Assistant; a Relate keyboard for voice typing in any app.
- Lessons: relevant to Clarte's "Record partner" phase only indirectly; the partner's speech is typical speech, so standard ASR applies, while the user's own residual speech could be a future personalised input.

### 2.18 Google SpeakFaster (LLM-assisted gaze typing, Nature Communications 2024)
- UI: the user types an initialism on the gaze keyboard; "the UI automatically triggers calls to the KeywordAE LLM after every keystroke"; the top 5 phrases are shown, chosen because of "the screen size of gaze tablet devices" and diminishing returns; a Speaker button next to each phrase speaks it; "Spell" turns the abbreviation into clickable chips to type a word in full; FillMask offers alternative words starting with the same letter to repair a near miss; the design repairs failures "without delete or backspace keys".
- Results: lab participant with ALS went from 4.05 to 6.54 WPM scripted (61.3 percent) and 4.37 to 6.38 unscripted; field participant's long-term baseline 8.1 WPM rose to 10.4 WPM (28.8 percent); keystroke-saving rate 0.23 to 0.36 (lab) and -0.14 to 0.32 (field); abstract: 29 to 60 percent faster.
- Context: the LLM uses prior turns including the partner's; the paper assumes partner words "are available" and names ASR of partner speech as the way to get them; privacy concerns noted.
- Limits: two male participants; phrases of ten words or fewer; 64B model on 16 TPUs with internet; typos not tolerated; cognitive overhead significant.
- Lessons: a single accept action for a whole-phrase suggestion is where the speed comes from; repair should be candidate-swapping, not backspacing; partner speech is the highest-value context, which is exactly Clarte's Record phase.

### 2.19 Dasher (continuous gaze steering, Ward and MacKay 2002)
- Mechanism: an alphabetical "library" zooms toward the gaze point; vertical gaze picks the letter, horizontal position sets zoom rate, looking left zooms out to undo; no dwell. The language model allots screen space in proportion to letter probability, so "many successive characters can be selected by a single gesture".
- Results: up to 25 WPM with an eye tracker after an hour of practice versus 15 WPM for an on-screen keyboard, with about one fifth the error rate; two expert and two novice Dasher users; mouse expert 34 WPM. Later work notes no eye-typing control condition in the original.
- Lessons: continuous steering avoids the "pressed by staring" fatigue of dwell buttons and merges completion with typing; it is the strongest counter-example to grid-and-dwell.

### 2.20 EyeWriter (2009 open hardware, Tempt One)
- Hardware: PS3 Eye camera plus infrared illuminators on glasses frames, target cost about 50 USD versus 10,000+ USD commercial; openFrameworks software with tracking, calibration and drawing modules; output in GML (snippets).
- Lessons: low-cost webcam gaze for a single highly motivated user is viable when the task (drawing) tolerates imprecision.

### 2.21 Apple iOS 18 / iPadOS Eye Tracking (front camera, Settings > Accessibility > Eye Tracking)
- Setup: toggle on turns on AssistiveTouch; calibrate by looking at coloured dots; recalibrate by resting the eyes on the top-left corner until the calibration screen appears; keep the device still and about 1.5 feet away in good light (Apple guidance via press snippets).
- Selection: Dwell Control; a Dwell pointer appears when the gaze holds and "its outer circle fills to show how much longer to rest your eyes"; Dwell default action can be Tap or "Pause Dwell"; dwell time and movement tolerance live under AssistiveTouch > Dwell (snippets).
- Settings: Smoothing (smoother but less responsive); Snap to Item ("the item on the screen that's closest to where you're looking"); Zoom on Keyboard Keys (dwell on the keyboard zooms in, dwell again to tap); Auto-Hide pointer after a set steady time, with a range reported as 0.10 to 4 s (snippet); all data processed on device.
- Lessons: Apple ships the complete gaze toolkit on a webcam-class sensor: smoothing, snap, zoom-to-disambiguate, a filling ring, and a hidden pointer that appears only when the gaze is steady.

### 2.22 Apple macOS Dwell Control (Accessibility Keyboard)
- Actions: Left Click, Double Click, Right Click, Drag & Drop, Scroll Menu, Options Menu (a circular menu around a crosshair, each pick one-time only), Pause. Pause means "the pointer takes no action"; to resume, dwell on any dwell action in the Accessibility Keyboard, or on the dwell corner that shows the keyboard. A "Home" button returns to the home panel. The dwell pointer "circle starts to empty" as a countdown; pointer colour changeable; "Hide dwell time indicators" option.
- Lessons: resume is any action target, not a special one; the countdown is an emptying ring; hot corners are the gaze-reachable "escape".

### 2.23 Apple visionOS HIG: Eyes
- Rules quoted: items need "a margin of at least 16 points around the bounds of each item or ... centers ... at least 60 points apart"; "crowding UI objects together can make it difficult for people to look at one of them without jumping to another"; "give an interactive item a rounded shape" because "eyes tend to be drawn toward the corners in a shape"; multi-element components need "an overall containing shape that visionOS can highlight"; "Minimize visual distractions"; "Avoid using a repeating pattern or texture"; "Always give people multiple ways to interact"; custom hover effects: no delay for subtle cues, short delay for quick interaction, long delay for extra information; keep one primary view unchanged across hover states. Target size in degrees is not given on this page.
- Lessons: rounded, well-spaced, visually quiet targets with one highlighted containing shape.

### 2.24 Meta Horizon OS: Eyes best practices (gaze + pinch)
- Rules quoted: "Size gaze targets to at least 3.0 degrees of visual angle"; web targets at least 56 x 56 CSS px, Android 48 dp; keep "at least 1 degree between the visually dominant parts of adjacent elements"; "Arrange buttons in one row or one column. Avoid two-dimensional button grids, where gaze error can land on a neighbor in any direction"; "The center of a surface is the most reliable place to target"; avoid the perimeter and dense clusters; hover feedback is "subtle changes in opacity, scale, or Z-distance that don't change container size", scale the content not the container, "Use subtle color changes instead of outline strokes, which pull the eye outward"; never reveal or hide content on hover; "No user flow may depend on hover state"; use gray tones, "Avoid pure black and pure white, which leave no room for a hover state to brighten"; "Dark backgrounds improve visibility of hover and selection highlights"; provide an explicit close control because "Users can struggle to find a blank spot to look at and select"; timing table: colour hover-on 300 ms, hover-off 400 ms, motion hover-on 150 ms delay then 475 ms, press 80 ms, release 100 ms; design for graceful degradation when gaze precision changes.
- Lessons: the most specific published numbers for gaze targets; the explicit warning against 2D grids applies to a 2x4 layout and argues for generous row and column gutters.

### 2.25 Neuralink Link app (BCI cursor; design reference the user asked about)
- What is documented: cursor control on a MacBook; selection initially by hovering the cursor in place for 0.3 s instead of clicking (Live Science / New Mobility press, snippet); later the Link "is able to distinguish left and right clicks" so Noland could select "targets similar in size to the smallest icons and buttons on a laptop screen"; performance measured on the Webgrid task ("BCI grid task with multiple click task"): 4.6 bits per second, later 8.0, versus about 10 for engineers with a mouse; after the thread retraction, the team "enhanced the user interface" among other changes; second participant Alex got cursor control in under five minutes, used a Neuralink "mode switcher" on the right side of the screen to change mouse function (zoom, scroll, pan, click-and-drag) in Fusion 360.
- Not documented: colours, layout or typography of the app. The "monotone dark" impression comes from livestream footage and is not described in any text read here, so treat it as an unverified visual reference.
- Lessons: a BCI team converged on dwell-to-click first, then explicit clicks, plus a persistent side-rail mode switcher. Webgrid-style target grids are the standard way to measure pointing bandwidth.

### 2.26 AssistiveWare Proloquo4Text (iOS text AAC)
- Layout: single-screen design with a central text pad and side "Quick Blocks" (Phrases and Quick Talk) that can sit on either side and be pushed aside; Quick Talk speaks stored messages "without interrupting the message that you are currently typing", example message "Please be patient while I write my message" to tell partners to stop and wait (vendor blog snippets).
- Prediction: PolyPredix multi-word prediction, vendor claims 50 percent less typing.
- Lessons: a one-dwell "please wait" message is a recognised conversational tool for slow composers.

### 2.27 Speak for Yourself (iOS symbol AAC)
- Layout: a fixed 120-location grid; "no more than two touches to say a word" (about 14,000 words); fixed positions for motor planning so "the same word stays in the same place" (vendor and clinician snippets).
- Lessons: fixed positions build motor memory; a fixed "Backend Quadrant" map has the same virtue.

### 2.28 Cboard (open-source web AAC)
- README: symbol boards from major libraries, browser Speech Synthesis API, PWA with service worker, 40+ languages (machine translated mostly). MIT Solve listing mentions scanning mode for switches, "special buttons for eye trackers", dark mode, sizes, and an OpenAI-based AI board builder in development (snippet; not confirmed shipped).
- Lessons: an open web stack (React PWA) is viable for AAC; eye-tracker support there is "large buttons", not native gaze logic.

### 2.29 Voiceitt (personalised recognition for dysarthric speech)
- How it works: per-user model; each phrase is trained ("each individual phrase needs to be programmed and trained"); one distributor says repeating 3 to 4 word phrases, "600 times" over a few hours; output as audio or text; Alexa integration via RAZ Mobility (2023); suitability depends on "a consistent speech pattern", not severity (snippets).
- Lessons: for the dysarthria population, residual speech can be an input modality later; phrase-level training burden is high.

### 2.30 AACrobat (Microsoft Research, CSCW 2017; partner companion app for gaze AAC)
- Problem: gaze AAC runs "about 10 words per minute"; rate enhancement has not broken "the current cap of approximately 20 wpm"; the asymmetry causes breakdowns, over-the-shoulder peeking, and partners guessing aloud.
- Formative study guidelines: (1) the system "must preserve or increase users' autonomy"; (2) it "should directly engage communication partners (in a manner that respects the autonomy of the AAC user)"; (3) "it must allow the AAC user to control how information is shared". Users were most comfortable with help from spouses, least from strangers.
- System: a companion phone app showing a real-time view of the message as it is typed (character, word, sentence or block granularity set per social circle), partner suggestions that appear in the AAC user's prediction bar, pre-composed blocks and "Communication Preference" messages ("Please ask only yes or no questions"), and status indicators: device offline / calibrating / normal, and user idle / typing / speaking, so partners "know when the AAC user is forming a thought versus when they are simply listening".
- Evaluation: three case studies with people with ALS and partners; awareness of state and urgent needs valued.
- Lessons: show the partner the user's state (listening, composing, about to speak) and let the user decide how much of the draft the partner sees.

### 2.31 Research cross-references used for numbers
- Penkar, Lutteroth, Weber 2012 (21 and 15 participants, Tobii desktop tracker, 15-inch 1280x1024 display): button sizes 170x150 px (5x4 cm), 120x100 px (3.5x2.5 cm), 70x50 px (2x1.3 cm) and dwell 0.2, 0.4, 1.0 s. Longer dwell was significantly more accurate; button size did not change accuracy much (even the smallest exceeded the 1 cm jitter minimum) but strongly changed difficulty; "the worst combination is that of a small button size and a long dwell time" because "it seems to be difficult to hold the gaze in the clickable area for even just one second, unless the clickable area is big enough" (the "gaze-hold" problem). Second experiment with 75/100/150 px round buttons and 0.2/0.6/1.0 s: 100 percent accuracy when content sat outside the buttons; best was large button plus short dwell. Conclusion: "a combination of big buttons and short dwell times are most suited for maximizing accuracy and ease of use".
- Feit et al. 2017 (80 people, Tobii EyeX and SMI REDn, two lighting conditions): variation across users "more than sixfold"; "Accuracy is worse in vertical direction"; "Precision is worse towards right and bottom edge of screen"; "Avoid placing elements on the bottom or right edge of screen"; "Targets should be slightly larger in height than width"; recommended target 3.28 x 3.78 cm unfiltered, 1.9 x 2.35 cm with a weighted-average filter with saccade detection and outlier correction (covers 75 percent of users, about 32 ms delay); no difference between lighting conditions; EyeX more accurate but 13 percent data loss versus 3 percent.
- Predictive Anchoring 2024: text prediction placed "away from the words being selected" forces split attention; proposed a long-press radial overlay of four suggestions around the chosen word; no user study yet.

---

## 3. Cross-product patterns

### What nearly every shipping gaze product does
1. Dwell is the default selector everywhere (Tobii, Grid, PRC, Irisbond, EyeTech, OptiKey, Windows, iOS, macOS, early Neuralink). Blink and switch are alternatives, never the primary. Tobii's own XR guidance says not to use blinks or eye gestures as the activation signal because it strains.
2. Dwell has more than one speed. Windows separates typing dwell from general dwell; Grid 3 "Fast typing" halves dwell on letter cells only; TD Snap allows per-button dwell; OptiKey separates lock-on time from completion time and keeps an interrupted fixation alive for a time-to-live. Published example values: 0.9 s (PRC Empower example), 1.0 s (Grid community starting point), 1.5 s (a Tobii document for a third-party app), 0.3 s (Neuralink's first hover-select, press report). Research: 0.2 s produces Midas-touch errors, 1.0 s is hard to hold on anything but a large button.
3. A re-selection guard exists in the serious products: Communicator 5 "Leave button before reselect", TD Snap "Look away before reselecting", Windows "look away and dwell again". Without it, a user who stays on a target after it fires gets repeats.
4. A gaze-reachable pause/rest and a resume path: Communicator "Toggle Pause" button and pause icon, TD Snap Offscreen Menu pause when looking down at the tracker, Windows launchpad pause, OptiKey Sleep key, macOS Pause with resume by dwelling on any action, Irisbond pause for reading, Look to Speak look-up snooze. Off-screen gaze doubles as cancel (Windows mouse actions, Look to Speak).
5. Progress feedback during dwell: Tobii rotating clock or shrinking dot, OptiKey filling pie or shrinking/growing circle, iOS filling outer ring, macOS emptying ring, Grid progress bar. Highlight styles are user-selectable (outline, invert, 50 percent overlay, background, border, magnification). Audio labels or confirmations exist (Grid auditory highlighting, GazeSpeak speaking the direction, TD Talk typing sounds).
6. A track-status or positioning indicator is always one step away (Tobii Track Status window and F10, Irisbond "positioning box", TTMT front light, GazeSpeak camera preview).
7. Partner-facing output is treated as core in face-to-face AAC: Lightwriter second screen, TD Pilot Partner Window, Proloquo4Text "please be patient" quick message, AACrobat status indicators and shared draft, GazeSpeak interpreter screen.
8. Prediction is shown in a dedicated strip adjacent to the composing area (top of keyboard in Windows, above the scratchpad in OptiKey, prediction cells in the centre of Grid keyboards, top four in GazeSpeak, top five in SpeakFaster). Everyone pages through more candidates with next/previous controls rather than showing many at once.
9. Fixed positions: Speak for Yourself's fixed 120-cell grid, Grid's consistent gridsets, Communicator's one keyboard layout across page sets. Motor memory is explicitly a design goal in AAC.

### What the failures and complaints look like
- Over-sensitive rest zones: Look to Speak's snooze "WAY more sensitive than the other areas"; TD Snap's look-down Pause button documented as appearing "unintentionally" with instructions to disable it.
- Long dwell on small targets: Penkar's worst condition; Tobii XR says large dwell thresholds "feel straining and unnatural".
- Hover-triggered reveals and moving targets: Meta forbids hover-dependent flows and container resizing because they break fixation; Apple says if all views change on hover "it can disorient people".
- Edge placement: Feit's precision drop at the bottom and right edges; Meta's "perimeter of the field of view" warning; the GazeSpeak "down" gesture was the least recognised (75 percent) because looking down resembles eye closure on camera, and glasses cut accuracy from about 90 to 80 percent.
- Character-level correction loops: SpeakFaster deliberately removed backspace from the repair path because edits are costly; GazeSpeak needed a wink or a 2 s closure just to delete one character.
- Prediction far from the point of action splits attention (Predictive Anchoring).

### Measured numbers worth keeping
| Measure | Value | Source |
|---|---|---|
| Typical gaze typing rate, people with ALS | about 10 wpm; practical cap about 20 wpm | AACrobat |
| SpeakFaster participants' baselines | 4.05 and 8.1 wpm; with LLM 6.54 and 10.4 wpm | SpeakFaster 2024 |
| Windows Eye Control, employee with ALS | 12 wpm | Microsoft story |
| Dasher by gaze after 1 h | up to 25 wpm vs 15 wpm on-screen keyboard; about one fifth the errors; n = 4 | Ward and MacKay 2002 |
| GazeSpeak vs e-tran, able-bodied pairs | 80.9 s vs 137.8 s per sentence | GazeSpeak 2017 |
| E-tran letter entry | 8 to 12 s per letter | GazeSpeak 2017 citing prior work |
| Camera eye-gesture recognition | 86 percent mean; down 75 percent; glasses 80 percent | GazeSpeak 2017 |
| Dwell/size sweet spot | large button plus short dwell; 0.2 s too error-prone; 1 s hard to hold on small buttons | Penkar 2012 |
| Gaze target minimums | 3.0 degrees visual angle, 1 degree spacing (Meta); 60 pt centre spacing or 16 pt margins (Apple visionOS); 1.9 x 2.35 cm filtered, 3.28 x 3.78 cm raw on a desktop tracker (Feit) | Meta, Apple, Feit |
| Precision by region | worse at bottom and right edges; vertical worse than horizontal | Feit 2017 |
| Suggestion count | 4 (GazeSpeak), 5 (SpeakFaster, chosen for tablet screen size) | both papers |
| Neuralink cursor bandwidth | 4.6 then 8.0 bits/s; mouse about 10 | Neuralink blog |
| Personalised ASR data | 71 percent of gain from 5 min; about 20 min typical; Relate requires 500 phrases | Euphonia blog, Relate guide |

---

## 4. Design implications for Clarte (8 Backend Quadrants, 2x4, laptop webcam gaze; Record partner then Respond; G1..G4 letter groups; one autocomplete slot; Delete; page flip for three more features)

Strength key: strong = multiple independent products or studies agree; moderate = one good source or a near analogue; weak/extrapolated = my inference from the pattern.

1. **Two dwell classes, and per-target dwell.** G1..G4 should fire fastest; Delete, the Respond/End commit, the page flip and Pause should need a longer dwell. Precedents: Windows typing vs general dwell, Grid Fast typing on letter cells only, TD Snap per-button dwell, Tobii XR "cost of error" rule. Start around 0.6 to 0.9 s for letter groups and 1.0 to 1.5 s for commit and destructive actions, then tune per user (PRC example 0.9 s, Grid community 1 s, Penkar's finding that 1 s is fine when the target is huge, which a quadrant is). **Strong.**

2. **Separate lock-on from completion and keep partial dwell alive.** Copy OptiKey's model: a short lock-on before the progress indicator starts (filters glances across a quadrant), a time-to-live that survives micro-saccades and tracker dropouts, and a setting for whether returning needs a fresh lock-on. With a webcam tracker that jitters, this matters more than on Tobii hardware. **Strong.**

3. **Re-selection guard with a visible re-arm state.** After a quadrant fires, it should not fire again until gaze has left it (Tobii "leave button before reselect", TD Snap "look away before reselecting", Windows "look away and dwell again"). Clarte's four-group alphabet makes double letters within one group common (LL, OO, SS all stay inside one group), so the re-arm must be fast and visible: a brief "armed again" cue when the gaze returns, or a small dead-time rather than a mandatory exit. **Strong** for the guard; **moderate** for the exact double-letter treatment.

4. **Pause and cancel must be gaze-reachable but hard to trip.** Every product has a rest state; the two documented complaints are rest zones that trigger by accident (Look to Speak snooze, TD Snap look-down Pause). Give Pause a long dwell and a single large Resume target (macOS: resume by dwelling any action; Windows: pause hides the bar), and use off-screen gaze as cancel only for in-progress actions, never as a selection. Do not place a rest trigger in the bottom row's edge region (see 7). **Strong.**

5. **Hover feedback that does not move anything, and nothing revealed on gaze.** Meta and Apple agree: subtle opacity/colour change, scale the content not the container, no outline strokes that pull the eye outward, keep one primary element unchanged, never reveal or swap content on hover, no flow depends on hover. The page-flip arrow must be a committed dwell, never a hover reveal of the hidden three features. Progress indicator should be a ring or fill inside the target, as iOS, macOS, OptiKey and Tobii do. **Strong.**

6. **Targets rounded, labels weighted toward the quadrant centre, generous gutters, especially between the two rows.** Apple: eyes are drawn to corners, so round the shape and give one containing highlight shape; Meta: centre of a surface is most reliable, avoid dense clusters, keep at least 1 degree between dominant parts, and arrange in one row or column because 2D grids let error land on any neighbour. A 2x4 layout is a 2D grid, so put the widest dead gap on the row boundary (vertical accuracy is worse per Feit) and visible gutters between columns, and make each quadrant's live hit-area slightly smaller than its visual tile so a gaze that drifts into a gutter does nothing rather than selecting the neighbour. **Strong** for the rules; **moderate** for the exact gutter treatment on a webcam tracker.

7. **Expect the bottom row to be the worse row and the bottom-right corner to be the worst spot.** Feit: precision drops toward the bottom and right edges; GazeSpeak: looking down is the least recognisable camera gesture (75 percent) and glasses cost about 10 points. Clarte's prototype puts the four letter groups, the most frequent actions, in the bottom row and G4 bottom-right. Either measure this on the repo's WebEyeTrack prototype before committing, or consider letters on top and controls on the bottom, and avoid putting Delete or End in the bottom-right quadrant. **Moderate** (desktop-tracker data and a phone-camera study; the laptop webcam case is untested).

8. **Audio is a first-class feedback channel.** Grid reads the cell label; GazeSpeak speaks the detected direction and the chosen word; TD Talk added typing sounds; Windows TTS speaks quick phrases immediately. The Clarte user hears normally and cannot keep eyes on the centre text while dwelling on a quadrant, so speak or tick on each group commit and speak the decoded word, and keep a static visual cue too (better-ui: motion is never the only feedback). **Strong.**

9. **One autocomplete slot is defensible if candidates can be cycled without a second interactive region.** SpeakFaster found five candidates useful but also found "significant" cognitive overhead and chose five for tablet screen size; GazeSpeak showed four with scrolling; Predictive Anchoring argues suggestions far from the point of action split attention. With the 8-quadrant cap, render the ranked candidates in the non-interactive centre area (large current candidate, smaller next ones), make the AC quadrant accept the current one, and let a repeat dwell on AC advance to the next candidate (GazeSpeak's "look right to hear the next prediction"). **Moderate.**

10. **Repair by swapping candidates and by word-level delete, not character backspace.** SpeakFaster designed correction without backspace (FillMask alternatives); GazeSpeak's per-character delete needed a wink or 2 s eye closure; TD Talk markets in-sentence editing. Clarte's D = delete last group / delete last word matches this; add an "alternatives for the last word" path through the AC slot so a wrong decode is one dwell away from the next candidate. **Strong.**

11. **The partner must see state and text.** AACrobat's three guidelines (autonomy, engage the partner, user controls sharing) and its idle/typing/speaking indicators; Lightwriter and TD Pilot partner displays; Proloquo4Text's "please be patient" quick message. In the Record phase show a clear "listening" state to the partner; in the Respond phase show "composing" and, if the user allows, the draft; provide one dwell for "please wait, I'm answering". Partner speech captured in Record is exactly the context SpeakFaster says gives the biggest LLM gains, so keep the last partner turn visible to the user while composing. **Strong.**

12. **Record (R1) and Respond (R2) in one quadrant is consistent with mode-toggle precedents, but the current mode must be unmistakable and the toggle must cost a long dwell.** Communicator's Toggle Pause smart button and Neuralink's side-rail mode switcher are single toggles with persistent state display. Use colour here and almost nowhere else (recording state is the one thing the screen must make findable, which also matches the repo's minimal-ui rule on colour). **Moderate.**

13. **Keep the group map fixed and alphabetical.** GazeSpeak chose alphabetical clusters for learnability over prediction efficiency and still got 83.5 percent unique sequences on 5,000 words with four groups; Speak for Yourself and Grid treat fixed positions as motor-memory features; first-time gaze users preferred familiar layouts in the ECU study. Clarte's A-F / G-N / O-S / T-Z is the same idea; verify the conflict rate with the backend's language model but do not reorder letters for frequency. **Strong** for fixed-and-alphabetical, **weak** on the specific split points.

14. **Blink as confirmation is a strain cost, not a free channel.** Tobii XR advises against blinks or eye gestures as the activation signal; GazeSpeak needed fallbacks because people with advanced ALS could not perform them. The repo's prototype uses a blink to preview and a second blink to confirm; keep blink optional as a second factor for high-cost actions, with dwell-only as the default. **Moderate.**

15. **Ship the tuning knobs that every product ships, in a one-step-away settings surface:** dwell times (two classes), smoothing, snap-to-quadrant, feedback style (ring, fill, audio on/off), look-away-before-reselect, pause sensitivity, and a track-status/positioning view (Tobii, Irisbond, iOS, Grid all expose these). Also a recalibrate affordance reachable by gaze, as iOS does with a corner dwell. **Strong.**

16. **Prefer mid-grey neutral surfaces with headroom for a brighter hover state, and consider dark surfaces for highlight visibility.** Meta: avoid pure black and pure white, use grey tones, dark backgrounds improve hover visibility; Apple: minimise visual noise and repeating textures. This supports the user's monotone, scientific direction and argues against saturated fills on every quadrant. The Neuralink "look" itself is undocumented in text and should not be cited as evidence. **Moderate.**

17. **Two-step selection is the known way to beat the 8-target limit later.** Tobii Gaze Selection two-step mode "reduces unwanted clicks"; iOS zooms the keyboard region on dwell and asks for a second dwell; OptiKey's simplified keyboard expands a 3-letter group into letters. If Clarte ever needs more than eight targets, zoom-into-quadrant (frontend quadrants inside one backend quadrant, one at a time) is the precedent, not a denser grid. **Weak/extrapolated** for Clarte, strong as a general pattern.

18. **Continuous steering (Dasher) is the main alternative paradigm.** It reached 25 wpm by gaze with one fifth the errors in a tiny study and avoids dwell fatigue, but needs a precise tracker and a learning hour. Worth one experimental variant only if the webcam tracker is steady enough; otherwise note it as the rejected alternative with a reason. **Weak/extrapolated.**

19. **Set speed expectations honestly.** Shipping gaze typing for ALS users sits near 10 wpm with a practical cap near 20; LLM phrase completion added 29 to 60 percent for two users. A four-group ambiguous keyboard trades letter-level certainty for fewer selections, so Clarte's win condition is selections per word, not letters per minute; instrument keystroke-saving rate as SpeakFaster did. **Strong.**

/**
 * S7 FAQ content — the SM2 FAQ tab text (docs/sources/05-sm2-faq-text.md),
 * copied into this module per 03-ui-design.md §5.7.
 *
 * Edits applied, and ONLY these (the one systematic edit allowed to
 * otherwise-verbatim copy, §1.3.2):
 *  - Every rendered "Traktor" / "Native Instruments" / "Spotify" carries ®.
 *    "Exportify" renders plain. Other vendor names (Serato, Pioneer DJ,
 *    Rekordbox) render plain.
 *  - The two SM3-note items are rewritten as directed by the source doc:
 *    the name-matching answer (relaxed by exportify-import.md §4
 *    normalization) and the "web app version" answer (moot — SM3 is it).
 *
 * Answers use \n for line breaks and \n\n for paragraph breaks; the Help
 * screen renders them with white-space: pre-line.
 */

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "what-is-setmaster",
    question: "What is RML SetMaster?",
    answer: `RML SetMaster is a DJ set preparation and analytics tool that connects your Spotify® playlists with your Native Instruments® Traktor® collection.

It helps answer questions such as:
Which tracks do I own but haven't played?
Which tracks are in my Super Playlists but not my performance sets?
Which genres and playlists am I drawing from most often?
Which tracks are becoming overplayed?
What music is available for future sets?

In addition to playlist analytics, SetMaster provides advanced multi-column sorting and filtering capabilities, allowing DJs to quickly narrow large collections by combinations of attributes such as:
Musical Key
BPM
Genre
Playlist Membership
Track Usage History
Custom Metadata

The goal is to make set preparation faster, more organized, and more intentional. DJ more, look through lists less!`,
  },
  {
    id: "super-playlist",
    question: "What is a Super Playlist?",
    answer: `A Super Playlist is a large master playlist containing hundreds of tracks grouped by:
Genre
Vibe
Energy level
Label
Artist style
Any broad category you choose

Examples:
BigRoomEnergy
DeepMelodic
ClassicFunk
90sHipHop

Super Playlists sit at the top of your music selection funnel and act as the source material for performance-ready DJ sets.`,
  },
  {
    id: "performance-set",
    question: "What is a Performance Set?",
    answer: `A Performance Set is a playlist created for:
A specific gig
A venue
A party
A livestream
A mood or occasion

Performance Sets are built by selecting tracks from one or more Super Playlists.`,
  },
  {
    // Rewritten for SM3 (source-doc SM3 note): matching is relaxed by the
    // normalization rule in exportify-import.md §4.
    id: "name-matching",
    question:
      "Why do playlist names need to match between Spotify® and Traktor®?",
    answer: `RML SetMaster uses playlist names to connect Spotify® playlists with Traktor® playlists. Matching is forgiving about formatting: spaces, underscores, and capitalization are ignored — but punctuation must match.

Example:
✅ Big Room Energy ↔ big_room_energy
✅ BigRoomEnergy ↔ BIGROOMENERGY
❌ Big Room Energy! ↔ BigRoomEnergy`,
  },
  {
    id: "one-folder",
    question: "Why do all Super Playlists need to be in one Traktor® folder?",
    answer: `The application needs a simple way to identify which playlists are Super Playlists.

By placing them inside a dedicated folder, SetMaster can automatically distinguish without requiring manual tagging.`,
  },
  {
    id: "organize-other-playlists",
    question: "Can I organize my other playlists however I want?",
    answer: `Yes. Only the Super Playlist folder follows a required structure.

All other playlists can:
Live in other folders
Live at the Traktor® root level
Follow your existing organization

The tool is designed to work alongside your current workflow.`,
  },
  {
    id: "modify-spotify",
    question: "Does the tool modify my Spotify® account?",
    answer: `No.
The tool only reads playlist information and metadata needed for analysis.
It does not - and cannot - modify your Spotify® playlists.`,
  },
  {
    id: "modify-traktor",
    question: "Does the tool modify my Traktor® collection?",
    answer: `No way.
SetMaster is designed as a read-only analysis tool.

The application reads information from your Traktor® collection file (collection.nml) but does not modify it in any way.

The code does not write to your Native Instruments® folders, does not alter playlist structures, does not update track metadata, and does not save changes back to your collection. Your music library remains exactly as it was before running the application.`,
  },
  {
    id: "what-file",
    question: "What file does SetMaster read from Traktor®?",
    answer: `The application reads your:
collection.nml
This file contains playlist structures, track metadata, and collection information used by the analysis engine.`,
  },
  {
    id: "what-data",
    question: "What data does SetMaster compare?",
    answer: `SetMaster can compare:
Spotify® playlists
Traktor® playlists
Track ownership
Playlist membership
Track usage across sets
Super Playlist coverage
Performance Set history
More coming soon!`,
  },
  {
    id: "why-created",
    question: "Why was SetMaster created?",
    answer: `Most DJs eventually accumulate thousands of tracks spread across dozens or hundreds of playlists.
At the same time, modern music discovery often happens away from the DJ booth. New music gets saved from mobile phones, road trips, flights, coffee shops, recommendation engines, and late-night listening sessions. Spotify® and other streaming platforms becomes the top of the funnel where discovery happens, while Traktor® (or another DJ program) becomes the place where performance sets are built.

After years of collecting thousands of tracks across both platforms, it becomes difficult to answer simple questions:
Which tracks need to be purchased?
What haven't I played yet?
What am I overplaying?
Which tracks belong in future sets?
Which playlists are producing the best results?
Which Spotify® discoveries have never made it into a live set?

SetMaster was created to bridge the gap between music discovery, advanced set preparation, and reliable set list management during gigs.`,
  },
  {
    id: "only-traktor",
    question: "Is SetMaster only for Traktor® users?",
    answer: `The current version is built around Native Instruments® Traktor®.
Support for Pioneer DJ Rekordbox and Serato is planned for future versions.`, // "prototype" → "version": SM3 is no longer the prototype
  },
  {
    // Rewritten for SM3 (source-doc SM3 note): the question is moot — SM3
    // is the web-app version.
    id: "web-app",
    question: "Will there be a web app version of SetMaster?",
    answer: `There already is — you're using it.
SetMaster 3 is the web-app version of SetMaster: a local backend plus your browser, running entirely on your own computer. It is fully offline — no cloud services, no accounts, and your data never leaves your machine.`,
  },
  {
    id: "affiliation",
    question:
      "Is RML SetMaster affiliated with Native Instruments®, Spotify®, or any other music software company?",
    answer: `No. RML SetMaster is an independent fan-created software project developed by a DJ and music enthusiast to improve playlist management, set preparation, and music collection analytics. The project is not affiliated with, endorsed by, sponsored by, or associated with Native Instruments®, Spotify®, Serato, Pioneer DJ, Rekordbox, or any other software or hardware manufacturer.

All trademarks, product names, and platform names remain the property of their respective owners.
RML SetMaster is simply a tool designed to work alongside the platforms DJs already use and love.`,
  },
  {
    id: "finished",
    question: "Is SetMaster finished?",
    answer: `Not even close.

The current version already solves real playlist-management and set-preparation problems, but there are many additional features planned, including:
Advanced playlist analytics
Collection health metrics
Recommendation engines
Set-building workflows
Visualization tools
Expanded music platform support

This is just the beginning.`, // "prototype" → "version"; "Web application functionality" dropped from the list (shipped)
  },
  {
    id: "feedback",
    question: "Where can I report bugs or suggest features?",
    answer: `Feedback is extremely valuable and helps shape the future direction of the platform.

You can:
Open an issue in the GitHub repository
Submit feature requests
Report bugs
Share workflow ideas and feedback

Contact: vibes@ryanmusiclife.com`,
  },
];

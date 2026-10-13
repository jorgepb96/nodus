# Retired startup announcements

Retired on 2026-10-13, during development of Nodus 5.9.1. These historical
components are kept outside `src` and must not be imported by application entry
points. They no longer appear on new or existing installations, regardless of
their old local-storage markers or tutorial versions.

| Announcement | Historical component |
| --- | --- |
| Nodus Presenter video tutorial | `PdfPresenterTutorialAnnouncement.tsx` |
| Mobile app preview (3.2.4) | `MobileTeaserGuide.tsx` |
| MCP, Nodus Server, Zotero and Toolkit overview | `PlatformHighlightsGuide.tsx` (`PlatformHighlightsUpdateTour`) |
| Toolkit beta and model guidance (2.4.0) | `ToolkitBetaGuide.tsx` (`ToolkitBetaUpdateTour`) |
| Video tutorial catalogue | `TutorialVideosGuide.tsx` (`TutorialVideosUpdateTour`) |

The platform and model-guidance panels still used by `BasicsTutorial` remain in
`src/components/PlatformHighlightsGuide.tsx` and `src/components/ToolkitBetaGuide.tsx`.
The video catalogue and players remain available through the current tutorials
and Settings → Help. General release notes (`WhatsNewModal`), the library
tutorial, research preparation welcome and Nodi style choice remain active.

Historical imports point to current shared UI and assets so the Presenter visual
harness can still render the archived announcement. Tests may inspect these
snapshots; the application must never load them. Old local-storage markers are
left untouched and are no longer read or written by the application.

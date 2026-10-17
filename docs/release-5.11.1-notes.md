# Nodus 5.11.1

## New features

No changes in this section.

## Enhancements

- In Nodus Sign you can draw your handwritten signature with a finger on the trackpad. On macOS the drawing area shows the trackpad to scale, so its edges are the real limits and no stroke is cut off. On Windows and Linux the cursor is locked and draws while you hold the trackpad down. Before saving, you can crop the signature with an adjustable frame. The editor tools are now icons with tooltips.

- In Nodus Sign you move signatures on the page with the mouse and resize them from eight handles. Corners keep the proportions, and Shift frees them. Edges stretch one side. The exact percentages are still available under Precise adjustment. A certificate signature no longer has to show anything on the document. If you turn off its appearance, the PDF looks unchanged and PDF readers show the signature in their signatures panel.

## Fixes

- The Nodus Sign signing engine now installs on macOS. In 5.11.0 the installation always ended with a connection error, although the download worked. Nodus now uses a compatible Python on your computer or downloads its own.

- Plugins that use Python work even when the default python3 is newer than they support. Nodus picks another installed version the plugin supports. If there is none, the message lists the supported versions and the ones found.

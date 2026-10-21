# Release policy

This is the procedure for preparing and publishing every Nodus release, including
hotfixes. [Release notes and GitHub descriptions](release-notes-authoring.md)
covers how the notes are written and generated, and
[CONTRIBUTING.md](../CONTRIBUTING.md#publishing-releases) covers the release
workflows.

## 1. Choose the version (SemVer)

- **Major (x.0.0):** changes that are incompatible with earlier versions, or a
  major architectural restructuring.
- **Minor (0.x.0):** new features that are compatible with earlier versions, for
  example Nodus Scriptor.
- **Patch (0.0.x):** bug fixes and small compatible adjustments.

## 2. Update every version identifier

Update the version and its slugs and references in every place that records it.
The previous release preparation commit lists those files. The desktop app, Nodus
Server and the browser extension share one version number.

## 3. Write the What's New modal

- Write the modal in every language available in the interface.
- Use the three current sections: **New features**, **Enhancements**, **Fixes**.
- Register each new main feature in the section that matches it.

## 4. Write the release notes

- Use clear, direct and concise language for each feature or fix. Avoid
  metaphors and figurative expressions. Add detail only when a feature needs it.
- Document only the final features and fixes that ship for the first time.
  Leave out intermediate adjustments and successive corrections made before
  they were released.

## 5. Publish and merge

- Confirm that the modal is fully translated into every language.
- Open the issue and the pull request in English.
- Merge into `main` as soon as CI finishes green.

## 6. Deploy the release

Monitor the process and start the publication workflow for the release
immediately after the merge. Make sure every check passes.

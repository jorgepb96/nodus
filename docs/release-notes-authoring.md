# Release notes and GitHub descriptions

From Nodus 5 onward, each release has three sections, in this order:
**New features**, **Enhancements**, **Fixes**. Every section heading and empty-state
message is translated into all twelve interface languages. Versions before 5
retain their original layout. Historical v5 text and icons are preserved.

Add the new version at the beginning of `shared/releaseNotes.ts`. Author its
highlights with `CategorizedReleaseHighlight`, providing `category` (`new`,
`enhancement`, `fix`), the relevant `scope`, and all twelve translations. Each
section groups highlights by scope, largest group first, with stable ties and
original order within a group. Register the six companion language maps
(`it`, `tr`, `zh-CN`, `zh-TW`, `ja`, `ko`) from the new highlights, as in the
existing releases. The modal and the description generator share
`shared/releaseNotesPresentation.ts` so their order cannot diverge.

Describe observable behaviour in literal, clear sentences. Keep each entry brief
unless using the feature requires more detail. A new feature appears once with
its final behaviour. Fold all corrections made before its first release into
that description, rather than documenting intermediate implementation steps.
Document corrections to previously released behaviour under Fixes.

Generate the complete English release description:

```sh
npm run release:notes -- v5.8.1 /tmp/nodus-release-notes.md
```

The tag must match `package.json`. Missing modal notes, missing translations,
missing categories, or inconsistent release dates stop generation. To check a
saved description, add `--check` after the output path.

The shared stable/beta workflow generates the body from the checked-out tag
before creating or reusing the draft, and regenerates it immediately before
publication. Both final publication commands require that body with
`--notes-file`. No manually authored GitHub body is needed. Manual publication
outside this workflow must also use the generated file.

Validate with `node --test scripts/test-release-note-sections.mjs` and
`node scripts/test-release-notes.mjs`. The visual check uses the real modal via
`visual-tests/release-notes-harness.html` and checks its texts, sections, order,
icons and older-version picker in every interface language.

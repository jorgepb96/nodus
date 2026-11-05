import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [editor, picker, social, tree, dossier, dossierLayout, people, settings, styles, kinshipModel, relationsView] = await Promise.all([
  readFile(path.join(root, 'src/components/KinshipEditor.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PersonMultiSelect.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/RelationsSection.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/TreeView.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PersonDossier.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/personDossierLayout.ts'), 'utf8'),
  readFile(path.join(root, 'src/views/PersonasView.tsx'), 'utf8'),
  readFile(path.join(root, 'shared/defaultAppSettings.ts'), 'utf8'),
  readFile(path.join(root, 'src/index.css'), 'utf8'),
  readFile(path.join(root, 'shared/treeKinship.ts'), 'utf8'),
  readFile(path.join(root, 'src/views/RelationsView.tsx'), 'utf8'),
]);

test('tree sidebar and person dossier share the persistent relationship editor', () => {
  assert.match(tree, /<KinshipEditor person=\{person\} persons=\{persons\}/);
  assert.match(dossier, /<KinshipEditor/);
  assert.match(editor, /listRelationships\(person\.personId\)/);
  assert.match(editor, /updateRelationship\(/);
  assert.match(editor, /removeRelationship\(/);
});

test('tree routes parentage by family units instead of overlapping independent elbows', () => {
  assert.match(tree, /buildTreeFamilies/);
  assert.match(tree, /families\.map/);
  assert.match(tree, /treeFamilyLaneY/);
  assert.match(tree, /layout\.edges\.filter\(\(edge\) => edge\.kind !== 'parent'\)/);
  assert.doesNotMatch(tree, /const midY = \(a\.y \+ b\.y\) \/ 2/);
});

test('tree viewport supports drag panning without activating a person after movement', () => {
  assert.match(tree, /data-testid="tree-pan-viewport"/);
  assert.match(tree, /onPointerDown=\{startPan\}/);
  assert.match(tree, /viewport\.scrollLeft = pan\.scrollLeft - dx/);
  assert.match(tree, /viewport\.scrollTop = pan\.scrollTop - dy/);
  assert.match(tree, /suppressTreeClickRef/);
  assert.match(tree, /cursor-grabbing/);
});

test('tree people keep click gestures outside viewport pointer capture and focus in the visible centre', () => {
  assert.match(tree, /data-tree-person-id=\{n\.personId\}/);
  assert.match(tree, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(tree, /onClick=\{\(\) => setSelected\(n\.personId\)\}/);
  assert.match(tree, /onDoubleClick=\{\(\) => changeFocus\(n\.personId\)\}/);
  assert.match(tree, /pendingCenterIdRef\.current = nextFocusId/);
  assert.match(tree, /viewport\.scrollBy\(\{/);
  assert.match(tree, /nodeRect\.left \+ nodeRect\.width \/ 2/);
  assert.match(tree, /nodeRect\.top \+ nodeRect\.height \/ 2/);
  assert.match(tree, /data-testid="tree-person-sidebar"/);
});

test('paternal and maternal colours are the only user-selectable tree branch colours', () => {
  assert.match(tree, /data-testid="tree-paternal-color"/);
  assert.match(tree, /data-testid="tree-maternal-color"/);
  assert.equal((tree.match(/type="color"/g) ?? []).length, 2);
  assert.match(settings, /treePaternalColor: '#2563eb'/);
  assert.match(settings, /treeMaternalColor: '#dc2626'/);
  assert.match(styles, /\.light \.tree-branch-color-control/);
});

test('paternal and maternal branches can be hidden independently and persist per vault', () => {
  assert.match(tree, /data-testid="tree-paternal-visibility"/);
  assert.match(tree, /data-testid="tree-maternal-visibility"/);
  assert.match(tree, /treePaternalBranchVisible: !paternalBranchVisible/);
  assert.match(tree, /treeMaternalBranchVisible: !maternalBranchVisible/);
  assert.match(tree, /branch === 'paternal' && !paternalBranchVisible/);
  assert.match(tree, /branch === 'maternal' && !maternalBranchVisible/);
  assert.match(tree, /visibleParentEdges/);
  assert.match(tree, /visibleSpouseEdges/);
  assert.match(tree, /visibleSiblingEdges/);
  assert.match(settings, /treePaternalBranchVisible: true/);
  assert.match(settings, /treeMaternalBranchVisible: true/);
  assert.match(styles, /\.tree-branch-color-control\.is-hidden/);
  assert.match(styles, /\.light \.tree-branch-color-control\.is-hidden/);
});

test('the parental junction mixes configured colours and focus descendants use genealogy gold', () => {
  assert.match(tree, /mixBranchColors/);
  assert.match(tree, /treeDescendantLineIds/);
  assert.match(tree, /treeFamilyConnectorRole/);
  assert.match(tree, /connectorRole === 'focus_descendants'[\s\S]*GENEALOGY_GOLD/);
  assert.match(tree, /connectorRole === 'parental_merge'[\s\S]*mergedParentColor/);
  assert.match(tree, /data-tree-line-role=\{connectorRole\}/);
  assert.match(tree, /const GENEALOGY_GOLD = '#ca8a04'/);
});

test('each person displays an explicit relationship label relative to the focus', () => {
  assert.match(tree, /deriveTreeKinship/);
  assert.match(tree, /treeKinshipLabel/);
  assert.match(tree, /getActiveLang/);
  assert.match(tree, /relationDisplayLabel/);
  assert.match(tree, /relationLabel/);
  assert.match(kinshipModel, /Abuelo paterno/);
  assert.match(kinshipModel, /Tía materna/);
  assert.match(kinshipModel, /Tatarabuelo/);
  assert.match(kinshipModel, /Tataranieto/);
  assert.match(kinshipModel, /Tío abuelo paterno/);
  assert.match(tree, /treeFocusPersonId/);
  assert.match(tree, /data-testid="tree-focus-person"/);
  assert.match(tree, /data-testid=\{`tree-kinship-tag-\$\{n\.personId\}`\}/);
  assert.match(tree, /onDoubleClick=\{\(\) => changeFocus\(n\.personId\)\}/);
});

test('relationship selectors search and allow several relatives without closing', () => {
  assert.match(editor, /<PersonMultiSelect/);
  assert.match(people, /<PersonMultiSelect/);
  assert.match(picker, /Buscar familiar…/);
  assert.match(picker, /aria-multiselectable="true"/);
  assert.match(picker, /type="checkbox"/);
  assert.match(picker, /createPortal/);
  assert.match(picker, /const nextStyle = calculatePopoverStyle\(\);[\s\S]*setPopoverStyle\(nextStyle\);[\s\S]*setOpen\(true\);/);
  assert.match(picker, /person-multi-select-popover fixed/);
  assert.match(picker, /style=\{\{ paddingLeft: '1\.9rem' \}\}/);
  assert.match(editor, /maxSelected=\{choice === 'child_of' \? 2 : undefined\}/);
  assert.match(editor, /kinshipRelationshipSpecsForPeople/);
});

test('family and social relation additions use symmetric clean modal flows', () => {
  assert.match(editor, /Relaciones familiares/);
  assert.match(social, /Relaciones sociales/);
  assert.match(editor, /modalOpen && createPortal/);
  assert.match(social, /return createPortal/);
  assert.match(editor, /role="dialog" aria-modal="true"/);
  assert.match(social, /role="dialog" aria-modal="true"/);
  assert.match(social, /function EditRelationModal/);
  assert.doesNotMatch(social, /function EditRelationForm/);
  assert.match(editor, /PERSON_DOSSIER_SECTION_CLASS/);
  assert.match(social, /PERSON_DOSSIER_SECTION_CLASS/);
  assert.doesNotMatch(tree, /t\('Añadir parentesco'\)/);
});

test('social modal provides searchable multi-selection for predefined roles and targets', () => {
  assert.match(social, /SOCIAL_RELATION_TYPES/);
  assert.match(social, /'Amistad'/);
  assert.match(social, /'Patronazgo'/);
  assert.match(social, /'Correspondencia'/);
  assert.match(social, /testId="social-role-selector"/);
  assert.match(social, /testId="social-target-selector"/);
  assert.match(social, /selectedIds=\{selectedRoles\}/);
  assert.match(social, /selectedIds=\{selectedTargets\}/);
  assert.match(social, /for \(const target of targets\)/);
  assert.match(social, /for \(const role of selectedRoles\)/);
  assert.doesNotMatch(social, /function AddRelationForm/);
});

test('relationship editor keeps chronology review and repair actions', () => {
  assert.match(editor, /parentAgeWarning/);
  assert.match(editor, /Invertir/);
  assert.match(editor, /Editar parentesco/);
  assert.match(people, /Relación inicial \(opcional\)/);
  assert.match(people, /data-testid="new-person-initial-relation-kind"/);
  assert.match(people, /Relación familiar inicial/);
  assert.match(people, /Relación social inicial/);
  assert.match(people, /createSocialRelation/);
});

test('dossier action buttons grow for translated labels without overflowing', () => {
  assert.match(dossier, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(dossierLayout, /h-auto min-h-9 min-w-44/);
  assert.match(dossierLayout, /whitespace-normal/);
  assert.match(dossierLayout, /px-4 py-2 text-center/);
  assert.doesNotMatch(dossierLayout, /[' ]w-44(?:[' ])/);
});

test('people list leaves room above the first selectable person', () => {
  assert.match(people, /data-testid="persons-list"[^>]*className="[^"]*overflow-y-auto[^"]*pt-2[^"]*"/);
});

test('the social network labels contacts, which Sigma hides by size by default', () => {
  // Contacts are drawn smaller than people; Sigma skips the label of any node under
  // labelRenderedSizeThreshold (default 6), which rendered every contact as an
  // anonymous dot. The network exists to name who is who, so the threshold is off.
  assert.match(relationsView, /labelRenderedSizeThreshold: 0/);
  assert.match(relationsView, /renderLabels: true/);
});

import { TutorPanel } from "./TutorPanel";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import type { AppSettings } from "@shared/types";
import type { GraphNavigationTarget } from "../navigation";
import {
  academicKnowledgeViewSource,
  type KnowledgeViewSource,
} from "./knowledgeViewSource";
import { StellarWorkspace } from "../stellarGraph/StellarWorkspace";
import { desktopSource } from "../stellarGraph/source";
import { ThemesModal } from "./ThemesModal";
import { IdeaDuplicatesModal } from "./IdeaDuplicatesModal";
import { EdgeAuditModal } from "./EdgeAuditModal";
import { t } from "../i18n";
import { Icon } from "../components/ui";
import type { StellarWorkspaceSnapshot } from "../stellarGraph/snapshot";
export function GraphView({
  settings,
  onSettingsChange,
  target,
  dataSource = academicKnowledgeViewSource,
  scopeControl,
  testId,
  snapshot,
  onSnapshotChange,
  onEditManualIdea,
  mobile = false,
  onFullscreenChange,
}: {
  onEditManualIdea?: (noteId: string) => void;
  settings: AppSettings;
  onSettingsChange: () => void;
  target?: GraphNavigationTarget | null;
  dataSource?: KnowledgeViewSource;
  scopeControl?: ReactNode;
  testId?: string;
  snapshot?: StellarWorkspaceSnapshot;
  onSnapshotChange?(snapshot: StellarWorkspaceSnapshot): void;
  mobile?: boolean;
  onFullscreenChange?(fullscreen: boolean): Promise<void>;
}) {
  const [tutorTarget, setTutorTarget] = useState<GraphNavigationTarget | null>(
    null,
  );
  const [modal, setModal] = useState(target?.openTutor ? "tutor" : ""),
    [revision, setRevision] = useState(0);
  const source = useMemo(
    () => {
      const source = desktopSource(
        dataSource,
        `${dataSource.key}:${target?.workId || "corpus"}`,
      );
      return mobile ? {...source, readOnly: true, restore: undefined, save: undefined} : source;
    },
    [dataSource, target?.workId, revision, mobile],
  );
  useEffect(
    () => dataSource.subscribe?.(() => setRevision((v) => v + 1)),
    [dataSource],
  );
  const close = () => {
    setModal("");
    setRevision((v) => v + 1);
  };
  const actions = settings.academicMode === 'manual' ? [] : [
    ...(dataSource.capabilities.tutor
      ? [{ id: "tutor", label: "Tutor", icon: "tutorOrbit" }]
      : []),
    ...(dataSource.capabilities.manageThemes
      ? [{ id: "themes", label: "Temas", icon: "themePetals" }]
      : []),
    ...(dataSource.capabilities.duplicates
      ? [{ id: "duplicates", label: "Ideas duplicadas", icon: "duplicateConverge" }]
      : []),
    ...(dataSource.capabilities.audit
      ? [{ id: "audit", label: "Auditoría de relaciones", icon: "relationLedger" }]
      : []),
  ];
  return (
    <div className="h-full min-h-0" data-testid={testId || "graph-view"}>
      <StellarWorkspace
        source={source}
        onFullscreenChange={onFullscreenChange}
        onEditIdea={settings.academicMode === 'manual' ? onEditManualIdea : undefined}
        snapshot={snapshot}
        onSnapshotChange={onSnapshotChange}
        navigationKey={tutorTarget?.nonce || target?.nonce}
        workId={target?.workId}
        initialSeed={
          tutorTarget?.nodeId ||
          (target?.preset === "authors" ? undefined : target?.nodeId)
        }
        initialEdge={tutorTarget?.edgeId || target?.edgeId}
        initialSearch={target?.search || target?.theme}
        author={target?.preset === "authors" ? target?.label : undefined}
        title={target?.workTitle}
        openEvidence={dataSource.openEvidence}
        saveIdea={mobile ? undefined : dataSource.saveIdea}
        saveEdge={mobile ? undefined : dataSource.saveEdge}
        audit={settings.academicMode !== 'manual' && dataSource.capabilities.audit}
        sidebar={modal === "tutor" ? (
          <TutorPanel
            settings={settings}
            onClose={close}
            onClearFocus={() => setTutorTarget(null)}
            onFocusStop={(stop) =>
              setTutorTarget({
                nonce: Date.now(),
                nodeId: stop.nodeIds.find((id) => !id.startsWith("theme:")),
                edgeId: stop.edgeId || undefined,
              })
            }
          />
        ) : undefined}
        toolbar={
          <>
            {scopeControl}
            {actions.length > 0 && (
              <div className="graph-action-strip" role="toolbar" aria-label={t("Herramientas de investigación")}>
                {actions.map((action) => {
                  const label = t(action.label);
                  return (
                    <button
                      type="button"
                      key={action.id}
                      className={`graph-action-button ${modal === action.id ? "active" : ""}`}
                      aria-label={label}
                      aria-pressed={modal === action.id}
                      title={label}
                      data-testid={`graph-action-${action.id}`}
                      onClick={() => setModal(modal === action.id ? "" : action.id)}
                    >
                      <Icon name={action.icon} size={16} />
                      <span className="graph-action-tooltip" role="tooltip">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        }
      />
      {modal === "themes" && (
        <ThemesModal
          settings={settings}
          onSettingsChange={onSettingsChange}
          onReprocessed={() => setRevision((v) => v + 1)}
          onClose={close}
        />
      )}
      {modal === "duplicates" && <IdeaDuplicatesModal onClose={close} />}
      {modal === "audit" && (
        <EdgeAuditModal
          onClose={close}
          onChanged={() => setRevision((v) => v + 1)}
        />
      )}
    </div>
  );
}

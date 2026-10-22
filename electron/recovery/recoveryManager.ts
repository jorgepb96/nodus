import fs from 'node:fs';
import path from 'node:path';
import type {
  AppLanguage,
  RecoveryFolderInspection,
  RecoveryHealth,
  RecoverySetupResult,
  RecoveryRestoreProgress,
  RecoverySnapshotSummary,
  RecoveryStatus,
} from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { restoreBackupArchiveFileSafely } from '../export/exportImport';
import { runAutoBackupNow } from '../export/autoBackup';
import {
  clearBackupPassword,
  clearBackupRecoveryKey,
  getBackupPassword,
  getBackupRecoveryKey,
  hasBackupPassword,
  setBackupPassword,
  setBackupRecoveryKey,
} from '../secrets/secretStore';
import { generateBackupPassword } from '../export/backupCrypto';
import { listVaults } from '../vaults/vaultRegistry';
import {
  createRecoveryManifest,
  readRecoveryManifest,
  recoveryManifestPath,
  recoverySnapshotsDir,
  visibleDirectoryEntries,
  writeRecoveryManifest,
} from './recoveryPaths';
import {
  snapshotSummary,
  type RecoveryFolderProbe,
} from './recoveryFolderProbe';
import {
  INTERACTIVE_RECOVERY_PROBE_TIMEOUT_MS,
  STARTUP_RECOVERY_PROBE_TIMEOUT_MS,
  probeRecoveryFolderInUtility,
} from './recoveryProbeUtilityHost';
import { validateBackupPassword } from '@shared/backupPasswordPolicy';
import { knownRuntimeErrorText } from '@shared/uiLanguage';

export const RECOVERY_SETUP_VERSION = 1;

/**
 * The main process cannot reach the renderer's i18n table, so the handful of
 * user-facing recovery strings are localized inline. A language with no entry falls
 * back to English, matching `src/i18n.ts`'s <lang> → EN chain.
 */
type RecoveryStrings = Partial<Record<AppLanguage, string>> & { es: string; en: string };
const tr = (language: AppLanguage, values: RecoveryStrings) => values[language] ?? values.en;

function localizeRestoreMessage(message: string, language: AppLanguage): string {
  if (language === 'es') return message;
  const pick = (values: Omit<RecoveryStrings, 'es'>) => values[language] ?? values.en;
  if (message.includes('No se pudo descifrar la copia')) return pick({ en: 'The snapshot could not be decrypted. Check the password or recovery key.', fr: 'La sauvegarde n\'a pas pu être déchiffrée. Vérifiez le mot de passe ou la clé de récupération.', de: 'Die Sicherung konnte nicht entschlüsselt werden. Überprüfen Sie das Passwort oder den Wiederherstellungsschlüssel.', pt: 'Não foi possível desencriptar a cópia de segurança. Verifique a palavra-passe ou a chave de recuperação.', 'pt-BR': 'Não foi possível descriptografar o backup. Verifique a senha ou a chave de recuperação.', it: 'Impossibile decifrare la copia. Controlla la password o la chiave di ripristino.', tr: 'Anlık görüntünün şifresi çözülemedi. Parolayı veya kurtarma anahtarını kontrol edin.', 'zh-CN': '无法解密该快照。请检查密码或恢复密钥。' ,
  'zh-TW': '無法解密該快照。請檢查密碼或恢復金鑰。',
  ko: "스냅샷을 해독할 수 없습니다. 비밀번호나 복구 키를 확인하세요.",
  ja: "スナップショットを復号化できませんでした。パスワードまたは回復キーを確認してください。", });
  if (message.includes('falta la contraseña')) return pick({ en: 'Restore cancelled: enter the password or recovery key.', fr: 'Restauration annulée : saisissez le mot de passe ou la clé de récupération.', de: 'Wiederherstellung abgebrochen: Geben Sie das Passwort oder den Wiederherstellungsschlüssel ein.', pt: 'Restauração cancelada: introduza a palavra-passe ou a chave de recuperação.', 'pt-BR': 'Restauração cancelada: digite a senha ou a chave de recuperação.', it: 'Ripristino annullato: inserisci la password o la chiave di ripristino.', tr: 'Geri yükleme iptal edildi: parolayı veya kurtarma anahtarını girin.', 'zh-CN': '恢复已取消：请输入密码或恢复密钥。' ,
  'zh-TW': '恢復已取消：請輸入密碼或恢復金鑰。',
  ko: "복원이 취소되었습니다. 비밀번호 또는 복구 키를 입력하세요.",
  ja: "復元がキャンセルされました: パスワードまたは回復キーを入力してください。", });
  if (message.includes('Formato de copia de seguridad no soportado')) return pick({ en: 'This backup format is not supported.', fr: 'Ce format de sauvegarde n\'est pas pris en charge.', de: 'Dieses Sicherungsformat wird nicht unterstützt.', pt: 'Este formato de cópia de segurança não é suportado.', 'pt-BR': 'Este formato de backup não é suportado.', it: 'Questo formato di backup non è supportato.', tr: 'Bu yedekleme biçimi desteklenmiyor.', 'zh-CN': '不支持此备份格式。' ,
  'zh-TW': '不支援此備份格式。',
  ko: "이 백업 형식은 지원되지 않습니다.",
  ja: "このバックアップ形式はサポートされていません。", });
  if (message.includes('los hashes internos no coinciden')) return pick({ en: 'Invalid snapshot: its integrity hashes do not match.', fr: 'Sauvegarde invalide : ses hachages d\'intégrité ne correspondent pas.', de: 'Ungültige Sicherung: Die Integritäts-Hashes stimmen nicht überein.', pt: 'Cópia de segurança inválida: os hashes de integridade não coincidem.', 'pt-BR': 'Backup inválido: os hashes de integridade não coincidem.', it: 'Copia non valida: gli hash di integrità non corrispondono.', tr: 'Geçersiz anlık görüntü: bütünlük karmaları eşleşmiyor.', 'zh-CN': '无效快照：其完整性哈希不匹配。' ,
  'zh-TW': '無效快照：其完整性雜湊不匹配。',
  ko: "잘못된 스냅샷: 무결성 해시가 일치하지 않습니다.",
  ja: "無効なスナップショット: 整合性ハッシュが一致しません。", });
  if (message.includes('falta la clave de recuperación cifrada')) return pick({ en: 'Invalid snapshot: the encrypted recovery key is missing.', fr: 'Sauvegarde invalide : la clé de récupération chiffrée est manquante.', de: 'Ungültige Sicherung: Der verschlüsselte Wiederherstellungsschlüssel fehlt.', pt: 'Cópia de segurança inválida: falta a chave de recuperação encriptada.', 'pt-BR': 'Backup inválido: falta a chave de recuperação criptografada.', it: 'Copia non valida: manca la chiave di ripristino cifrata.', tr: 'Geçersiz anlık görüntü: şifrelenmiş kurtarma anahtarı eksik.', 'zh-CN': '无效快照：缺少加密的恢复密钥。' ,
  'zh-TW': '無效快照：缺少加密的恢復金鑰。',
  ko: "잘못된 스냅샷: 암호화된 복구 키가 누락되었습니다.",
  ja: "無効なスナップショット: 暗号化された回復キーがありません。", });
  if (message.includes('falta el manifiesto interno')) return pick({ en: 'Invalid snapshot: its internal manifest is missing.', fr: 'Sauvegarde invalide : son manifeste interne est manquant.', de: 'Ungültige Sicherung: Das interne Manifest fehlt.', pt: 'Cópia de segurança inválida: falta o manifesto interno.', 'pt-BR': 'Backup inválido: falta o manifesto interno.', it: 'Copia non valida: manca il manifesto interno.', tr: 'Geçersiz anlık görüntü: dahili manifestosu eksik.', 'zh-CN': '无效快照：缺少其内部清单。' ,
  'zh-TW': '無效快照：缺少其內部清單。',
  ko: "잘못된 스냅샷: 내부 매니페스트가 누락되었습니다.",
  ja: "無効なスナップショット: 内部マニフェストがありません。", });
  if (message.includes('faltan manifest o datos cifrados')) return pick({ en: 'Invalid .nodus file: its manifest or encrypted data is missing.', fr: 'Fichier .nodus invalide : son manifeste ou ses données chiffrées sont manquants.', de: 'Ungültige .nodus-Datei: Das Manifest oder die verschlüsselten Daten fehlen.', pt: 'Ficheiro .nodus inválido: falta o manifesto ou os dados encriptados.', 'pt-BR': 'Arquivo .nodus inválido: falta o manifesto ou os dados criptografados.', it: 'File .nodus non valido: manca il manifesto o mancano i dati cifrati.', tr: 'Geçersiz .nodus dosyası: manifestosu veya şifrelenmiş verileri eksik.', 'zh-CN': '无效的 .nodus 文件：缺少清单或加密数据。' ,
  'zh-TW': '無效的 .nodus 檔案：缺少清單或加密資料。',
  ko: "잘못된.nodus 파일: 매니페스트 또는 암호화된 데이터가 누락되었습니다.",
  ja: "無効な .nodus ファイル: マニフェストまたは暗号化されたデータが欠落しています。", });
  if (message.includes('esquema más reciente')) return pick({ en: 'This snapshot was created by a newer Nodus version. Update the app before restoring it.', fr: 'Cette sauvegarde a été créée par une version plus récente de Nodus. Mettez à jour l\'application avant de la restaurer.', de: 'Diese Sicherung wurde mit einer neueren Nodus-Version erstellt. Aktualisieren Sie die App, bevor Sie sie wiederherstellen.', pt: 'Esta cópia de segurança foi criada com uma versão mais recente do Nodus. Atualize a aplicação antes de a restaurar.', 'pt-BR': 'Este backup foi criado com uma versão mais recente do Nodus. Atualize o aplicativo antes de restaurá-lo.', it: 'Questa copia è stata creata con una versione più recente di Nodus. Aggiorna l’app prima di ripristinarla.', tr: 'Bu anlık görüntü daha yeni bir Nodus sürümüyle oluşturuldu. Geri yüklemeden önce uygulamayı güncelleyin.', 'zh-CN': '此快照由更新版本的 Nodus 创建。请先更新应用再恢复。' ,
  'zh-TW': '此快照由更新版本的 Nodus 建立。請先更新應用再恢復。',
  ko: "이 스냅샷은 최신 Nodus 버전으로 생성되었습니다. 복원하기 전에 앱을 업데이트하세요.",
  ja: "このスナップショットは、新しい Nodus バージョンによって作成されました。復元する前にアプリを更新してください。", });
  if (message.includes('reversión automática')) return pick({ en: `Restore failed, but Nodus attempted to preserve the previous state. ${message}`, fr: `La restauration a échoué, mais Nodus a tenté de préserver l'état précédent. ${message}`, de: `Die Wiederherstellung ist fehlgeschlagen, aber Nodus hat versucht, den vorherigen Zustand zu erhalten. ${message}`, pt: `A restauração falhou, mas o Nodus tentou preservar o estado anterior. ${message}`, 'pt-BR': `A restauração falhou, mas o Nodus tentou preservar o estado anterior. ${message}`, it: `Il ripristino non è riuscito, ma Nodus ha tentato di conservare lo stato precedente. ${message}`, tr: `Geri yükleme başarısız oldu ancak Nodus önceki durumu korumaya çalıştı. ${message}`, 'zh-CN': `恢复失败，但 Nodus 尝试保留了之前的状态。${message}` ,
  'zh-TW': `恢復失敗，但 Nodus 嘗試保留了之前的狀態。${message}`, });
  if (message.includes('restauración se canceló antes de modificar')) return pick({ en: `Restore was cancelled before changing your data. ${message}`, fr: `La restauration a été annulée avant toute modification de vos données. ${message}`, de: `Die Wiederherstellung wurde abgebrochen, bevor Ihre Daten geändert wurden. ${message}`, pt: `A restauração foi cancelada antes de alterar os seus dados. ${message}`, 'pt-BR': `A restauração foi cancelada antes de alterar seus dados. ${message}`, it: `Il ripristino è stato annullato prima di modificare i tuoi dati. ${message}`, tr: `Verileriniz değiştirilmeden önce geri yükleme iptal edildi. ${message}`, 'zh-CN': `恢复在更改数据之前已取消。${message}` ,
  'zh-TW': `恢復在更改資料之前已取消。${message}`, });
  return message;
}

export function inspectRecoveryFolder(folder: string, language: AppLanguage = 'es'): RecoveryFolderInspection {
  const clean = path.resolve(folder);
  if (!fs.existsSync(clean)) return { path: clean, kind: 'missing', message: tr(language, { es: 'La carpeta no existe.', en: 'The folder does not exist.', fr: "Le dossier n'existe pas.", de: 'Der Ordner existiert nicht.', pt: 'A pasta não existe.', 'pt-BR': 'A pasta não existe.', it: 'La cartella non esiste.', tr: 'Klasör mevcut değil.', 'zh-CN': '该文件夹不存在。' ,
  'zh-TW': '該資料夾不存在。',
  ko: "폴더가 존재하지 않습니다.",
  ja: "フォルダが存在しません。", }), snapshots: [] };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(clean);
  } catch {
    return { path: clean, kind: 'missing', message: tr(language, { es: 'No se puede acceder a la carpeta.', en: 'The folder cannot be accessed.', fr: "Impossible d'accéder au dossier.", de: 'Auf den Ordner kann nicht zugegriffen werden.', pt: 'Não é possível aceder à pasta.', 'pt-BR': 'Não é possível acessar a pasta.', it: 'Impossibile accedere alla cartella.', tr: 'Klasöre erişilemiyor.', 'zh-CN': '无法访问该文件夹。' ,
  'zh-TW': '無法訪問該資料夾。',
  ko: "폴더에 접근할 수 없습니다.",
  ja: "フォルダーにアクセスできません。", }), snapshots: [] };
  }
  if (!stat.isDirectory()) return { path: clean, kind: 'invalid', message: tr(language, { es: 'La ruta seleccionada no es una carpeta.', en: 'The selected path is not a folder.', fr: "Le chemin sélectionné n'est pas un dossier.", de: 'Der ausgewählte Pfad ist kein Ordner.', pt: 'O caminho selecionado não é uma pasta.', 'pt-BR': 'O caminho selecionado não é uma pasta.', it: 'Il percorso selezionato non è una cartella.', tr: 'Seçilen yol bir klasör değil.', 'zh-CN': '所选路径不是文件夹。' ,
  'zh-TW': '所選路徑不是資料夾。',
  ko: "선택한 경로가 폴더가 아닙니다.",
  ja: "選択したパスはフォルダーではありません。", }), snapshots: [] };

  const manifest = readRecoveryManifest(clean);
  if (manifest) {
    const snapshotsDir = recoverySnapshotsDir(clean);
    const snapshots = fs.existsSync(snapshotsDir)
      ? fs.readdirSync(snapshotsDir)
        .filter((name) => name.endsWith('.nodus'))
        .map((name) => snapshotSummary(path.join(snapshotsDir, name)))
        .filter((item): item is RecoverySnapshotSummary => item !== null)
        .sort((a, b) => b.date.localeCompare(a.date))
      : [];
    return {
      path: clean,
      kind: 'recovery',
      message: snapshots.length
        ? tr(language, { es: `${snapshots.length} copia(s) válida(s) encontrada(s).`, en: `${snapshots.length} valid snapshot(s) found.`, fr: `${snapshots.length} sauvegarde(s) valide(s) trouvée(s).`, de: `${snapshots.length} gültige Sicherung(en) gefunden.`, pt: `${snapshots.length} cópia(s) de segurança válida(s) encontrada(s).`, 'pt-BR': `${snapshots.length} backup(s) válido(s) encontrado(s).`, it: `Trovate ${snapshots.length} copie valide.`, tr: `${snapshots.length} geçerli anlık görüntü bulundu.`, 'zh-CN': `找到 ${snapshots.length} 个有效快照。` ,
  'zh-TW': `找到 ${snapshots.length} 個有效快照。`, })
        : tr(language, { es: 'Carpeta de recuperación válida, todavía sin copias.', en: 'Valid recovery folder, with no snapshots yet.', fr: 'Dossier de récupération valide, encore sans sauvegarde.', de: 'Gültiger Wiederherstellungsordner, noch ohne Sicherungen.', pt: 'Pasta de recuperação válida, ainda sem cópias de segurança.', 'pt-BR': 'Pasta de recuperação válida, ainda sem backups.', it: 'Cartella di ripristino valida, ancora senza copie.', tr: 'Geçerli kurtarma klasörü; henüz anlık görüntü yok.', 'zh-CN': '有效的恢复文件夹，尚无快照。' ,
  'zh-TW': '有效的恢復資料夾，尚無快照。',
  ko: "아직 스냅샷이 없는 유효한 복구 폴더입니다.",
  ja: "有効な回復フォルダーですが、スナップショットはまだありません。", }),
      snapshots,
    };
  }

  const entries = visibleDirectoryEntries(clean);
  if (entries.length === 0) return { path: clean, kind: 'empty', message: tr(language, { es: 'Carpeta vacía y disponible.', en: 'Empty folder, ready to use.', fr: 'Dossier vide et disponible.', de: 'Ordner leer und verfügbar.', pt: 'Pasta vazia e disponível.', 'pt-BR': 'Pasta vazia e disponível.', it: 'Cartella vuota e disponibile.', tr: 'Boş klasör, kullanıma hazır.', 'zh-CN': '空文件夹，可以使用。' ,
  'zh-TW': '空資料夾，可以使用。',
  ko: "빈 폴더, 사용할 준비가 되었습니다.",
  ja: "空のフォルダー。すぐに使用できます。", }), snapshots: [] };
  return {
    path: clean,
    kind: 'invalid',
    message: tr(language, { es: `La carpeta debe estar vacía o contener una recuperación de Nodus válida. Contiene ${entries.length} elemento(s).`, en: `The folder must be empty or contain a valid Nodus recovery. It contains ${entries.length} item(s).`, fr: `Le dossier doit être vide ou contenir une récupération Nodus valide. Il contient ${entries.length} élément(s).`, de: `Der Ordner muss leer sein oder eine gültige Nodus-Wiederherstellung enthalten. Er enthält ${entries.length} Element(e).`, pt: `A pasta deve estar vazia ou conter uma recuperação válida do Nodus. Contém ${entries.length} elemento(s).`, 'pt-BR': `A pasta deve estar vazia ou conter uma recuperação válida do Nodus. Ela contém ${entries.length} elemento(s).`, it: `La cartella deve essere vuota o contenere un ripristino Nodus valido. Contiene ${entries.length} elementi.`, tr: `Klasör boş olmalı veya geçerli bir Nodus kurtarması içermelidir. ${entries.length} öğe içeriyor.`, 'zh-CN': `文件夹必须为空或包含有效的 Nodus 恢复。其中包含 ${entries.length} 个项目。` ,
  'zh-TW': `資料夾必須為空或包含有效的 Nodus 恢復。其中包含 ${entries.length} 個專案。`, }),
    snapshots: [],
  };
}

function inspectionFromProbe(probe: RecoveryFolderProbe, language: AppLanguage): RecoveryFolderInspection {
  if (probe.kind === 'missing') {
    return { ...probe, message: tr(language, { es: 'No se puede acceder a la carpeta.', en: 'The folder cannot be accessed.', fr: "Impossible d'accéder au dossier.", de: 'Auf den Ordner kann nicht zugegriffen werden.', pt: 'Não é possível aceder à pasta.', 'pt-BR': 'Não é possível acessar a pasta.', it: 'Impossibile accedere alla cartella.', tr: 'Klasöre erişilemiyor.', 'zh-CN': '无法访问该文件夹。' ,
  'zh-TW': '無法訪問該資料夾。',
  ko: "폴더에 접근할 수 없습니다.",
  ja: "フォルダーにアクセスできません。", }) };
  }
  if (probe.kind === 'empty') {
    return { ...probe, message: tr(language, { es: 'Carpeta vacía y disponible.', en: 'Empty folder, ready to use.', fr: 'Dossier vide et disponible.', de: 'Ordner leer und verfügbar.', pt: 'Pasta vazia e disponível.', 'pt-BR': 'Pasta vazia e disponível.', it: 'Cartella vuota e disponibile.', tr: 'Boş klasör, kullanıma hazır.', 'zh-CN': '空文件夹，可以使用。' ,
  'zh-TW': '空資料夾，可以使用。',
  ko: "빈 폴더, 사용할 준비가 되었습니다.",
  ja: "空のフォルダー。すぐに使用できます。", }) };
  }
  if (probe.kind === 'recovery') {
    return {
      ...probe,
      message: probe.snapshots.length
        ? tr(language, { es: `${probe.snapshots.length} copia(s) válida(s) encontrada(s).`, en: `${probe.snapshots.length} valid snapshot(s) found.`, fr: `${probe.snapshots.length} sauvegarde(s) valide(s) trouvée(s).`, de: `${probe.snapshots.length} gültige Sicherung(en) gefunden.`, pt: `${probe.snapshots.length} cópia(s) de segurança válida(s) encontrada(s).`, 'pt-BR': `${probe.snapshots.length} backup(s) válido(s) encontrado(s).`, it: `Trovate ${probe.snapshots.length} copie valide.`, tr: `${probe.snapshots.length} geçerli anlık görüntü bulundu.`, 'zh-CN': `找到 ${probe.snapshots.length} 个有效快照。` ,
  'zh-TW': `找到 ${probe.snapshots.length} 個有效快照。`, })
        : tr(language, { es: 'Carpeta de recuperación válida, todavía sin copias.', en: 'Valid recovery folder, with no snapshots yet.', fr: 'Dossier de récupération valide, encore sans sauvegarde.', de: 'Gültiger Wiederherstellungsordner, noch ohne Sicherungen.', pt: 'Pasta de recuperação válida, ainda sem cópias de segurança.', 'pt-BR': 'Pasta de recuperação válida, ainda sem backups.', it: 'Cartella di ripristino valida, ancora senza copie.', tr: 'Geçerli kurtarma klasörü; henüz anlık görüntü yok.', 'zh-CN': '有效的恢复文件夹，尚无快照。' ,
  'zh-TW': '有效的恢復資料夾，尚無快照。',
  ko: "아직 스냅샷이 없는 유효한 복구 폴더입니다.",
  ja: "有効な回復フォルダーですが、スナップショットはまだありません。", }),
    };
  }
  const entries = probe.visibleEntries ?? 0;
  return {
    ...probe,
    message: tr(language, { es: `La carpeta debe estar vacía o contener una recuperación de Nodus válida. Contiene ${entries} elemento(s).`, en: `The folder must be empty or contain a valid Nodus recovery. It contains ${entries} item(s).`, fr: `Le dossier doit être vide ou contenir une récupération Nodus valide. Il contient ${entries} élément(s).`, de: `Der Ordner muss leer sein oder eine gültige Nodus-Wiederherstellung enthalten. Er enthält ${entries} Element(e).`, pt: `A pasta deve estar vazia ou conter uma recuperação válida do Nodus. Contém ${entries} elemento(s).`, 'pt-BR': `A pasta deve estar vazia ou conter uma recuperação válida do Nodus. Ela contém ${entries} elemento(s).`, it: `La cartella deve essere vuota o contenere un ripristino Nodus valido. Contiene ${entries} elementi.`, tr: `Klasör boş olmalı veya geçerli bir Nodus kurtarması içermelidir. ${entries} öğe içeriyor.`, 'zh-CN': `文件夹必须为空或包含有效的 Nodus 恢复。其中包含 ${entries} 个项目。` ,
  'zh-TW': `資料夾必須為空或包含有效的 Nodus 恢復。其中包含 ${entries} 個專案。`, }),
  };
}

export async function inspectRecoveryFolderSafely(
  folder: string,
  language: AppLanguage = 'es',
  mode: 'cached' | 'deep' = 'deep',
  timeoutMs = INTERACTIVE_RECOVERY_PROBE_TIMEOUT_MS,
): Promise<RecoveryFolderInspection> {
  const probe = await probeRecoveryFolderInUtility(folder, mode, timeoutMs);
  return inspectionFromProbe(probe, language);
}

/** How many days a snapshot may age before protection counts as lapsed. The scheduler
 *  aims for a slot per chosen weekday, so a week without one is already anomalous. */
const STALE_AFTER_DAYS = 8;

/**
 * Decide whether the user is actually protected right now. Deliberately pessimistic:
 * anything that would stop the next snapshot from being written — or that already did —
 * outranks the reassuring "last run was ok" string.
 */
function assessRecoveryHealth(
  settings: ReturnType<typeof getSettings>,
  folder: RecoveryFolderInspection | null
): RecoveryHealth {
  const detail = settings.lastAutoBackupStatus ?? '';
  const lastAt = settings.lastAutoBackupAt ? Date.parse(settings.lastAutoBackupAt) : NaN;
  const daysSinceLastBackup = Number.isNaN(lastAt)
    ? null
    : Math.max(0, Math.floor((Date.now() - lastAt) / 86400000));

  if (!settings.autoBackupEnabled || !settings.autoBackupFolder) {
    return { level: 'critical', code: 'disabled', daysSinceLastBackup, detail };
  }
  // An unreachable destination means the next snapshot cannot be written, whatever the
  // last recorded status says.
  if (folder && folder.kind !== 'recovery' && folder.kind !== 'empty') {
    return { level: 'critical', code: 'folder-unreachable', daysSinceLastBackup, detail };
  }
  if (detail.startsWith('error:')) {
    return { level: 'critical', code: 'last-run-failed', daysSinceLastBackup, detail };
  }
  if (daysSinceLastBackup === null) {
    return { level: 'warning', code: 'never-run', daysSinceLastBackup, detail };
  }
  if (daysSinceLastBackup >= STALE_AFTER_DAYS) {
    return { level: 'warning', code: 'stale', daysSinceLastBackup, detail };
  }
  return { level: 'ok', code: 'ok', daysSinceLastBackup, detail };
}

/**
 * Translate the stored backup outcome at read time.
 *
 * `lastAutoBackupStatus` keeps the Spanish source sentence — the scheduler is not the
 * place to decide the interface language, and an existing status must follow a language
 * switch. The `ok:`/`error:` prefix stays exactly as stored: `assessRecoveryHealth`
 * classifies on it, and it is a status marker rather than prose.
 */
function localizeBackupStatus(status: string, language: AppLanguage): string {
  const match = /^(ok|error): (.*)$/.exec(status);
  if (!match) return status;
  return `${match[1]}: ${knownRuntimeErrorText(match[2], language) ?? match[2]}`;
}

export async function getRecoveryStatus(): Promise<RecoveryStatus> {
  const settings = getSettings();
  const configuredRoot = settings.autoBackupFolder?.trim() ?? '';
  // The cloud provider owns this path. Probe it in a disposable process and accept a
  // last-known health answer after a short deadline: startup must never depend on a
  // File Provider placeholder completing a read.
  const folder = configuredRoot
    ? await inspectRecoveryFolderSafely(
      configuredRoot,
      settings.uiLanguage,
      'cached',
      STARTUP_RECOVERY_PROBE_TIMEOUT_MS,
    ).catch(() => null)
    : null;
  const health = assessRecoveryHealth(settings, folder);
  return {
    health: { ...health, detail: localizeBackupStatus(health.detail, settings.uiLanguage) },
    setupVersion: settings.recoverySetupVersion ?? 0,
    // A previously completed setup is not turned into a blocking full-screen wizard
    // merely because a removable/cloud volume is temporarily offline. Settings and
    // backup status still surface that operational error without locking the user out.
    needsSetup: (settings.recoverySetupVersion ?? 0) < RECOVERY_SETUP_VERSION,
    previousInstallation: settings.onboardingComplete || listVaults().length > 1,
    configuredRoot,
    folder,
    hasPassword: hasBackupPassword(),
    hasRecoveryKey: Boolean(getBackupRecoveryKey()),
  };
}

function settingsPatch(root: string) {
  return {
    recoverySetupVersion: RECOVERY_SETUP_VERSION,
    // Preserve legacy fields as explicit all-on values so downgrades cannot inherit
    // an old partial selection. Current backup creation does not consult them.
    backupVaultIds: [],
    backupIncludePreferences: true,
    backupIncludeHistories: true,
    backupIncludeGeneratedMedia: true,
    backupIncludeApiKeys: true,
    autoBackupEnabled: true,
    autoBackupFolder: root,
  };
}

export async function initializeRecoveryFolder(
  folder: string,
  password: string,
  appVersion: string,
  language: AppLanguage = 'es'
): Promise<RecoverySetupResult> {
  const passwordValidation = validateBackupPassword(password);
  const cleanPassword = passwordValidation.normalized;
  if (!passwordValidation.valid) return { ok: false, message: tr(language, { es: 'La contraseña debe tener al menos 8 caracteres.', en: 'The password must be at least 8 characters long.', fr: 'Le mot de passe doit contenir au moins 8 caractères.', de: 'Das Passwort muss mindestens 8 Zeichen lang sein.', pt: 'A palavra-passe deve ter pelo menos 8 caracteres.', 'pt-BR': 'A senha deve ter pelo menos 8 caracteres.', it: 'La password deve contenere almeno 8 caratteri.', tr: 'Parola en az 8 karakter uzunluğunda olmalıdır.', 'zh-CN': '密码必须至少包含 8 个字符。' ,
  'zh-TW': '密碼必須至少包含 8 個字元。',
  ko: "비밀번호는 8자 이상이어야 합니다.",
  ja: "パスワードは8文字以上である必要があります。", }) };
  let inspection: RecoveryFolderInspection;
  try {
    inspection = await inspectRecoveryFolderSafely(folder, language, 'deep');
  } catch {
    return { ok: false, message: tr(language, { es: 'La carpeta no respondió a tiempo. Haz que esté disponible sin conexión y vuelve a intentarlo.', en: 'The folder did not respond in time. Make it available offline and try again.', fr: 'Le dossier n’a pas répondu à temps. Rendez-le disponible hors connexion et réessayez.', de: 'Der Ordner hat nicht rechtzeitig geantwortet. Machen Sie ihn offline verfügbar und versuchen Sie es erneut.', pt: 'A pasta não respondeu a tempo. Disponibilize-a offline e tente novamente.', 'pt-BR': 'A pasta não respondeu a tempo. Disponibilize-a off-line e tente novamente.', it: 'La cartella non ha risposto in tempo. Rendila disponibile offline e riprova.', tr: 'Klasör zamanında yanıt vermedi. Çevrimdışı kullanılabilir yapıp yeniden deneyin.', 'zh-CN': '文件夹未及时响应。请使其可离线使用，然后重试。' ,
  'zh-TW': '資料夾未及時響應。請使其可離線使用，然後重試。',
  ko: "폴더가 제때에 응답하지 않았습니다. 오프라인에서 사용할 수 있도록 설정하고 다시 시도하세요.",
  ja: "フォルダーが時間内に応答しませんでした。オフラインで利用できるようにして、もう一度試してください。", }) };
  }
  if (inspection.kind !== 'empty') return { ok: false, message: inspection.message };

  const root = inspection.path;
  const previousSettings = getSettings();
  const previousPassword = getBackupPassword();
  const previousRecoveryKey = getBackupRecoveryKey();
  const recoveryKey = generateBackupPassword();
  let createdManifest = false;
  try {
    writeRecoveryManifest(root, createRecoveryManifest());
    createdManifest = true;
    fs.mkdirSync(recoverySnapshotsDir(root), { recursive: true });
    setBackupPassword(cleanPassword);
    setBackupRecoveryKey(recoveryKey);
    updateSettings(settingsPatch(root));
    const result = await runAutoBackupNow(appVersion);
    if (!result.ok || !result.path) throw new Error(result.message);
    const snapshot = snapshotSummary(result.path);
    if (!snapshot) throw new Error(tr(language, { es: 'La copia inicial se escribió, pero no superó la verificación del manifiesto.', en: 'The initial snapshot was written but failed manifest verification.', fr: "La sauvegarde initiale a été écrite, mais elle n'a pas passé la vérification du manifeste.", de: 'Die anfängliche Sicherung wurde geschrieben, hat die Manifestprüfung jedoch nicht bestanden.', pt: 'A cópia de segurança inicial foi gravada, mas não passou na verificação do manifesto.', 'pt-BR': 'O backup inicial foi gravado, mas não passou na verificação do manifesto.', it: 'La copia iniziale è stata scritta, ma non ha superato la verifica del manifesto.', tr: 'İlk anlık görüntü yazıldı ancak manifesto doğrulamasından geçemedi.', 'zh-CN': '初始快照已写入，但未通过清单验证。' ,
  'zh-TW': '初始快照已寫入，但未通過清單驗證。',
  ko: "초기 스냅샷이 작성되었지만 매니페스트 확인에 실패했습니다.",
  ja: "最初のスナップショットは書き込まれましたが、マニフェストの検証に失敗しました。", }));
    return {
      ok: true,
      message: tr(language, { es: 'Carpeta de recuperación creada y primera copia verificada.', en: 'Recovery folder created and first snapshot verified.', fr: 'Dossier de récupération créé et première sauvegarde vérifiée.', de: 'Wiederherstellungsordner erstellt und erste Sicherung verifiziert.', pt: 'Pasta de recuperação criada e primeira cópia de segurança verificada.', 'pt-BR': 'Pasta de recuperação criada e primeiro backup verificado.', it: 'Cartella di ripristino creata e prima copia verificata.', tr: 'Kurtarma klasörü oluşturuldu ve ilk anlık görüntü doğrulandı.', 'zh-CN': '恢复文件夹已创建，首个快照已验证。' ,
  'zh-TW': '恢復資料夾已建立，首個快照已驗證。',
  ko: "복구 폴더가 생성되고 첫 번째 스냅샷이 확인되었습니다.",
  ja: "回復フォルダーが作成され、最初のスナップショットが検証されました。", }),
      snapshot,
      recoveryKey,
    };
  } catch (error) {
    updateSettings({
      recoverySetupVersion: previousSettings.recoverySetupVersion,
      backupVaultIds: previousSettings.backupVaultIds,
      backupIncludePreferences: previousSettings.backupIncludePreferences,
      backupIncludeHistories: previousSettings.backupIncludeHistories,
      backupIncludeGeneratedMedia: previousSettings.backupIncludeGeneratedMedia,
      backupIncludeApiKeys: previousSettings.backupIncludeApiKeys,
      autoBackupEnabled: previousSettings.autoBackupEnabled,
      autoBackupFolder: previousSettings.autoBackupFolder,
    });
    if (previousPassword) setBackupPassword(previousPassword); else clearBackupPassword();
    if (previousRecoveryKey) setBackupRecoveryKey(previousRecoveryKey); else clearBackupRecoveryKey();
    if (createdManifest) {
      try { fs.rmSync(recoverySnapshotsDir(root), { recursive: true, force: true }); } catch { /* best effort */ }
      try { fs.rmSync(recoveryManifestPath(root), { force: true }); } catch { /* best effort */ }
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function restoreRecoverySnapshot(
  root: string,
  fileName: string,
  password: string,
  appVersion: string,
  language: AppLanguage = 'es',
  onProgress?: (progress: RecoveryRestoreProgress) => void,
): Promise<RecoverySetupResult> {
  let inspection: RecoveryFolderInspection;
  try {
    inspection = await inspectRecoveryFolderSafely(root, language, 'deep');
  } catch {
    return { ok: false, message: tr(language, { es: 'La carpeta de recuperación no respondió a tiempo. Hazla disponible sin conexión antes de restaurar.', en: 'The recovery folder did not respond in time. Make it available offline before restoring.', fr: 'Le dossier de récupération n’a pas répondu à temps. Rendez-le disponible hors connexion avant la restauration.', de: 'Der Wiederherstellungsordner hat nicht rechtzeitig geantwortet. Machen Sie ihn vor der Wiederherstellung offline verfügbar.', pt: 'A pasta de recuperação não respondeu a tempo. Disponibilize-a offline antes de restaurar.', 'pt-BR': 'A pasta de recuperação não respondeu a tempo. Disponibilize-a off-line antes de restaurar.', it: 'La cartella di ripristino non ha risposto in tempo. Rendila disponibile offline prima del ripristino.', tr: 'Kurtarma klasörü zamanında yanıt vermedi. Geri yüklemeden önce çevrimdışı kullanılabilir yapın.', 'zh-CN': '恢复文件夹未及时响应。请使其可离线使用后再恢复。' ,
  'zh-TW': '恢復資料夾未及時響應。請使其可離線使用後再恢復。',
  ko: "복구 폴더가 제때 응답하지 않았습니다. 복원하기 전에 오프라인으로 사용할 수 있도록 하세요.",
  ja: "回復フォルダーが時間内に応答しませんでした。復元する前にオフラインで利用できるようにしてください。", }) };
  }
  if (inspection.kind !== 'recovery') return { ok: false, message: inspection.message };
  const snapshot = inspection.snapshots.find((candidate) => candidate.fileName === path.basename(fileName));
  if (!snapshot) return { ok: false, message: tr(language, { es: 'La copia seleccionada no pertenece a esta carpeta de recuperación.', en: 'The selected snapshot does not belong to this recovery folder.', fr: "La sauvegarde sélectionnée n'appartient pas à ce dossier de récupération.", de: 'Die ausgewählte Sicherung gehört nicht zu diesem Wiederherstellungsordner.', pt: 'A cópia de segurança selecionada não pertence a esta pasta de recuperação.', 'pt-BR': 'O backup selecionado não pertence a esta pasta de recuperação.', it: 'La copia selezionata non appartiene a questa cartella di ripristino.', tr: 'Seçilen anlık görüntü bu kurtarma klasörüne ait değil.', 'zh-CN': '所选快照不属于此恢复文件夹。' ,
  'zh-TW': '所選快照不屬於此恢復資料夾。',
  ko: "선택한 스냅샷은 이 복구 폴더에 속하지 않습니다.",
  ja: "選択したスナップショットはこの回復フォルダーに属していません。", }) };
  const result = await restoreBackupArchiveFileSafely(snapshot.path, password, appVersion, onProgress);
  if (!result.ok) return { ...result, message: localizeRestoreMessage(result.message, language) };
  if (result.recoveryKey) setBackupRecoveryKey(result.recoveryKey);
  // A restore with the recovery key must not make both credentials identical.
  // Generate a fresh password in the OS-protected store; the user can replace it
  // in Settings and export a new kit, while the stable recovery key keeps working.
  setBackupPassword(result.usedRecoveryKey ? generateBackupPassword() : password.trim());
  updateSettings(settingsPatch(inspection.path));
  return {
    ok: true,
    // Branch first, then translate: a ternary *inside* each argument hides these
    // strings from the extraction that keeps the languages in step.
    message: result.usedRecoveryKey
      ? tr(language, {
        es: 'Datos recuperados con la clave de recuperación. Puedes establecer una contraseña nueva en Ajustes.',
        en: 'Data restored with the recovery key. You can set a new password in Settings.',
        fr: 'Données récupérées avec la clé de récupération. Vous pouvez définir un nouveau mot de passe dans les Paramètres.',
        de: 'Daten mit dem Wiederherstellungsschlüssel wiederhergestellt. Sie können in den Einstellungen ein neues Passwort festlegen.',
        pt: 'Dados recuperados com a chave de recuperação. Pode definir uma nova palavra-passe nas Definições.',
        'pt-BR': 'Dados recuperados com a chave de recuperação. Você pode definir uma nova senha nas Configurações.',
        it: 'Dati ripristinati con la chiave di ripristino. Puoi impostare una nuova password nelle Impostazioni.',
        tr: 'Veriler kurtarma anahtarıyla geri yüklendi. Ayarlar’dan yeni bir parola belirleyebilirsiniz.', 'zh-CN': '已使用恢复密钥恢复数据。你可以在设置中设置新密码。',
  'zh-TW': '已使用恢復金鑰恢復資料。你可以在設定中設定新密碼。',
  ko: "복구 키로 데이터가 복원되었습니다. 설정에서 새 비밀번호를 설정할 수 있습니다.",
  ja: "回復キーを使用してデータが復元されました。 「設定」で新しいパスワードを設定できます。",
      })
      : tr(language, {
        es: 'Datos recuperados y copia de seguridad previa conservada por seguridad.',
        en: 'Data restored and a pre-restore safety snapshot was retained.',
        fr: 'Données récupérées ; une sauvegarde préalable a été conservée par sécurité.',
        de: 'Daten wiederhergestellt; eine Sicherung vor der Wiederherstellung wurde vorsorglich aufbewahrt.',
        pt: 'Dados recuperados; foi conservada uma cópia de segurança prévia por precaução.',
        'pt-BR': 'Dados recuperados; um backup anterior foi mantido por segurança.',
        it: 'Dati ripristinati; per sicurezza è stata conservata una copia precedente al ripristino.',
        tr: 'Veriler geri yüklendi ve güvenlik için geri yükleme öncesi anlık görüntü saklandı.', 'zh-CN': '数据已恢复，并保留了恢复前的安全快照。',
  'zh-TW': '資料已恢復，並保留了恢復前的安全快照。',
  ko: "데이터가 복원되었으며 복원 전 안전 스냅샷이 유지되었습니다.",
  ja: "データが復元され、復元前の安全スナップショットが保持されました。",
      }),
    snapshot,
  };
}

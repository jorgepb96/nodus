import type { CategorizedReleaseHighlight } from './releaseNotes';

// Final user-visible outcome since v5.19.0: a monitored Zotero collection deleted in Zotero
// no longer leaves every sync incomplete.
export const RELEASE_5_19_1_HIGHLIGHTS: CategorizedReleaseHighlight[] = [
  {
    category: 'fix', scope: 'academic',
    es: 'Una colección de Zotero monitorizada que se borra en Zotero ya no detiene la sincronización. Sus elementos se actualizan como si hubieran salido de la colección. El registro de sincronización indica qué colección falta.',
    en: 'A monitored Zotero collection that was deleted in Zotero no longer stops synchronization. Its items are updated as if they had left the collection. The sync log names the missing collection.',
    fr: 'Une collection Zotero surveillée qui a été supprimée dans Zotero ne bloque plus la synchronisation. Ses éléments sont mis à jour comme s’ils avaient quitté la collection. Le journal de synchronisation indique la collection manquante.',
    de: 'Eine überwachte Zotero-Sammlung, die in Zotero gelöscht wurde, hält die Synchronisierung nicht mehr an. Ihre Einträge werden so aktualisiert, als hätten sie die Sammlung verlassen. Das Synchronisierungsprotokoll nennt die fehlende Sammlung.',
    pt: 'Uma coleção do Zotero monitorizada que foi eliminada no Zotero já não bloqueia a sincronização. Os seus itens são atualizados como se tivessem saído da coleção. O registo de sincronização indica a coleção em falta.',
    'pt-BR': 'Uma coleção do Zotero monitorada que foi excluída no Zotero não bloqueia mais a sincronização. Os itens dela são atualizados como se tivessem saído da coleção. O registro de sincronização indica a coleção que falta.',
    it: 'Una raccolta di Zotero monitorata che è stata eliminata in Zotero non blocca più la sincronizzazione. I suoi elementi vengono aggiornati come se fossero usciti dalla raccolta. Il registro di sincronizzazione indica la raccolta mancante.',
    tr: 'Zotero’da silinen izlenen bir Zotero koleksiyonu artık eşitlemeyi durdurmuyor. Koleksiyondaki öğeler koleksiyondan çıkmış gibi güncelleniyor. Eşitleme günlüğü eksik koleksiyonun adını gösteriyor.',
    'zh-CN': '在 Zotero 中被删除的受监控 Zotero 集合不再会阻止同步。其中的条目会按照已离开该集合的方式更新。同步日志会列出缺失的集合名称。',
    'zh-TW': '在 Zotero 中被刪除的受監控 Zotero 集合不再會阻止同步。其中的項目會依照已離開該集合的方式更新。同步紀錄會列出缺少的集合名稱。',
    ja: 'Zotero で削除された監視対象の Zotero コレクションが、同期を止めなくなりました。そのアイテムはコレクションから外れたものとして更新されます。同期ログには見つからないコレクションの名前が表示されます。',
    ko: 'Zotero에서 삭제된 모니터링 중인 Zotero 컬렉션이 더 이상 동기화를 멈추지 않습니다. 해당 항목은 컬렉션에서 빠진 것처럼 업데이트됩니다. 동기화 기록에 없어진 컬렉션 이름이 표시됩니다.',
  },
];

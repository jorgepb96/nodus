import type { AppLanguage } from '@shared/types';

/** Multiple selection in the research chat history: select, archive, move and delete several chats. */
export const RESEARCH_CHAT_SELECTION_TRANSLATIONS: Record<Exclude<AppLanguage, 'es'>, Record<string, string>> = {
  "en": {
    "Seleccionar varios chats": "Select several chats",
    "Terminar selección": "Finish selecting",
    "Chats seleccionados": "Selected chats",
    "Quitar la selección": "Clear the selection",
    "Seleccionar todos": "Select all",
    "{n} seleccionado(s)": "{n} selected",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Click to select. Shift + click selects a range.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} notebook chat(s) stay in their notebook.",
    "Eliminar conversaciones": "Delete conversations",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "{n} conversations and all their message history and attachments will be deleted. This cannot be undone."
  },
  "fr": {
    "Seleccionar varios chats": "Sélectionner plusieurs chats",
    "Terminar selección": "Terminer la sélection",
    "Chats seleccionados": "Chats sélectionnés",
    "Quitar la selección": "Effacer la sélection",
    "Seleccionar todos": "Tout sélectionner",
    "{n} seleccionado(s)": "{n} sélectionné(s)",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Cliquez pour sélectionner. Maj + clic sélectionne un intervalle.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} chat(s) de carnet restent dans leur carnet.",
    "Eliminar conversaciones": "Supprimer les conversations",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "{n} conversations et tout leur historique de messages et pièces jointes seront supprimés. Cette action est irréversible."
  },
  "de": {
    "Seleccionar varios chats": "Mehrere Chats auswählen",
    "Terminar selección": "Auswahl beenden",
    "Chats seleccionados": "Ausgewählte Chats",
    "Quitar la selección": "Auswahl aufheben",
    "Seleccionar todos": "Alle auswählen",
    "{n} seleccionado(s)": "{n} ausgewählt",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Zum Auswählen klicken. Umschalt + Klick wählt einen Bereich aus.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} Notizbuch-Chat(s) bleiben in ihrem Notizbuch.",
    "Eliminar conversaciones": "Unterhaltungen löschen",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "{n} Unterhaltungen und ihr gesamter Nachrichtenverlauf samt Anhängen werden gelöscht. Dies kann nicht rückgängig gemacht werden."
  },
  "pt": {
    "Seleccionar varios chats": "Selecionar vários chats",
    "Terminar selección": "Terminar seleção",
    "Chats seleccionados": "Chats selecionados",
    "Quitar la selección": "Limpar a seleção",
    "Seleccionar todos": "Selecionar todos",
    "{n} seleccionado(s)": "{n} selecionado(s)",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Clique para selecionar. Shift + clique seleciona um intervalo.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} chat(s) de cadernos ficam no seu caderno.",
    "Eliminar conversaciones": "Eliminar conversas",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "Serão eliminadas {n} conversas e todo o seu histórico de mensagens e anexos. Esta ação não pode ser anulada."
  },
  "pt-BR": {
    "Seleccionar varios chats": "Selecionar vários chats",
    "Terminar selección": "Concluir seleção",
    "Chats seleccionados": "Chats selecionados",
    "Quitar la selección": "Limpar a seleção",
    "Seleccionar todos": "Selecionar todos",
    "{n} seleccionado(s)": "{n} selecionado(s)",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Clique para selecionar. Shift + clique seleciona um intervalo.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} chat(s) de cadernos ficam no caderno.",
    "Eliminar conversaciones": "Excluir conversas",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "{n} conversas e todo o histórico de mensagens e anexos serão excluídos. Esta ação não pode ser desfeita."
  },
  "it": {
    "Seleccionar varios chats": "Seleziona più chat",
    "Terminar selección": "Termina selezione",
    "Chats seleccionados": "Chat selezionate",
    "Quitar la selección": "Annulla la selezione",
    "Seleccionar todos": "Seleziona tutto",
    "{n} seleccionado(s)": "{n} selezionati",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Fai clic per selezionare. Maiusc + clic seleziona un intervallo.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} chat dei quaderni restano nel loro quaderno.",
    "Eliminar conversaciones": "Elimina conversazioni",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "Verranno eliminate {n} conversazioni con tutta la cronologia dei messaggi e gli allegati. Questa azione non può essere annullata."
  },
  "tr": {
    "Seleccionar varios chats": "Birden çok sohbet seç",
    "Terminar selección": "Seçimi bitir",
    "Chats seleccionados": "Seçili sohbetler",
    "Quitar la selección": "Seçimi temizle",
    "Seleccionar todos": "Tümünü seç",
    "{n} seleccionado(s)": "{n} seçildi",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "Seçmek için tıklayın. Shift + tıklama bir aralık seçer.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} defter sohbeti defterinde kalır.",
    "Eliminar conversaciones": "Sohbetleri sil",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "{n} sohbet ve tüm mesaj geçmişleri ile ekleri silinecek. Bu işlem geri alınamaz."
  },
  "zh-CN": {
    "Seleccionar varios chats": "选择多个聊天",
    "Terminar selección": "完成选择",
    "Chats seleccionados": "已选聊天",
    "Quitar la selección": "清除选择",
    "Seleccionar todos": "全选",
    "{n} seleccionado(s)": "已选 {n} 个",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "点击即可选择。按住 Shift 点击可选择一个范围。",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} 个笔记本聊天留在其笔记本中。",
    "Eliminar conversaciones": "删除对话",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "将删除 {n} 个对话及其全部消息记录和附件。此操作无法撤销。"
  },
  "zh-TW": {
    "Seleccionar varios chats": "選擇多個聊天",
    "Terminar selección": "完成選擇",
    "Chats seleccionados": "已選聊天",
    "Quitar la selección": "清除選擇",
    "Seleccionar todos": "全選",
    "{n} seleccionado(s)": "已選 {n} 個",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "點擊即可選擇。按住 Shift 點擊可選擇一個範圍。",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "{n} 個筆記本聊天留在其筆記本中。",
    "Eliminar conversaciones": "刪除對話",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "將刪除 {n} 個對話及其全部訊息記錄和附件。此操作無法復原。"
  },
  "ja": {
    "Seleccionar varios chats": "複数のチャットを選択",
    "Terminar selección": "選択を終了",
    "Chats seleccionados": "選択したチャット",
    "Quitar la selección": "選択を解除",
    "Seleccionar todos": "すべて選択",
    "{n} seleccionado(s)": "{n} 件選択",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "クリックで選択します。Shift + クリックで範囲を選択します。",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "ノートブックのチャット {n} 件はノートブックに残ります。",
    "Eliminar conversaciones": "会話を削除",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "{n} 件の会話と、そのメッセージ履歴と添付ファイルがすべて削除されます。この操作は元に戻せません。"
  },
  "ko": {
    "Seleccionar varios chats": "여러 채팅 선택",
    "Terminar selección": "선택 끝내기",
    "Chats seleccionados": "선택한 채팅",
    "Quitar la selección": "선택 해제",
    "Seleccionar todos": "모두 선택",
    "{n} seleccionado(s)": "{n}개 선택됨",
    "Clic para seleccionar. Mayús + clic selecciona un intervalo.": "클릭해서 선택하세요. Shift + 클릭으로 범위를 선택합니다.",
    "{n} chat(s) de cuadernos se quedan en su cuaderno.": "노트북 채팅 {n}개는 노트북에 남습니다.",
    "Eliminar conversaciones": "대화 삭제",
    "Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.": "대화 {n}개와 모든 메시지 기록 및 첨부 파일이 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
  },
};

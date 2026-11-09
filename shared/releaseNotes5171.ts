import type { CategorizedReleaseHighlight } from './releaseNotes';

// Final user-visible outcome since v5.17.0: long Podcast episodes finish instead of failing
// with "Maximum call stack size exceeded" when the audio file is built.
export const RELEASE_5_17_1_HIGHLIGHTS: CategorizedReleaseHighlight[] = [
  {
    category: 'fix', scope: 'general',
    es: 'Los episodios de Podcast de más de unos 20 minutos ya se terminan. Al acabar la grabación, la creación del archivo de audio fallaba con el error «Maximum call stack size exceeded». Ahora los episodios de hasta 30 minutos se guardan con normalidad.',
    en: 'Podcast episodes longer than about 20 minutes now finish. When the recording ended, building the audio file failed with the error "Maximum call stack size exceeded". Episodes up to 30 minutes are now saved normally.',
    fr: 'Les épisodes de Podcast de plus de 20 minutes environ se terminent désormais. À la fin de l’enregistrement, la création du fichier audio échouait avec l’erreur « Maximum call stack size exceeded ». Les épisodes jusqu’à 30 minutes sont maintenant enregistrés normalement.',
    de: 'Podcast-Episoden mit mehr als etwa 20 Minuten werden jetzt fertiggestellt. Am Ende der Aufnahme schlug das Erstellen der Audiodatei mit dem Fehler „Maximum call stack size exceeded“ fehl. Episoden bis 30 Minuten werden jetzt normal gespeichert.',
    pt: 'Os episódios de Podcast com mais de cerca de 20 minutos já terminam. No fim da gravação, a criação do ficheiro de áudio falhava com o erro «Maximum call stack size exceeded». Agora os episódios até 30 minutos são guardados normalmente.',
    'pt-BR': 'Os episódios de Podcast com mais de cerca de 20 minutos agora terminam. No fim da gravação, a criação do arquivo de áudio falhava com o erro "Maximum call stack size exceeded". Agora os episódios de até 30 minutos são salvos normalmente.',
    it: 'Gli episodi di Podcast di oltre 20 minuti circa ora vengono completati. Alla fine della registrazione, la creazione del file audio non riusciva con l’errore «Maximum call stack size exceeded». Ora gli episodi fino a 30 minuti vengono salvati normalmente.',
    tr: 'Yaklaşık 20 dakikadan uzun Podcast bölümleri artık tamamlanıyor. Kayıt bittiğinde ses dosyası oluşturulamıyor ve "Maximum call stack size exceeded" hatası veriliyordu. Artık 30 dakikaya kadar olan bölümler normal şekilde kaydediliyor.',
    'zh-CN': '超过约 20 分钟的播客节目现在可以正常完成。以前录制结束时，生成音频文件会失败，并显示错误“Maximum call stack size exceeded”。现在最长 30 分钟的节目都能正常保存。',
    'zh-TW': '超過約 20 分鐘的 Podcast 節目現在可以正常完成。以前錄製結束時，產生音訊檔會失敗，並顯示錯誤「Maximum call stack size exceeded」。現在最長 30 分鐘的節目都能正常儲存。',
    ja: '約 20 分を超えるポッドキャストのエピソードが最後まで完成するようになりました。以前は録音の終了時に音声ファイルの作成が「Maximum call stack size exceeded」というエラーで失敗していました。現在は最大 30 分のエピソードも正常に保存されます。',
    ko: '약 20분이 넘는 팟캐스트 에피소드가 이제 끝까지 완성됩니다. 이전에는 녹음이 끝날 때 오디오 파일을 만드는 과정이 "Maximum call stack size exceeded" 오류로 실패했습니다. 이제 최대 30분 길이의 에피소드도 정상적으로 저장됩니다.',
  },
];

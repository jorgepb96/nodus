import { hasTranslation, t } from "../i18n";

const errors: Record<string, string> = {
  INVALID_SIGNATURE_PAGE: "La selección de páginas de la firma no es válida.",
  INVALID_SIGNATURE_BOX: "La posición o el tamaño de la firma no son válidos.",
  SIGN_PDF_REQUIRED: "Selecciona un PDF de menos de 150 MB.",
  SIGN_PDF_INVALID: "El PDF está dañado o no es compatible.",
  FileNotFoundError:
    "El archivo ya no está disponible. Vuelve a seleccionarlo.",
  CERTIFICATE_TOO_LARGE: "El archivo del certificado supera el límite de 16 MB.",
  INCREMENTAL_UPDATE_FAILED: "La comprobación de la firma ha fallado. No se ha guardado el resultado.",
  SIGN_COPY_MISSING: "El archivo ya no está disponible. Vuelve a seleccionarlo.",
  CERTIFICATE_CHANGED:
    "El certificado ha cambiado. Vuelve a seleccionarlo y comprobarlo.",
  CERTIFICATE_WEAK_KEY:
    "La clave del certificado no cumple los requisitos mínimos de seguridad.",
  SIGN_ENGINE_VERSION:
    "El motor necesita repararse. Pulsa Instalar motor de firma.",
  SIGN_VISUAL_LOCKED:
    "Este PDF tiene firmas o restricciones. Solo se permiten nuevas firmas criptográficas compatibles.",
  SIGN_ORIGINAL_PROTECTED:
    "El original está protegido. Elige otro nombre o ubicación.",
  SIGN_ENGINE_UNAVAILABLE:
    "El motor de certificados no está disponible. Pulsa Instalar motor de firma.",
  SIGN_INSTALL_CANCELLED: "Instalación cancelada. Puedes volver a intentarlo.",
  SIGN_INSTALL_FAILED: "No se ha podido instalar el motor. Comprueba la conexión y vuelve a intentarlo.",
  SIGN_INSTALL_DOWNLOAD_FAILED: "No se ha podido descargar el motor. Comprueba la conexión y vuelve a intentarlo.",
  SIGN_INSTALL_INTEGRITY_FAILED: "La descarga no ha superado la comprobación de integridad. Vuelve a intentarlo.",
  SIGN_INSTALL_BUNDLED_RUNTIME_REQUIRED: "Falta un componente incluido con Nodus. Reinstala o actualiza Nodus y vuelve a intentarlo.",
  SIGN_INSTALL_PLATFORM_UNSUPPORTED: "La instalación del motor todavía no está disponible en esta plataforma.",
  SIGN_INSTALL_BUSY: "Ya hay una instalación del motor en curso.",
  CERTIFICATE_PASSWORD_OR_FORMAT:
    "La contraseña o el archivo PKCS#12 no son correctos.",
  CERTIFICATE_EXPIRED_OR_NOT_USABLE:
    "El certificado está caducado, aún no es válido o no permite firmar.",
  CERTIFICATE_SELECTION_EXPIRED: "Vuelve a seleccionar el certificado.",
  CERTIFICATE_PRIVATE_KEY_MISSING:
    "El archivo no contiene una clave privada compatible.",
  PDF_RESTRICTED:
    "El PDF tiene restricciones de firma. Nodus Sign conserva su integridad y no lo modifica.",
  EXISTING_SIGNATURE_INVALID:
    "Hay firmas anteriores dañadas o cambios incompatibles. No se puede añadir otra firma.",
  PDF_ENCRYPTED: "El PDF está cifrado. Abre una copia sin contraseña.",
  SIGN_CANCELLED: "Operación cancelada.",
  SIGN_ENGINE_BUSY: "Hay una operación de certificados en curso.",
  SIGN_ENGINE_TIMEOUT: "La operación ha superado el tiempo de espera.",
  SIGNATURE_POST_VALIDATION_FAILED:
    "La comprobación de la firma ha fallado. No se ha guardado el resultado.",
};
export function signErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(errors).find((k) => message.includes(k));
  if (code) return t(errors[code]);
  // The view throws its own sentences ("No hay documento.", "Confirma la operación antes de
  // firmar."), and they live in the Sign catalogue beside the rest of its copy. Ask the
  // catalogue rather than a list kept here: an allow-list only ever names the sentences
  // somebody remembered to add, so a sentence translated in eleven languages still collapsed
  // into the generic line whenever its author forgot this file. `t()` cannot answer the
  // question — it returns an unknown key as the Spanish source — so `hasTranslation` decides,
  // and only genuinely unknown prose (a provider's wording, a raw IPC detail) is replaced.
  if (hasTranslation(message)) return t(message);
  return t("No se ha podido completar la operación. Vuelve a intentarlo.");
}

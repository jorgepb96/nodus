import type { SignValidation } from '@shared/signTypes';

/** Byte integrity alone does not establish coverage of later PDF revisions. */
export function signatureReview(signature: SignValidation) {
  const complete = signature.coverage === 'ENTIRE_FILE' || signature.coverage === 'ENTIRE_REVISION';
  const compatible = signature.intact && signature.valid && complete && ['NONE', 'FORM_FILLING'].includes(signature.modification);
  return {
    warning: !compatible,
    coverage: signature.coverage === 'ENTIRE_FILE' ? 'Abarca el documento completo.'
      : signature.coverage === 'ENTIRE_REVISION' ? 'Abarca una revisión firmada anterior.' : 'Cobertura parcial o desconocida.',
    changes: !compatible ? 'La firma o los cambios posteriores requieren revisión.'
      : signature.modification === 'FORM_FILLING' ? 'Cambios compatibles en formularios o firmas posteriores.' : 'No se detectaron cambios posteriores incompatibles.',
  };
}

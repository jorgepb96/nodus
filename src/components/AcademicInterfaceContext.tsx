import { createContext, useContext } from 'react';
import type { AcademicInterfaceProfile } from '@shared/types';

// Desktop shell owns this context. Server web and other vault types retain their UI.
export const AcademicInterfaceContext = createContext<AcademicInterfaceProfile | null>(null);
export const useAcademicInterface = () => useContext(AcademicInterfaceContext);

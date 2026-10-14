import { useEffect } from 'react';
import { ACADEMIC_LESSONS } from '@shared/academicLearning';
import { openAcademicLearning } from '../learning/AcademicLearningContext';
import type { View } from '../navigation';
/** Compatibility entry for old tutorial links. The lessons have one registry. */
export const ACADEMIC_TOUR_LESSONS = ACADEMIC_LESSONS.filter(l=>l.profile==='simple'||l.profile==='intermediate');
export function Tour({onClose}: {onNavigate:(view:View)=>void;onClose:()=>void}) {
 useEffect(()=>{openAcademicLearning('first-answer');onClose();},[]);
 return null;
}

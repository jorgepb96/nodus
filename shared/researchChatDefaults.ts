import type {ResearchContextSelection} from './types';
import {withResearchContextLayers} from './researchContextLayers';

export const EMPTY_RESEARCH_CHAT_SELECTION:ResearchContextSelection={
  ideas:false,themes:false,contradictions:false,gaps:false,readingPath:false,authors:false,documents:false,passages:false,graph:false,
  graphParts:{ideaNodes:false,themeNodes:false,ideaEdges:false,authorGraph:false},
};
export const DEFAULT_RESEARCH_CHAT_SELECTION=withResearchContextLayers(EMPTY_RESEARCH_CHAT_SELECTION,{ideas:true,documents:true,indexed:true});

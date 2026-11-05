import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {WorldMap, MapLayer, MapMarker, MapTravelMode, WorldScene} from '@shared/types';
import {buildTracks, trackRange, ORDER_SCALE, type Presence} from '@shared/worldPresence';
import {formatWorldDate, fromWorldDay, hasCalendar, type WorldCalendar} from '@shared/worldCalendar';
import {WorldMapCanvas} from '../components/world/WorldMapCanvas';
import {MarkerLayer} from '../components/world/mapMarkers';
import {SceneLayer} from '../components/world/mapReports';
import {CastLayer, placeCharacters} from '../components/world/mapTimeline';
import {MapScaleBar, MapCompass, RulerPanel, SegmentPreview, type PendingSegment} from '../components/world/mapTools';
import '../index.css';
import './mapRead.css';
import {setActiveLang} from '../i18n';
import type {AppLanguage} from '@shared/types';

type Source = {version:1; vaultId:string; map:WorldMap; layers:MapLayer[]; markers:MapMarker[]; travelModes:MapTravelMode[]; scenes:WorldScene[]; presences:Presence[]; calendar:WorldCalendar};
type Options = {hiddenLayers:string[]; selectedMarker:string|null; cast:string[]; day:number|null; scenes:boolean; measuring:boolean; fitKey:string; dark:boolean; language:AppLanguage; fontSize:number};
type Payload = {source:Source; options:Options; imageUrl:string|null};
function send(value:unknown) { (window as any).webkit?.messageHandlers?.nodusMapRead?.postMessage(value); }
function valid(input:Payload) {
  const source=input?.source;
  if(source?.version!==1 || typeof source.vaultId!=='string' || typeof source.map?.mapId!=='string' || !source.map.mapId ||
     !Number.isFinite(source.map.widthPx) || source.map.widthPx<0 || !Number.isFinite(source.map.heightPx) || source.map.heightPx<0 ||
     source.map.imageId && (source.map.widthPx<=0 || source.map.heightPx<=0) ||
     !Array.isArray(source.layers) || !Array.isArray(source.markers) || !Array.isArray(source.presences) || !Array.isArray(source.scenes) || !Array.isArray(source.travelModes)) throw new Error('El mapa recibido no tiene un formato válido.');
  if(source.layers.some(layer=>layer.mapId!==source.map.mapId) || source.markers.some(marker=>marker.mapId!==source.map.mapId || !Number.isFinite(marker.x) || !Number.isFinite(marker.y))) throw new Error('Las capas y los marcadores no pertenecen a este mapa.');
  if(input.imageUrl!==null && (!source.map.imageId || input.imageUrl!==`nodus-image://map/${encodeURIComponent(source.map.imageId)}` && !/^data:image\/(?:png|jpeg|webp|avif|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(input.imageUrl))) throw new Error('El original del mapa no tiene una identidad válida.');
  if(!input.options || !Array.isArray(input.options.hiddenLayers) || !Array.isArray(input.options.cast) || input.options.day!==null && !Number.isFinite(input.options.day)) throw new Error('Las opciones del visor no tienen un formato válido.');
}
function Atlas({source,options,imageUrl}:Payload) {
  const [segment,setSegment]=useState<PendingSegment|null>(null);
  const tracks=useMemo(()=>buildTracks(source.presences),[source.presences]);
  const followed=useMemo(()=>tracks.filter(track=>options.cast.includes(track.personId)),[tracks,options.cast]);
  const placed=useMemo(()=>placeCharacters(followed,source.markers,options.day),[followed,source.markers,options.day]);
  const layers=useMemo(()=>source.layers.map(layer=>({...layer,visible:!options.hiddenLayers.includes(layer.layerId)})),[source.layers,options.hiddenLayers]);
  React.useEffect(()=>{
    const range=trackRange(followed);
    const day=options.day;
    const date=day!==null&&hasCalendar(source.calendar)?fromWorldDay(source.calendar,day):null;
    const dayLabel=day===null?'Todas las fechas':date?formatWorldDate(source.calendar,date):`Año ${Math.floor(day/ORDER_SCALE)}`;
    send({type:'summary',mapId:source.map.mapId,range,dayLabel,cast:placed.map(person=>({personId:person.personId,personName:person.personName,placeName:person.placeName,towardsPlaceName:person.towardsPlaceName,travelling:person.travelling,beforeFirst:person.beforeFirst}))});
  },[source.map.mapId,source.calendar,followed,options.day,placed]);
  React.useEffect(()=>{if(!options.measuring)setSegment(null);},[options.measuring]);
  return <div className="nodus-map-read-stage">
    <WorldMapCanvas map={source.map} imageUrl={imageUrl} fitKey={options.fitKey} drawing={options.measuring}
      onClick={options.measuring?point=>setSegment(previous=>previous?.to?{from:point,to:null}:previous?{...previous,to:point}:{from:point,to:null}):undefined}>
      {({leaflet,frame})=><>
        <MarkerLayer leaflet={leaflet} frame={frame} map={source.map} markers={source.markers} layers={layers} selectedId={options.selectedMarker} worldDay={options.day}
          onSelect={id=>send({type:'marker',mapId:source.map.mapId,id})} onOpenChild={id=>send({type:'child',mapId:source.map.mapId,id})}/>
        <CastLayer leaflet={leaflet} frame={frame} cast={placed} tracks={followed} markers={source.markers} showRoutes={followed.length>0}/>
        {options.scenes&&<SceneLayer leaflet={leaflet} frame={frame} scenes={source.scenes} markers={source.markers} onOpenScene={id=>send({type:'scene',mapId:source.map.mapId,id})}/>}
        <MapScaleBar map={source.map} leaflet={leaflet} frame={frame}/><MapCompass/>
        {segment&&<SegmentPreview leaflet={leaflet} frame={frame} segment={segment} color="#eab308"/>}
      </>}
    </WorldMapCanvas>
    {options.measuring&&segment&&<RulerPanel map={source.map} segment={segment} travelModes={source.travelModes} onClose={()=>setSegment(null)}/>}
    {options.measuring&&!segment&&<div className="nodus-map-read-instruction">Toca el origen y después el destino para medir.</div>}
  </div>;
}
class MapBoundary extends React.Component<React.PropsWithChildren,{issue:string|null}> {
  state={issue:null as string|null};
  static getDerivedStateFromError(error:Error){return{issue:error.message};}
  componentDidCatch(error:Error){send({type:'error',message:error.message});}
  render(){return this.state.issue?<div role="alert" className="nodus-map-read-error">{this.state.issue}</div>:this.props.children;}
}
const root=createRoot(document.getElementById('root')!);
(window as any).nodusMapReadRender=(input:Payload)=>{
  try {
    valid(input);setActiveLang(input.options.language);document.documentElement.dataset.theme=input.options.dark?'dark':'light';
    document.documentElement.style.setProperty('--nodus-map-font',`${Math.min(48,Math.max(12,input.options.fontSize||14))}px`);
    root.render(<MapBoundary key={input.source.map.mapId}><Atlas {...input}/></MapBoundary>);
  }catch(error){send({type:'error',message:error instanceof Error?error.message:'No se pudo abrir el mapa.'});}
};
window.addEventListener('error',event=>send({type:'error',message:event.message}));
window.addEventListener('unhandledrejection',event=>send({type:'error',message:String(event.reason?.message??event.reason)}));
send({type:'ready'});

import {isContentActive,nextContentBoundary} from './content-utils.js';
import {isPlaylistScheduled,nextScheduleCheck} from './playlist-schedule.js';
import {tableAssetUrls} from './table-templates.js';

export const PRICE_TTL=24*60*60*1000;
export const EVENT_TTL=7*24*60*60*1000;
export const externalKinds=new Set(['youtube','web','weather']);
export function hasPrices(item){
 return ['image','video','product_image'].includes(item.kind) && item.hasPrices!==false || item.hasPrices===true || item.kind==='offer' || item.kind==='price_table' || item.kind==='poster' && item.config?.rows?.some(row=>row.active!==false);
}
export function canPlay(item,{now,connected,confirmedAt,clockUnsafe=false,schedule}){
 return isPlaylistScheduled(item.playbackSchedule??schedule,now) && isContentActive(item,now) && (connected || !externalKinds.has(item.kind)) &&
  (!hasPrices(item) || !clockUnsafe && Number.isFinite(confirmedAt) && now<confirmedAt+PRICE_TTL);
}
export function nextPlaybackBoundary(items,context){
 const validity=nextContentBoundary(items,context.now);
 const price=items.some(hasPrices) && context.confirmedAt+PRICE_TTL>context.now ? context.confirmedAt+PRICE_TTL : null;
 const itemSchedule=items.some(item=>item.playbackSchedule?.enabled)?nextScheduleCheck({enabled:true},context.now):null;
 const times=[validity,price,nextScheduleCheck(context.schedule,context.now),itemSchedule].filter(Number.isFinite);return times.length?Math.min(...times):null;
}
export function mediaUrls(data){
 return [...new Set((data.publication?.items||[]).flatMap(item=>['image','video','product_image'].includes(item.kind)?[item.url]:tableAssetUrls(item)))];
}

import type { MarineHour, ScoredHour, SpotProfile } from "./types";
const angle=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);
const band=(v:number,min:number,max:number)=>v>=min&&v<=max?1:v<min?Math.max(0,1-(min-v)/min):Math.max(0,1-(v-max)/max);
export function labelFor(score:number){return score>=95?"ÉPICO":score>=88?"EXCELENTE":score>=78?"MUITO BOM":score>=68?"BOM":score>=55?"RAZOÁVEL":score>=40?"FRACO":"RUIM"}
export function decisionFor(score:number){return score>=82?"VAI AGORA":score>=68?"TALVEZ":score>=52?"ESPERA":"NÃO VALE"}
export function scoreHour(spot:SpotProfile,h:MarineHour):ScoredHour{
 const sh=h.swellHeight??h.waveHeight??0, sd=h.swellDirection??h.waveDirection??0, period=h.swellPeriod??h.wavePeriod??0, wind=h.windSpeed??0, wd=h.windDirection??0;
 const alignment=Math.max(0,1-angle(sd,spot.idealSwell)/spot.swellWindow);
 const height=band(sh,...spot.idealHeight), periodFit=band(period,...spot.idealPeriod);
 const offshore=Math.max(-1,1-angle(wd,spot.offshore)/90); const windFactor=Math.max(0,1-wind/(spot.windTolerance*1.35));
 const raw=alignment*28+height*22+periodFit*20+Math.max(0,offshore)*18+windFactor*12-(offshore<0?Math.min(20,wind):0);
 const score=Math.round(Math.max(0,Math.min(100,raw)));
 const reasons=[alignment>.72?"swell bem alinhado para o pico":"swell entrando de lado",period>=10?`período de ${period.toFixed(0)}s`:"período curto",offshore>.35?"vento terral":"vento desfavorável",wind<8?"vento fraco":"vento ganhando força"];
 return {...h,spot,score,label:labelFor(score),decision:decisionFor(score),reasons};
}
export function bestWindow(hours:ScoredHour[]){const good=hours.filter(x=>x.score>=68);if(!good.length)return null;let best=[good[0]],run=[good[0]];for(let i=1;i<good.length;i++){const gap=new Date(good[i].time).getTime()-new Date(good[i-1].time).getTime();run=gap<=5400000?[...run,good[i]]:[good[i]];if(run.reduce((a,b)=>a+b.score,0)>best.reduce((a,b)=>a+b.score,0))best=run}return {start:best[0].time,end:best.at(-1)!.time,score:Math.round(best.reduce((a,b)=>a+b.score,0)/best.length)}}
